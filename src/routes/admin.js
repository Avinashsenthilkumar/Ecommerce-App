const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, tx } = require('../db');
const { requireAdmin } = require('../auth');
const settings = require('../settings');
const { loadTree, createsCycle } = require('../categories');
const { STATES, str } = require('../validate');
const { serialize } = require('./orders');

const router = express.Router();
router.use(requireAdmin);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const STATUSES = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];
const SHAPES = ['almond', 'cashew', 'walnut', 'pistachio', 'seed', 'date', 'raisin', 'makhana', 'mix'];
const bad = (res, error, errors) => res.status(400).json({ error, errors });
const int = (v) => (v === '' || v == null ? NaN : Math.round(Number(v)));
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function uniqueSlug(table, base, exceptId = 0) {
  let slug = base || 'item', n = 2;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE slug = ? AND id != ?`).get(slug, exceptId)) slug = `${base}-${n++}`;
  return slug;
}

// ======================= Dashboard =======================
router.get('/stats', (_req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    today: one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) amt FROM orders
      WHERE date(created_at,'+330 minutes') = date('now','+330 minutes') AND status != 'cancelled'
      AND payment_status IN ('paid','cod')`),
    toShip: one(`SELECT COUNT(*) n FROM orders WHERE status IN ('confirmed','packed')`).n,
    unpaid: one(`SELECT COUNT(*) n FROM orders WHERE payment_method='online' AND payment_status IN ('pending','failed') AND status='pending'`).n,
    lowStock: db.prepare(`SELECT v.id,p.name,v.label,v.stock FROM variants v JOIN products p ON p.id=v.product_id
      WHERE v.stock < 15 AND v.is_active = 1 AND p.is_active = 1 ORDER BY v.stock LIMIT 50`).all(),
    customers: one(`SELECT COUNT(*) n FROM users WHERE role='customer'`).n,
    products: one('SELECT COUNT(*) n FROM products WHERE is_active = 1').n,
  });
});

