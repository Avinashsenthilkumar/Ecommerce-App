// Server-side pricing: item prices, GST per line, zone-based shipping, COD fee.
// Prices always come from the database, never from the browser.
const { db } = require('./db');
const settings = require('./settings');

function httpErr(status, message, extra) { return Object.assign(new Error(message), { status, extra }); }

function defaultTaxClass() {
  return db.prepare('SELECT id, name, rate_bp FROM tax_classes WHERE is_default = 1').get()
    || { id: null, name: 'No tax', rate_bp: 0 };
}

// Tax contained in (inclusive) or added to (exclusive) an amount
function taxOn(amount, rateBp, inclusive) {
  if (!rateBp) return 0;
  return inclusive ? Math.round((amount * rateBp) / (10000 + rateBp)) : Math.round((amount * rateBp) / 10000);
}

function shippingZones() {
  return db.prepare('SELECT * FROM shipping_zones WHERE is_active = 1 ORDER BY sort, id').all()
    .map((z) => ({ ...z, states: JSON.parse(z.states || '[]') }));
}

function shippingFor(state, itemsValue) {
  const s = settings.all();
  const zone = state ? shippingZones().find((z) => z.states.includes(state)) : null;
  const fee = zone ? zone.fee : s.shipping_fee;
  const freeAbove = zone ? zone.free_above : s.free_shipping_above;
  const free = freeAbove > 0 && itemsValue >= freeAbove;
  return { shipping: free ? 0 : fee, zone: zone ? zone.name : 'Standard', freeAbove, baseFee: fee };
}

function quote(items, { state, paymentMethod } = {}) {
  if (!Array.isArray(items) || !items.length) throw httpErr(400, 'Your cart is empty.');
  const merged = new Map();
  for (const it of items.slice(0, 50)) {
    const id = Number(it.variantId), qty = Math.floor(Number(it.qty));
    if (!Number.isInteger(id) || !(qty > 0)) continue;
    merged.set(id, Math.min((merged.get(id) || 0) + qty, 20));
  }
  if (!merged.size) throw httpErr(400, 'Your cart is empty.');

  const s = settings.all();
  const inclusive = s.prices_include_tax;
  const def = defaultTaxClass();
  const get = db.prepare(`SELECT v.id, v.label, v.price, v.stock, v.is_active AS v_active, p.name, p.hsn, p.is_active,
      t.rate_bp FROM variants v JOIN products p ON p.id = v.product_id
      LEFT JOIN tax_classes t ON t.id = p.tax_class_id WHERE v.id = ?`);

  const lines = [];
  for (const [id, qty] of merged) {
    const v = get.get(id);
    if (!v || !v.is_active || !v.v_active) throw httpErr(400, 'An item in your cart is no longer available. Please review your cart.');
    if (v.stock < qty) throw httpErr(409, `Only ${v.stock} left of ${v.name} (${v.label}). Please update your cart.`);
    const rate = v.rate_bp ?? def.rate_bp;
    const lineTotal = v.price * qty;
    lines.push({ variantId: v.id, name: v.name, label: v.label, hsn: v.hsn || '', unitPrice: v.price, qty, lineTotal,
      taxRate: rate, taxAmount: taxOn(lineTotal, rate, inclusive) });
  }
  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  const taxTotal = lines.reduce((a, l) => a + l.taxAmount, 0);
  const itemsValue = inclusive ? subtotal : subtotal + taxTotal;
  const ship = shippingFor(state, itemsValue);
  const preCod = itemsValue + ship.shipping;
  const codAvailable = s.cod_enabled && preCod + s.cod_fee <= s.cod_max_order;
  const codFee = paymentMethod === 'cod' ? s.cod_fee : 0;

  // GST summary by rate (useful for invoices)
  const byRate = {};
  for (const l of lines) byRate[l.taxRate] = (byRate[l.taxRate] || 0) + l.taxAmount;

  return {
    lines, subtotal, taxTotal, taxInclusive: inclusive,
    taxBreakup: Object.entries(byRate).filter(([, amt]) => amt > 0).map(([rate, amount]) => ({ rate: Number(rate), amount })),
    shipping: ship.shipping, shippingZone: ship.zone, freeShippingAbove: ship.freeAbove, itemsValue,
    codFee, codFeeIfCod: s.cod_fee, codAvailable,
    total: preCod + codFee,
  };
}

module.exports = { quote, taxOn, shippingZones, shippingFor, defaultTaxClass, httpErr };
