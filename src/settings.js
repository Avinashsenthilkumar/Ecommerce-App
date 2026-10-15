// Store settings editable from the admin panel. .env values are only the first-run defaults.
const { db } = require('./db');
const { str, isEmail } = require('./validate');

const env = process.env;
const rupees = (v, d) => Math.round(Number(v ?? d) * 100);

const DEFS = {
  store_name: { type: 'str', def: env.STORE_NAME || 'Kernel & Co.', max: 60 },
  store_tagline: { type: 'str', def: env.STORE_TAGLINE || 'Honest nuts, seeds & dry fruits — packed fresh in India', max: 160 },
  support_email: { type: 'email', def: env.SUPPORT_EMAIL || 'support@example.com' },
  support_phone: { type: 'str', def: env.SUPPORT_PHONE || '+91 90000 00000', max: 30 },
  store_address: { type: 'str', def: env.STORE_ADDRESS || '', max: 300 },
  store_gstin: { type: 'str', def: env.STORE_GSTIN || '', max: 15 },
  store_fssai: { type: 'str', def: env.STORE_FSSAI || '', max: 20 },
  prices_include_tax: { type: 'bool', def: env.PRICES_INCLUDE_TAX !== 'false' },
  shipping_fee: { type: 'paise', def: rupees(env.SHIPPING_FEE, 49) },
  free_shipping_above: { type: 'paise', def: rupees(env.FREE_SHIPPING_ABOVE, 499) },
  cod_enabled: { type: 'bool', def: env.COD_ENABLED !== 'false' },
  cod_max_order: { type: 'paise', def: rupees(env.COD_MAX_ORDER, 5000) },
  cod_fee: { type: 'paise', def: rupees(env.COD_FEE, 0) },
};

let cache = null;

function decode(def, raw) {
  if (raw == null) return def.def;
  if (def.type === 'bool') return raw === '1';
  if (def.type === 'paise') return Number(raw) || 0;
  return raw;
}

function all() {
  if (cache) return cache;
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  cache = Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, decode(d, rows[k])]));
  return cache;
}

// Validates and saves a partial update. Paise fields arrive in paise.
function update(patch = {}) {
  const errors = {};
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    const d = DEFS[k];
    if (!d) continue;
    if (d.type === 'bool') out[k] = v ? '1' : '0';
    else if (d.type === 'paise') {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000_00) errors[k] = 'Enter a valid amount';
      else out[k] = String(n);
    } else if (d.type === 'email') {
      const s = str(v, 120);
      if (!isEmail(s)) errors[k] = 'Enter a valid email'; else out[k] = s;
    } else out[k] = str(v, d.max || 200);
  }
  if (out.store_name === '') errors.store_name = 'Store name is required';
  if (out.store_gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(out.store_gstin.toUpperCase()))
    errors.store_gstin = 'GSTIN should be 15 characters, e.g. 33ABCDE1234F1Z5';
  if (out.store_gstin) out.store_gstin = out.store_gstin.toUpperCase();
  if (Object.keys(errors).length) return { errors };
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(out)) up.run(k, v);
  cache = null;
  return { settings: all() };
}

module.exports = { all, update, DEFS };