// ======================= Orders =======================
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
  if (!STATUSES.includes(status)) return bad(res, 'Invalid status');
  const o = db.prepare('SELECT * FROM orders WHERE order_no=?').get(req.params.orderNo);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (o.status === 'cancelled') return bad(res, 'Cancelled orders cannot be changed.');
  if (status !== 'cancelled' && o.payment_method === 'online' && o.payment_status !== 'paid')
    return bad(res, 'Unpaid online orders can only be cancelled.');

  tx(() => {
    db.prepare(`UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, o.id);
    if (status === 'delivered' && o.payment_method === 'cod')
      db.prepare(`UPDATE orders SET payment_status='paid' WHERE id=?`).run(o.id);
    if (status === 'cancelled' && o.stock_applied) {
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

// ======================= Categories =======================
router.get('/categories', (_req, res) => {
  const tree = loadTree();
  const counts = Object.fromEntries(db.prepare('SELECT category_id id, COUNT(*) n FROM products GROUP BY category_id').all().map((r) => [r.id, r.n]));
  const flat = [];
  const walk = (n, depth) => {
    flat.push({ id: n.id, slug: n.slug, name: n.name, blurb: n.blurb, parent_id: n.parent_id, sort: n.sort,
      is_active: !!n.is_active, visible: n.visible, depth, products: counts[n.id] || 0, children: n.children.length,
      path: tree.path(n).map((c) => c.name).join(' › ') });
    n.children.forEach((c) => walk(c, depth + 1));
  };
  tree.roots.forEach((r) => walk(r, 0));
  res.json(flat);
});

function categoryInput(body, id = 0) {
  const errors = {};
  const name = str(body.name, 60);
  if (name.length < 2) errors.name = 'Enter a category name';
  const parentId = body.parent_id ? Number(body.parent_id) : null;
  const tree = loadTree();
  if (parentId && !tree.byId.has(parentId)) errors.parent_id = 'Parent category not found';
  if (parentId && id && (parentId === id || createsCycle(tree, id, parentId))) errors.parent_id = 'A category cannot sit inside itself or its own sub-category';
  const slug = slugify(body.slug || name);
  if (!slug) errors.slug = 'Enter a URL slug';
  else if (db.prepare('SELECT 1 FROM categories WHERE slug=? AND id != ?').get(slug, id)) errors.slug = 'This slug is already used';
  return { errors, data: { name, slug, parent_id: parentId, blurb: str(body.blurb, 200), sort: int(body.sort) || 0, is_active: body.is_active === false ? 0 : 1 } };
}

router.post('/categories', (req, res) => {
  const { errors, data } = categoryInput(req.body);
  if (Object.keys(errors).length) return bad(res, 'Please fix the highlighted fields.', errors);
  const info = db.prepare('INSERT INTO categories (name,slug,parent_id,blurb,sort,is_active) VALUES (?,?,?,?,?,?)')
    .run(data.name, data.slug, data.parent_id, data.blurb, data.sort, data.is_active);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM categories WHERE id=?').get(id)) return res.status(404).json({ error: 'Category not found' });
  const { errors, data } = categoryInput(req.body, id);
  if (Object.keys(errors).length) return bad(res, 'Please fix the highlighted fields.', errors);
  db.prepare('UPDATE categories SET name=?, slug=?, parent_id=?, blurb=?, sort=?, is_active=? WHERE id=?')
    .run(data.name, data.slug, data.parent_id, data.blurb, data.sort, data.is_active, id);
  res.json({ ok: true });
});

router.delete('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM categories WHERE parent_id=?').get(id)) return bad(res, 'Move or delete its sub-categories first.');
  const n = db.prepare('SELECT COUNT(*) n FROM products WHERE category_id=?').get(id).n;
  if (n) return bad(res, `${n} product(s) are in this category. Move them to another category first, or hide the category instead.`);
  db.prepare('DELETE FROM categories WHERE id=?').run(id);
  res.json({ ok: true });
});

// ======================= Products =======================
router.get('/products', (req, res) => {
  const tree = loadTree();
  let sql = `SELECT p.id, p.slug, p.name, p.category_id, p.is_active, p.featured, p.image, p.color, p.shape, p.tax_class_id,
    t.name AS tax_name, (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variant_count,
    (SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1) AS stock,
    (SELECT MIN(price) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1) AS from_price
    FROM products p LEFT JOIN tax_classes t ON t.id = p.tax_class_id WHERE 1=1`;
  const args = [];
  if (req.query.q) { sql += ' AND (p.name LIKE ? OR p.slug LIKE ?)'; const q = `%${String(req.query.q).slice(0, 50)}%`; args.push(q, q); }
  if (req.query.category) {
    const node = tree.byId.get(Number(req.query.category));
    if (node) { const ids = tree.descendants(node); sql += ` AND p.category_id IN (${ids.map(() => '?').join(',')})`; args.push(...ids); }
  }
  sql += ' ORDER BY p.is_active DESC, p.name';
  res.json(db.prepare(sql).all(...args).map((p) => {
    const c = tree.byId.get(p.category_id);
    return { ...p, is_active: !!p.is_active, featured: !!p.featured, category_path: c ? tree.path(c).map((x) => x.name).join(' › ') : '—' };
  }));
});

router.get('/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Product not found' });
  p.variants = db.prepare(`SELECT v.*, EXISTS(SELECT 1 FROM order_items oi WHERE oi.variant_id = v.id) AS has_orders
    FROM variants v WHERE product_id=? AND is_active = 1 ORDER BY grams, price`).all(p.id);
  p.benefits = p.benefits ? p.benefits.split('|') : [];
  res.json(p);
});

function productInput(body, id = 0) {
  const errors = {};
  const name = str(body.name, 120);
  if (name.length < 2) errors.name = 'Enter a product name';
  const categoryId = Number(body.category_id);
  if (!db.prepare('SELECT 1 FROM categories WHERE id=?').get(categoryId)) errors.category_id = 'Choose a category';
  const taxId = body.tax_class_id ? Number(body.tax_class_id) : null;
  if (taxId && !db.prepare('SELECT 1 FROM tax_classes WHERE id=?').get(taxId)) errors.tax_class_id = 'Choose a tax class';
  const hsn = str(body.hsn, 8);
  if (hsn && !/^\d{4,8}$/.test(hsn)) errors.hsn = 'HSN code is 4–8 digits';
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#B07A45';
  const image = typeof body.image === 'string' && /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp)$/.test(body.image) ? body.image : null;
  const slug = slugify(body.slug || name);
  if (!slug) errors.slug = 'Enter a URL slug';
  else if (db.prepare('SELECT 1 FROM products WHERE slug=? AND id != ?').get(slug, id)) errors.slug = 'This slug is already used';

  const variants = Array.isArray(body.variants) ? body.variants.slice(0, 20) : [];
  const vErrors = [];
  const seenSku = new Set();
  const cleanV = variants.map((v, i) => {
    const e = {};
    const out = { id: v.id ? Number(v.id) : null, label: str(v.label, 30), grams: int(v.grams), price: int(v.price), mrp: int(v.mrp), stock: int(v.stock),
      sku: str(v.sku, 40).toUpperCase().replace(/\s+/g, '-') };
    if (!out.label) e.label = 'Required';
    if (!(out.grams > 0)) e.grams = 'Weight in grams';
    if (!(out.price > 0)) e.price = 'Price must be above 0';
    if (!(out.mrp >= out.price)) e.mrp = 'MRP must be ≥ price';
    if (!(out.stock >= 0)) e.stock = '0 or more';
    if (!out.sku) out.sku = `${slug}-${out.grams || i}g-${crypto.randomBytes(2).toString('hex')}`.toUpperCase();
    if (seenSku.has(out.sku)) e.sku = 'Duplicate SKU';
    else if (db.prepare('SELECT 1 FROM variants WHERE sku=? AND product_id != ?').get(out.sku, id)) e.sku = 'SKU used by another product';
    seenSku.add(out.sku);
    if (Object.keys(e).length) vErrors[i] = e;
    return out;
  });
  if (!cleanV.length) errors.variants = 'Add at least one pack size';
  if (vErrors.length) errors.variants = 'Check the pack sizes';

  const benefits = (Array.isArray(body.benefits) ? body.benefits : String(body.benefits || '').split('\n'))
    .map((b) => str(b, 80).replace(/\|/g, '/')).filter(Boolean).slice(0, 8).join('|');

  return {
    errors, vErrors,
    data: { name, slug, category_id: categoryId, tax_class_id: taxId, hsn: hsn || null, short: str(body.short, 160),
      description: str(body.description, 4000), benefits, origin: str(body.origin, 80), shelf_life: str(body.shelf_life, 40),
      color, shape: SHAPES.includes(body.shape) ? body.shape : 'mix', image, featured: body.featured ? 1 : 0, is_active: body.is_active === false ? 0 : 1 },
    variants: cleanV,
  };
}

function saveVariants(productId, variants) {
  const existing = db.prepare('SELECT id FROM variants WHERE product_id=? AND is_active=1').all(productId).map((r) => r.id);
  const keep = new Set(variants.filter((v) => v.id && existing.includes(v.id)).map((v) => v.id));
  // Remove dropped pack sizes first so their SKUs can be reused
  for (const id of existing.filter((x) => !keep.has(x))) {
    const used = db.prepare('SELECT 1 FROM order_items WHERE variant_id=?').get(id);
    if (used) db.prepare("UPDATE variants SET is_active=0, sku = sku || '-ARCH-' || id WHERE id=?").run(id); // keep for order history
    else db.prepare('DELETE FROM variants WHERE id=?').run(id);
  }
  // Clear SKUs of kept rows temporarily so pack sizes can swap SKUs without a unique clash
  for (const id of keep) db.prepare("UPDATE variants SET sku = 'TMP-' || id WHERE id=?").run(id);
  const upd = db.prepare('UPDATE variants SET label=?, grams=?, price=?, mrp=?, stock=?, sku=? WHERE id=? AND product_id=?');
  const ins = db.prepare('INSERT INTO variants (product_id,label,grams,price,mrp,stock,sku) VALUES (?,?,?,?,?,?,?)');
  for (const v of variants) {
    if (v.id && keep.has(v.id)) upd.run(v.label, v.grams, v.price, v.mrp, v.stock, v.sku, v.id, productId);
    else ins.run(productId, v.label, v.grams, v.price, v.mrp, v.stock, v.sku);
  }
}

router.post('/products', (req, res) => {
  const { errors, vErrors, data, variants } = productInput(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', errors, variantErrors: vErrors });
  const id = tx(() => {
    const info = db.prepare(`INSERT INTO products (name,slug,category_id,tax_class_id,hsn,short,description,benefits,origin,shelf_life,color,shape,image,featured,is_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...Object.values(data));
    saveVariants(info.lastInsertRowid, variants);
    return info.lastInsertRowid;
  });
  res.status(201).json({ id, slug: data.slug });
});

