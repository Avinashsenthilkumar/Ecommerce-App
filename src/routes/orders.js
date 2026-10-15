const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Razorpay = require('razorpay');
const { db, tx } = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth');
const { str, isEmail, validateAddress } = require('../validate');
const { quote: priceCart, httpErr } = require('../pricing');
const settings = require('../settings');

const router = express.Router();
const rzp = config.razorpay.enabled
  ? new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret })
  : null;

const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' } });

// ---------- helpers ----------
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEqual = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
// Lets a guest open their own order page without an account
const guestToken = (orderNo) => hmac(config.jwtSecret, `order:${orderNo}`).slice(0, 32);

function newOrderNo() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `NS${ymd}${crypto.randomInt(100000, 999999)}`;
}

function applyStock(orderId) {
  const items = db.prepare('SELECT variant_id, qty FROM order_items WHERE order_id=?').all(orderId);
  const dec = db.prepare('UPDATE variants SET stock = MAX(stock - ?, 0) WHERE id=?');
  for (const it of items) dec.run(it.qty, it.variant_id);
  db.prepare('UPDATE orders SET stock_applied=1 WHERE id=?').run(orderId);
}

function markPaid(order, paymentId) {
  return tx(() => {
    const fresh = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
    if (fresh.payment_status === 'paid') return fresh; // idempotent (handler + webhook can both arrive)
    db.prepare(`UPDATE orders SET payment_status='paid', status='confirmed', razorpay_payment_id=?,
      updated_at=datetime('now') WHERE id=?`).run(paymentId, order.id);
    if (!fresh.stock_applied) applyStock(order.id);
    return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  });
}

function serialize(o, { withToken = false } = {}) {
  const items = db.prepare('SELECT variant_id,product_name,label,unit_price,qty,line_total,tax_rate,tax_amount,hsn FROM order_items WHERE order_id=?').all(o.id);
  return {
    orderNo: o.order_no, createdAt: o.created_at, status: o.status,
    paymentMethod: o.payment_method, paymentStatus: o.payment_status,
    name: o.name, email: o.email, phone: o.phone, address: JSON.parse(o.address),
    subtotal: o.subtotal, shipping: o.shipping, discount: o.discount, total: o.total,
    taxTotal: o.tax_total, taxInclusive: !!o.tax_inclusive, codFee: o.cod_fee,
    paymentRef: o.razorpay_payment_id || null,
    items: items.map((i) => ({ variantId: i.variant_id, name: i.product_name, label: i.label, unitPrice: i.unit_price, qty: i.qty, lineTotal: i.line_total,
      taxRate: i.tax_rate, taxAmount: i.tax_amount, hsn: i.hsn })),
    ...(withToken ? { token: guestToken(o.order_no) } : {}),
  };
}

// Owner (logged in), holder of the guest link, or admin may see an order
function loadOrderFor(req) {
  const o = db.prepare('SELECT * FROM orders WHERE order_no=?').get(String(req.params.orderNo));
  if (!o) return null;
  const t = req.query.t || req.body?.t;
  if (req.user && (req.user.role === 'admin' || req.user.id === o.user_id)) return o;
  if (t && safeEqual(t, guestToken(o.order_no))) return o;
  return null;
}

async function razorpayPayload(o) {
  let rzpOrderId = o.razorpay_order_id;
  if (!rzpOrderId) {
    const r = await rzp.orders.create({
      amount: o.total, currency: 'INR', receipt: o.order_no,
      notes: { order_no: o.order_no, email: o.email },
    });
    rzpOrderId = r.id;
    db.prepare('UPDATE orders SET razorpay_order_id=? WHERE id=?').run(rzpOrderId, o.id);
  }
  return {
    keyId: config.razorpay.keyId, orderId: rzpOrderId, amount: o.total, currency: 'INR',
    name: settings.all().store_name, description: `Order ${o.order_no}`,
    prefill: { name: o.name, email: o.email, contact: o.phone },
  };
}

// ---------- routes ----------
router.post('/quote', (req, res, next) => {
  try {
    res.json(priceCart(req.body.items, { state: str(req.body.state, 60) || null, paymentMethod: req.body.paymentMethod }));
  } catch (e) { next(e); }
});

