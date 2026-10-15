const express = require('express');
const { db, tx } = require('../db');
const { requireAdmin } = require('../auth');
const { serialize } = require('./orders');

const router = express.Router();
router.use(requireAdmin);

const STATUSES = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];

router.get('/stats', (_req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    today: one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) amt FROM orders
      WHERE date(created_at,'+330 minutes') = date('now','+330 minutes') AND status != 'cancelled'
      AND (payment_status IN ('paid','cod'))`),
    toShip: one(`SELECT COUNT(*) n FROM orders WHERE status IN ('confirmed','packed')`).n,
    unpaid: one(`SELECT COUNT(*) n FROM orders WHERE payment_method='online' AND payment_status IN ('pending','failed') AND status='pending'`).n,
    lowStock: db.prepare(`SELECT v.id,p.name,v.label,v.stock FROM variants v JOIN products p ON p.id=v.product_id
      WHERE v.stock < 15 ORDER BY v.stock LIMIT 20`).all(),
    customers: one(`SELECT COUNT(*) n FROM users WHERE role='customer'`).n,
  });
});

router.get('/orders', (req, res) => {
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const args = [];
  if (req.query.status && STATUSES.includes(req.query.status)) { sql += ' AND status=?'; args.push(req.query.status); }
  if (req.query.q) {
    sql += ' AND (order_no LIKE ? OR email LIKE ? OR phone LIKE ? OR name LIKE ?)';
    const q = `%${String(req.query.q).slice(0, 50)}%`; args.push(q, q, q, q);
  }
  sql += ' ORDER BY id DESC LIMIT 200';
  res.json(db.prepare(sql).all(...args).map((o) => ({ ...serialize(o), guest: o.user_id == null })));
});

router.patch('/orders/:orderNo', (req, res) => {
  const status = req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const o = db.prepare('SELECT * FROM orders WHERE order_no=?').get(req.params.orderNo);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'Cancelled orders cannot be changed.' });
  if (status !== 'cancelled' && o.payment_method === 'online' && o.payment_status !== 'paid')
    return res.status(400).json({ error: 'Unpaid online orders can only be cancelled.' });

  tx(() => {
    db.prepare(`UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, o.id);
    if (status === 'delivered' && o.payment_method === 'cod')
      db.prepare(`UPDATE orders SET payment_status='paid' WHERE id=?`).run(o.id);
    if (status === 'cancelled' && o.stock_applied) {
      // put the stock back on the shelf
      const items = db.prepare('SELECT variant_id, qty FROM order_items WHERE order_id=?').all(o.id);
      const inc = db.prepare('UPDATE variants SET stock = stock + ? WHERE id=?');
      for (const it of items) inc.run(it.qty, it.variant_id);
      db.prepare('UPDATE orders SET stock_applied=0 WHERE id=?').run(o.id);
    }
  });
  const fresh = db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
  res.json({ ...serialize(fresh), guest: fresh.user_id == null,
    note: status === 'cancelled' && o.payment_status === 'paid' ? 'Order was paid online — issue the refund from the Razorpay dashboard.' : undefined });
});

router.get('/inventory', (_req, res) => {
  res.json(db.prepare(`SELECT v.id,v.sku,p.name,v.label,v.price,v.mrp,v.stock FROM variants v
    JOIN products p ON p.id=v.product_id ORDER BY p.name, v.grams`).all());
});

router.patch('/inventory/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM variants WHERE id=?').get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Variant not found' });
  const stock = req.body.stock != null ? Math.max(0, Math.floor(Number(req.body.stock))) : v.stock;
  const price = req.body.price != null ? Math.round(Number(req.body.price) * 100) : v.price;
  const mrp = req.body.mrp != null ? Math.round(Number(req.body.mrp) * 100) : v.mrp;
  if (![stock, price, mrp].every(Number.isFinite) || price <= 0 || mrp < price)
    return res.status(400).json({ error: 'Check the values: price must be positive and not above MRP.' });
  db.prepare('UPDATE variants SET stock=?, price=?, mrp=? WHERE id=?').run(stock, price, mrp, v.id);
  res.json({ ok: true });
});

module.exports = router;