router.patch('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(id)) return res.status(404).json({ error: 'Product not found' });
  const { errors, vErrors, data, variants } = productInput(req.body, id);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', errors, variantErrors: vErrors });
  tx(() => {
    db.prepare(`UPDATE products SET name=?, slug=?, category_id=?, tax_class_id=?, hsn=?, short=?, description=?, benefits=?, origin=?,
      shelf_life=?, color=?, shape=?, image=?, featured=?, is_active=? WHERE id=?`).run(...Object.values(data), id);
    saveVariants(id, variants);
  });
  res.json({ id, slug: data.slug });
});

// Quick toggles from the product list
router.patch('/products/:id/flags', (req, res) => {
  const id = Number(req.params.id);
  if ('is_active' in req.body) db.prepare('UPDATE products SET is_active=? WHERE id=?').run(req.body.is_active ? 1 : 0, id);
  if ('featured' in req.body) db.prepare('UPDATE products SET featured=? WHERE id=?').run(req.body.featured ? 1 : 0, id);
  res.json({ ok: true });
});

router.delete('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT 1 FROM order_items oi JOIN variants v ON v.id = oi.variant_id WHERE v.product_id = ?').get(id);
  if (used) {
    db.prepare('UPDATE products SET is_active=0 WHERE id=?').run(id);
    return res.json({ archived: true, note: 'This product has past orders, so it was hidden from the store instead of deleted.' });
  }
  db.prepare('DELETE FROM products WHERE id=?').run(id);
  res.json({ deleted: true });
});

