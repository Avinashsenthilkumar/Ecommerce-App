const express = require('express');
const { db } = require('../db');
const config = require('../config');
const settings = require('../settings');
const { loadTree } = require('../categories');
const { shippingZones, defaultTaxClass } = require('../pricing');
const { STATES } = require('../validate');

const router = express.Router();

const PRODUCT_SQL = `SELECT p.id, p.slug, p.name, p.short, p.description, p.benefits, p.origin, p.shelf_life, p.color, p.shape,
  p.featured, p.image, p.hsn, p.category_id, t.rate_bp AS tax_rate
  FROM products p LEFT JOIN tax_classes t ON t.id = p.tax_class_id WHERE p.is_active = 1`;

function decorate(products, tree) {
  if (!products.length) return [];
  const ids = products.map((p) => p.id);
  const vars = db.prepare(
    `SELECT id, product_id, label, grams, price, mrp, stock FROM variants
     WHERE is_active = 1 AND product_id IN (${ids.map(() => '?').join(',')}) ORDER BY grams, price`
  ).all(...ids);
  const defRate = defaultTaxClass().rate_bp;
  return products.map((p) => {
    const cat = tree.byId.get(p.category_id);
    return {
      ...p,
      tax_rate: p.tax_rate ?? defRate,
      benefits: p.benefits ? p.benefits.split('|').filter(Boolean) : [],
      featured: !!p.featured,
      category: cat?.slug, category_name: cat?.name,
      path: cat ? tree.path(cat).map((c) => ({ slug: c.slug, name: c.name })) : [],
      variants: vars.filter((v) => v.product_id === p.id).map(({ product_id, ...v }) => v),
    };
  }).filter((p) => p.variants.length);
}

router.get('/config', (_req, res) => {
  const s = settings.all();
  res.json({
    store: {
      name: s.store_name, tagline: s.store_tagline, supportEmail: s.support_email, supportPhone: s.support_phone,
      address: s.store_address, gstin: s.store_gstin, fssai: s.store_fssai,
    },
    pricesIncludeTax: s.prices_include_tax,
    freeShippingAbove: s.free_shipping_above,
    shippingFee: s.shipping_fee,
    shippingZones: shippingZones().map((z) => ({ name: z.name, states: z.states, fee: z.fee, freeAbove: z.free_above })),
    codEnabled: s.cod_enabled, codMaxOrder: s.cod_max_order, codFee: s.cod_fee,
    razorpay: config.razorpay.enabled,
    demoPayments: config.demoPayments,
    states: STATES,
  });
});

// Nested tree of visible categories with product counts (including sub-categories)
router.get('/categories', (_req, res) => {
  const tree = loadTree();
  const counts = Object.fromEntries(db.prepare(
    `SELECT p.category_id id, COUNT(*) n FROM products p WHERE p.is_active = 1
     AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1) GROUP BY p.category_id`
  ).all().map((r) => [r.id, r.n]));
  const shape = (n) => {
    const children = n.children.filter((c) => c.visible).map(shape);
    return { slug: n.slug, name: n.name, blurb: n.blurb, count: (counts[n.id] || 0) + children.reduce((a, c) => a + c.count, 0), children };
  };
  res.json(tree.roots.filter((r) => r.visible).map(shape));
});

router.get('/products', (req, res) => {
  const tree = loadTree();
  let catIds = tree.visibleIds();
  if (req.query.category) {
    const node = tree.bySlug.get(String(req.query.category));
    if (!node || !node.visible) return res.json([]);
    catIds = tree.descendants(node).filter((id) => tree.byId.get(id).visible);
  }
  if (!catIds.length) return res.json([]);
  let sql = `${PRODUCT_SQL} AND p.category_id IN (${catIds.map(() => '?').join(',')})`;
  const args = [...catIds];
  if (req.query.featured) sql += ' AND p.featured = 1';
  if (req.query.q) {
    sql += ' AND (p.name LIKE ? OR p.short LIKE ? OR p.description LIKE ?)';
    const q = `%${String(req.query.q).slice(0, 50)}%`;
    args.push(q, q, q);
  }
  sql += ' ORDER BY p.featured DESC, p.name LIMIT 500';
  res.json(decorate(db.prepare(sql).all(...args), tree));
});

router.get('/products/:slug', (req, res) => {
  const tree = loadTree();
  const row = db.prepare(`${PRODUCT_SQL} AND p.slug = ?`).get(req.params.slug);
  const cat = row && tree.byId.get(row.category_id);
  if (!row || !cat?.visible) return res.status(404).json({ error: 'Product not found' });
  const [product] = decorate([row], tree);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const related = decorate(db.prepare(`${PRODUCT_SQL} AND p.category_id = ? AND p.id != ? LIMIT 4`).all(row.category_id, row.id), tree);
  res.json({ product, related });
});

module.exports = router;
