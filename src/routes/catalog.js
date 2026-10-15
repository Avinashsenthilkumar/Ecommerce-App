const express = require('express');
const { db } = require('../db');
const config = require('../config');
const { STATES } = require('../validate');

const router = express.Router();

function withVariants(products) {
  if (!products.length) return [];
  const ids = products.map((p) => p.id);
  const vars = db.prepare(
    `SELECT id,product_id,label,grams,price,mrp,stock FROM variants
     WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY grams`
  ).all(...ids);
  return products.map((p) => ({
    ...p,
    benefits: p.benefits ? p.benefits.split('|') : [],
    featured: !!p.featured,
    variants: vars.filter((v) => v.product_id === p.id).map(({ product_id, ...v }) => v),
  }));
}

const BASE = `SELECT p.id,p.slug,p.name,p.short,p.description,p.benefits,p.origin,p.shelf_life,p.color,p.shape,p.featured,
  c.slug AS category, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1`;

router.get('/config', (_req, res) => {
  res.json({
    store: config.store,
    freeShippingAbove: config.freeShippingAbove,
    shippingFee: config.shippingFee,
    codEnabled: config.codEnabled,
    codMaxOrder: config.codMaxOrder,
    razorpay: config.razorpay.enabled,
    demoPayments: config.demoPayments,
    states: STATES,
  });
});

router.get('/categories', (_req, res) => {
  res.json(db.prepare(`SELECT c.slug,c.name,c.blurb,
    (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.is_active=1) AS count
    FROM categories c ORDER BY sort`).all());
});

router.get('/products', (req, res) => {
  let sql = BASE;
  const args = [];
  if (req.query.category) { sql += ' AND c.slug = ?'; args.push(String(req.query.category)); }
  if (req.query.featured) sql += ' AND p.featured = 1';
  if (req.query.q) {
    sql += ' AND (p.name LIKE ? OR p.short LIKE ? OR c.name LIKE ?)';
    const q = `%${String(req.query.q).slice(0, 50)}%`;
    args.push(q, q, q);
  }
  sql += ' ORDER BY p.featured DESC, p.name';
  res.json(withVariants(db.prepare(sql).all(...args)));
});

router.get('/products/:slug', (req, res) => {
  const p = db.prepare(`${BASE} AND p.slug = ?`).get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const [product] = withVariants([p]);
  const related = withVariants(
    db.prepare(`${BASE} AND c.slug = ? AND p.id != ? LIMIT 4`).all(p.category, p.id)
  );
  res.json({ product, related });
});

module.exports = router;