// Image upload: JSON { dataUrl: "data:image/jpeg;base64,..." } (≤ 3 MB). Stored in data/uploads, served at /uploads.
router.post('/uploads', (req, res) => {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.dataUrl || '');
  if (!m) return bad(res, 'Upload a PNG, JPG or WebP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) return bad(res, 'Image must be under 3 MB.');
  const sig = buf.subarray(0, 12);
  const ok = (m[1] === 'png' && sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    || (m[1] === 'jpeg' && sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff)
    || (m[1] === 'webp' && sig.subarray(0, 4).toString() === 'RIFF' && sig.subarray(8, 12).toString() === 'WEBP');
  if (!ok) return bad(res, 'That file is not a valid image.');
  const name = `${crypto.randomBytes(12).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  res.status(201).json({ url: `/uploads/${name}` });
});

// ======================= Inventory & prices (bulk grid) =======================
router.get('/inventory', (_req, res) => {
  const tree = loadTree();
  res.json(db.prepare(`SELECT v.id, v.sku, p.id AS product_id, p.name, p.category_id, p.is_active, v.label, v.price, v.mrp, v.stock
    FROM variants v JOIN products p ON p.id=v.product_id WHERE v.is_active = 1 ORDER BY p.name, v.grams`).all()
    .map((r) => ({ ...r, category: tree.byId.get(r.category_id)?.name || '—' })));
});

router.patch('/inventory/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM variants WHERE id=?').get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Variant not found' });
  let stock = v.stock;
  if (req.body.adjust != null) stock = Math.max(0, v.stock + int(req.body.adjust));
  else if (req.body.stock != null) stock = Math.max(0, int(req.body.stock));
  const price = req.body.price != null ? int(req.body.price) : v.price;
  const mrp = req.body.mrp != null ? int(req.body.mrp) : v.mrp;
  if (![stock, price, mrp].every(Number.isFinite) || price <= 0 || mrp < price)
    return bad(res, 'Check the values: price must be positive and not above MRP.');
  db.prepare('UPDATE variants SET stock=?, price=?, mrp=? WHERE id=?').run(stock, price, mrp, v.id);
  res.json({ ok: true, stock });
});

// ======================= Taxes (GST classes) =======================
router.get('/taxes', (_req, res) => {
  res.json(db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM products p WHERE p.tax_class_id = t.id) AS products
    FROM tax_classes t ORDER BY rate_bp, name`).all().map((t) => ({ ...t, is_default: !!t.is_default })));
});