router.post('/', orderLimiter, async (req, res, next) => {
  try {
    const { addr, errors, ok } = validateAddress(req.body.address);
    const email = req.user ? req.user.email : str(req.body.email, 120).toLowerCase();
    if (!req.user && !isEmail(email)) errors.email = 'Enter a valid email for order updates';
    if (!ok || errors.email) throw httpErr(400, 'Please fix the highlighted fields.', { errors });

    const method = req.body.paymentMethod;
    if (!['online', 'cod'].includes(method)) throw httpErr(400, 'Choose a payment method.');
    const quote = priceCart(req.body.items, { state: addr.state, paymentMethod: method });
    if (method === 'cod' && !quote.codAvailable)
      throw httpErr(400, 'Cash on Delivery is not available for this order.');
    if (method === 'online' && !config.razorpay.enabled && !config.demoPayments)
      throw httpErr(503, 'Online payment is not configured yet. Please choose Cash on Delivery.');

    const orderNo = newOrderNo();
    const order = tx(() => {
      const info = db.prepare(`INSERT INTO orders (order_no,user_id,email,phone,name,address,subtotal,shipping,total,
        tax_total,tax_inclusive,cod_fee,payment_method,payment_status,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        orderNo, req.user?.id ?? null, email, addr.phone, addr.name, JSON.stringify(addr),
        quote.subtotal, quote.shipping, quote.total, quote.taxTotal, quote.taxInclusive ? 1 : 0, quote.codFee, method,
        method === 'cod' ? 'cod' : 'pending', method === 'cod' ? 'confirmed' : 'pending'
      );
      const insItem = db.prepare(`INSERT INTO order_items (order_id,variant_id,product_name,label,unit_price,qty,line_total,tax_rate,tax_amount,hsn)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const l of quote.lines) insItem.run(info.lastInsertRowid, l.variantId, l.name, l.label, l.unitPrice, l.qty, l.lineTotal, l.taxRate, l.taxAmount, l.hsn);
      if (method === 'cod') applyStock(info.lastInsertRowid);

      if (req.user && req.body.saveAddress) {
        const exists = db.prepare('SELECT 1 FROM addresses WHERE user_id=? AND line1=? AND pincode=?').get(req.user.id, addr.line1, addr.pincode);
        if (!exists) db.prepare(`INSERT INTO addresses (user_id,name,phone,line1,line2,city,state,pincode) VALUES (?,?,?,?,?,?,?,?)`)
          .run(req.user.id, addr.name, addr.phone, addr.line1, addr.line2, addr.city, addr.state, addr.pincode);
      }
      return db.prepare('SELECT * FROM orders WHERE id=?').get(info.lastInsertRowid);
    });

    const out = { orderNo, token: guestToken(orderNo), total: order.total, paymentMethod: method };
    if (method === 'online') {
      if (config.razorpay.enabled) out.razorpay = await razorpayPayload(order);
      else out.demo = true;
    }
    res.status(201).json(out);
  } catch (e) { next(e); }
});

// Retry payment for an unpaid online order
router.post('/:orderNo/pay', async (req, res, next) => {
  try {
    const o = loadOrderFor(req);
    if (!o) throw httpErr(404, 'Order not found.');
    if (o.payment_method !== 'online' || o.payment_status === 'paid' || o.status === 'cancelled')
      throw httpErr(400, 'This order does not need payment.');
    if (config.razorpay.enabled) return res.json({ razorpay: await razorpayPayload(o) });
    if (config.demoPayments) return res.json({ demo: true });
    throw httpErr(503, 'Online payment is not configured.');
  } catch (e) { next(e); }
});

// Razorpay Checkout success handler → verify signature server-side
router.post('/:orderNo/verify', (req, res, next) => {
  try {
    const o = loadOrderFor(req);
    if (!o) throw httpErr(404, 'Order not found.');
    const { razorpay_order_id: rOrder, razorpay_payment_id: rPay, razorpay_signature: sig } = req.body || {};
    if (!config.razorpay.enabled || !rOrder || !rPay || !sig) throw httpErr(400, 'Missing payment details.');
    if (rOrder !== o.razorpay_order_id) throw httpErr(400, 'Payment does not match this order.');
    const expected = hmac(config.razorpay.keySecret, `${rOrder}|${rPay}`);
    if (!safeEqual(expected, sig)) throw httpErr(400, 'Payment verification failed. If money was debited, it will be auto-refunded or confirmed shortly.');
    res.json(serialize(markPaid(o, rPay)));
  } catch (e) { next(e); }
});

// Local testing only: simulates a successful payment when Razorpay keys are absent
router.post('/:orderNo/demo-pay', (req, res, next) => {
  try {
    if (!config.demoPayments) throw httpErr(404, 'Not found.');
    const o = loadOrderFor(req);
    if (!o) throw httpErr(404, 'Order not found.');
    res.json(serialize(markPaid(o, `demo_${crypto.randomBytes(6).toString('hex')}`)));
  } catch (e) { next(e); }
});

router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json(rows.map((o) => serialize(o)));
});

router.post('/track', orderLimiter, (req, res) => {
  const orderNo = str(req.body.orderNo, 30).toUpperCase();
  const email = str(req.body.email, 120).toLowerCase();
  const o = db.prepare('SELECT * FROM orders WHERE order_no=? AND email=?').get(orderNo, email);
  if (!o) return res.status(404).json({ error: 'No order found with that order number and email.' });
  res.json(serialize(o, { withToken: true }));
});

router.get('/:orderNo', (req, res) => {
  const o = loadOrderFor(req);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  res.json(serialize(o));
});

// Razorpay webhook (mounted with a raw body parser in server.js)
function webhook(req, res) {
  const secret = config.razorpay.webhookSecret;
  const sig = req.get('x-razorpay-signature');
  if (!secret || !sig || !Buffer.isBuffer(req.body)) return res.status(400).end();
  if (!safeEqual(hmac(secret, req.body), sig)) return res.status(400).end();
  let evt;
  try { evt = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).end(); }
  const pay = evt?.payload?.payment?.entity;
  if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && pay?.order_id) {
    const o = db.prepare('SELECT * FROM orders WHERE razorpay_order_id=?').get(pay.order_id);
    if (o && pay.amount === o.total) markPaid(o, pay.id);
  } else if (evt.event === 'payment.failed' && pay?.order_id) {
    db.prepare(`UPDATE orders SET payment_status='failed', updated_at=datetime('now')
      WHERE razorpay_order_id=? AND payment_status='pending'`).run(pay.order_id);
  }
  res.json({ ok: true });
}

module.exports = { router, webhook, serialize, applyStock };