function taxInput(body) {
  const errors = {};
  const name = str(body.name, 60);
  const rate = Math.round(Number(body.rate_bp));
  if (name.length < 2) errors.name = 'Enter a name, e.g. GST 5%';
  if (!Number.isFinite(rate) || rate < 0 || rate > 5000) errors.rate_bp = 'Rate must be between 0% and 50%';
  return { errors, name, rate };
}
function setDefaultTax(id) { db.prepare('UPDATE tax_classes SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(id); }

router.post('/taxes', (req, res) => {
  const { errors, name, rate } = taxInput(req.body);
  if (Object.keys(errors).length) return bad(res, 'Please fix the highlighted fields.', errors);
  const id = tx(() => {
    const info = db.prepare('INSERT INTO tax_classes (name, rate_bp) VALUES (?, ?)').run(name, rate);
    if (req.body.is_default) setDefaultTax(info.lastInsertRowid);
    return info.lastInsertRowid;
  });
  res.status(201).json({ id });
});

router.patch('/taxes/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM tax_classes WHERE id=?').get(id)) return res.status(404).json({ error: 'Tax class not found' });
  const { errors, name, rate } = taxInput(req.body);
  if (Object.keys(errors).length) return bad(res, 'Please fix the highlighted fields.', errors);
  tx(() => {
    db.prepare('UPDATE tax_classes SET name=?, rate_bp=? WHERE id=?').run(name, rate, id);
    if (req.body.is_default) setDefaultTax(id);
  });
  res.json({ ok: true });
});

router.delete('/taxes/:id', (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM tax_classes WHERE id=?').get(id);
  if (!t) return res.status(404).json({ error: 'Tax class not found' });
  if (t.is_default) return bad(res, 'Make another tax class the default before deleting this one.');
  const n = db.prepare('SELECT COUNT(*) n FROM products WHERE tax_class_id=?').get(id).n;
  if (n) return bad(res, `${n} product(s) use this tax class. Change them first.`);
  db.prepare('DELETE FROM tax_classes WHERE id=?').run(id);
  res.json({ ok: true });
});

// ======================= Shipping zones =======================
router.get('/shipping-zones', (_req, res) => {
  res.json(db.prepare('SELECT * FROM shipping_zones ORDER BY sort, id').all()
    .map((z) => ({ ...z, states: JSON.parse(z.states || '[]'), is_active: !!z.is_active })));
});

function zoneInput(body, id = 0) {
  const errors = {};
  const name = str(body.name, 60);
  if (name.length < 2) errors.name = 'Enter a zone name';
  const states = [...new Set(Array.isArray(body.states) ? body.states : [])].filter((s) => STATES.includes(s));
  if (!states.length) errors.states = 'Pick at least one state';
  const others = db.prepare('SELECT name, states FROM shipping_zones WHERE id != ?').all(id);
  for (const z of others) {
    const clash = JSON.parse(z.states).filter((s) => states.includes(s));
    if (clash.length) { errors.states = `${clash.join(', ')} already belong(s) to “${z.name}”`; break; }
  }
  const fee = int(body.fee), freeAbove = int(body.free_above);
  if (!(fee >= 0)) errors.fee = 'Enter a fee (0 for free)';
  if (!(freeAbove >= 0)) errors.free_above = 'Enter 0 to never make it free';
  return { errors, data: { name, states: JSON.stringify(states), fee, free_above: freeAbove, is_active: body.is_active === false ? 0 : 1, sort: int(body.sort) || 0 } };
}

router.post('/shipping-zones', (req, res) => {
  const { errors, data } = zoneInput(req.body);
  if (Object.keys(errors).length) return bad(res, 'Please fix the highlighted fields.', errors);
  const info = db.prepare('INSERT INTO shipping_zones (name,states,fee,free_above,is_active,sort) VALUES (?,?,?,?,?,?)').run(...Object.values(data));
  res.status(201).json({ id: info.lastInsertRowid });
});
router.patch('/shipping-zones/:id', (req, res) => {
  const id = Number(req.params.id);
  const { errors, data } = zoneInput(req.body, id);
  if (Object.keys(errors).length) return bad(res, 'Please fix the highlighted fields.', errors);
  db.prepare('UPDATE shipping_zones SET name=?, states=?, fee=?, free_above=?, is_active=?, sort=? WHERE id=?').run(...Object.values(data), id);
  res.json({ ok: true });
});
router.delete('/shipping-zones/:id', (req, res) => {
  db.prepare('DELETE FROM shipping_zones WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ======================= Store settings =======================
router.get('/settings', (_req, res) => res.json(settings.all()));
router.patch('/settings', (req, res) => {
  const r = settings.update(req.body);
  if (r.errors) return bad(res, 'Please fix the highlighted fields.', r.errors);
  res.json(r.settings);
});

module.exports = router;
