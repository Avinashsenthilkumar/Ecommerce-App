// SQLite storage using Node's built-in driver (no native build needed).
// All money values are stored as integer paise (₹1 = 100 paise).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'store.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT NOT NULL,
  line1 TEXT NOT NULL, line2 TEXT, city TEXT NOT NULL,
  state TEXT NOT NULL, pincode TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, blurb TEXT, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  short TEXT, description TEXT, benefits TEXT, origin TEXT,
  shelf_life TEXT, color TEXT DEFAULT '#B07A45', shape TEXT DEFAULT 'oval',
  featured INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL, grams INTEGER NOT NULL,
  price INTEGER NOT NULL, mrp INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0, sku TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  email TEXT NOT NULL, phone TEXT NOT NULL, name TEXT NOT NULL,
  address TEXT NOT NULL,
  subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'pending',
  razorpay_order_id TEXT, razorpay_payment_id TEXT,
  stock_applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  product_name TEXT NOT NULL, label TEXT NOT NULL,
  unit_price INTEGER NOT NULL, qty INTEGER NOT NULL, line_total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_rzp ON orders(razorpay_order_id);
`);

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- Seed catalogue (only on an empty database) ----------
function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (count > 0) return;

  const cats = [
    ['dry-fruits', 'Dry Fruits & Nuts', 'Hand-graded almonds, cashews, walnuts and pistachios.', 1],
    ['seeds', 'Seeds', 'Chia, flax, pumpkin, sunflower — the everyday superfoods.', 2],
    ['dates-berries', 'Dates & Berries', 'Naturally sweet, no added sugar.', 3],
    ['mixes-snacks', 'Mixes & Healthy Snacks', 'Trail mixes, makhana and roasted bites.', 4],
  ];
  const insCat = db.prepare('INSERT INTO categories (slug,name,blurb,sort) VALUES (?,?,?,?)');
  const catId = {};
  for (const c of cats) catId[c[0]] = insCat.run(...c).lastInsertRowid;

  // [slug, name, cat, short, description, benefits, origin, shelf, color, shape, featured, variants[[label,grams,price₹,mrp₹,stock]]]
  const P = [
    ['california-almonds', 'California Almonds', 'dry-fruits', 'Crunchy, premium-grade whole almonds',
      'Large, uniform California almonds, sorted by hand and vacuum-packed to keep their crunch. Great soaked overnight or as a mid-day snack.',
      'Rich in Vitamin E|Plant protein & fibre|Heart-friendly fats', 'USA (packed in India)', '9 months', '#B9804E', 'almond', 1,
      [['250 g', 250, 289, 349, 120], ['500 g', 500, 549, 680, 90], ['1 kg', 1000, 1049, 1320, 40]]],
    ['mamra-almonds', 'Mamra Almonds', 'dry-fruits', 'Rare, oil-rich Mamra variety',
      'The prized Mamra almond — smaller, more concave and naturally higher in oil. Sourced in limited lots.',
      'High natural oil content|Traditional winter food|No preservatives', 'Iran / Afghanistan', '9 months', '#9A6538', 'almond', 0,
      [['250 g', 250, 649, 799, 40], ['500 g', 500, 1249, 1550, 20]]],
    ['w240-cashews', 'Whole Cashews W240', 'dry-fruits', 'Goa & Kerala cashews, W240 grade',
      'W240 whole cashews — creamy, large and evenly white. Processed at partner units in Kerala.',
      'Source of magnesium & zinc|Creamy texture|Perfect for gravies', 'Kerala, India', '6 months', '#E6C99A', 'cashew', 1,
      [['250 g', 250, 299, 360, 150], ['500 g', 500, 579, 720, 80], ['1 kg', 1000, 1129, 1400, 35]]],
    ['kashmiri-walnuts', 'Kashmiri Walnut Kernels', 'dry-fruits', 'Light halves from Kashmir valley',
      'Light-coloured walnut halves (extra light grade) from orchards in the Kashmir valley.',
      'Plant omega-3 (ALA)|Antioxidant-rich|Brain-food favourite', 'Jammu & Kashmir, India', '6 months', '#A9773F', 'walnut', 1,
      [['250 g', 250, 399, 480, 70], ['500 g', 500, 769, 940, 40]]],
    ['roasted-pistachios', 'Roasted Salted Pistachios', 'dry-fruits', 'In-shell, lightly salted',
      'Dry-roasted in-shell pistachios with a light touch of Himalayan pink salt.',
      'Protein & fibre|Lightly salted|Easy-open shells', 'Iran / USA', '6 months', '#8FA35A', 'pistachio', 0,
      [['200 g', 200, 349, 420, 60], ['500 g', 500, 829, 999, 25]]],
    ['chia-seeds', 'Chia Seeds', 'seeds', 'Cleaned, ready to soak',
      'Machine-cleaned black chia seeds. Add to water, smoothies, puddings or overnight oats.',
      'Fibre-rich|Omega-3 (ALA)|Gluten free', 'Madhya Pradesh, India', '12 months', '#4C4A47', 'seed', 1,
      [['250 g', 250, 179, 249, 200], ['500 g', 500, 329, 449, 120], ['1 kg', 1000, 599, 849, 60]]],
    ['flax-seeds', 'Roasted Flax Seeds', 'seeds', 'Lightly roasted, nutty flavour',
      'Brown flax seeds, lightly dry-roasted for a nutty taste. Grind fresh and sprinkle on rotis, curd or salads.',
      'Lignans & fibre|Omega-3 (ALA)|Roasted, ready to eat', 'Chhattisgarh, India', '9 months', '#8A5A33', 'seed', 0,
      [['250 g', 250, 99, 140, 200], ['500 g', 500, 179, 260, 150]]],
    ['pumpkin-seeds', 'Pumpkin Seeds', 'seeds', 'Raw, unsalted green kernels',
      'Shelled raw pumpkin seeds (pepitas). Snack as-is or roast with a pinch of salt.',
      'Rich in zinc & magnesium|Plant protein|Unsalted', 'India', '9 months', '#6E8B4E', 'seed', 1,
      [['250 g', 250, 219, 299, 140], ['500 g', 500, 419, 560, 70]]],
    ['sunflower-seeds', 'Sunflower Seeds', 'seeds', 'Raw, shelled kernels',
      'Shelled sunflower kernels. Toss into poha, upma, salads and homemade granola.',
      'Vitamin E|Healthy fats|Unsalted', 'Karnataka, India', '9 months', '#9C9480', 'seed', 0,
      [['250 g', 250, 139, 190, 160], ['500 g', 500, 259, 360, 90]]],
    ['seed-mix', 'Super Seed Mix', 'seeds', 'Chia · flax · pumpkin · sunflower · melon',
      'A balanced blend of five seeds — one spoon a day over breakfast covers your seed habit.',
      'Five seeds in one|Ready to eat|No added salt', 'India', '6 months', '#7C6A4E', 'seed', 1,
      [['200 g', 200, 199, 260, 130], ['400 g', 400, 379, 499, 70]]],
    ['medjool-dates', 'Medjool Dates', 'dates-berries', 'Large, soft & caramel-like',
      'Jumbo Medjool dates with a soft, caramel bite. Naturally sweet — no syrup, no sugar coat.',
      'Natural energy|Potassium & fibre|No added sugar', 'Jordan / Palestine', '6 months', '#6B3A22', 'date', 1,
      [['250 g', 250, 449, 549, 80], ['500 g', 500, 869, 1060, 40]]],
    ['afghani-raisins', 'Afghani Black Raisins', 'dates-berries', 'Seedless, sun-dried',
      'Seedless long black raisins, sun-dried. Soak a handful overnight for a traditional morning start.',
      'Iron source|Sun-dried|Seedless', 'Afghanistan', '9 months', '#3F2A2E', 'raisin', 0,
      [['250 g', 250, 199, 260, 120], ['500 g', 500, 379, 499, 60]]],
    ['dried-cranberries', 'Dried Cranberries', 'dates-berries', 'Sliced, lightly sweetened',
      'Sliced dried cranberries — tart, chewy and great in trail mixes, salads and baking.',
      'Antioxidants|Chewy & tart|Baking-ready', 'USA (packed in India)', '9 months', '#9B2D3A', 'raisin', 0,
      [['200 g', 200, 249, 320, 90]]],
    ['trail-mix', 'Classic Trail Mix', 'mixes-snacks', 'Almonds, cashews, cranberries, seeds',
      'Our bestselling on-the-go mix: almonds, cashews, raisins, cranberries, pumpkin and sunflower seeds.',
      'Balanced energy|No added sugar|Desk-drawer friendly', 'Packed in India', '6 months', '#A0673A', 'mix', 1,
      [['200 g', 200, 259, 330, 150], ['400 g', 400, 489, 640, 80]]],
    ['roasted-makhana', 'Roasted Makhana — Peri Peri', 'mixes-snacks', 'Fox nuts, roasted in olive oil',
      'Bihar makhana (fox nuts) roasted in olive oil and tossed in peri-peri seasoning.',
      'Low calorie crunch|Roasted not fried|Gluten free', 'Bihar, India', '6 months', '#E2C9A6', 'makhana', 1,
      [['80 g', 80, 129, 160, 220], ['3 x 80 g', 240, 359, 480, 80]]],
    ['plain-makhana', 'Premium Phool Makhana', 'mixes-snacks', 'Raw, large pop size (6 suta)',
      'Raw phool makhana, large 6-suta grade. Roast at home with ghee and a pinch of salt, or use for kheer.',
      'Light & crunchy|Fasting-friendly|Large size', 'Bihar, India', '9 months', '#EFE3CF', 'makhana', 0,
      [['100 g', 100, 159, 199, 150], ['250 g', 250, 369, 460, 70]]],
  ];

  const insP = db.prepare(`INSERT INTO products (slug,name,category_id,short,description,benefits,origin,shelf_life,color,shape,featured)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insV = db.prepare('INSERT INTO variants (product_id,label,grams,price,mrp,stock,sku) VALUES (?,?,?,?,?,?,?)');
  tx(() => {
    for (const p of P) {
      const [slug, name, cat, short, desc, ben, origin, shelf, color, shape, featured, vars] = p;
      const pid = insP.run(slug, name, catId[cat], short, desc, ben, origin, shelf, color, shape, featured).lastInsertRowid;
      for (const [label, grams, price, mrp, stock] of vars) {
        insV.run(pid, label, grams, price * 100, mrp * 100, stock, `${slug}-${grams}g`.toUpperCase());
      }
    }
  });

  // Admin account for the order desk
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'ChangeMe@123';
  db.prepare('INSERT OR IGNORE INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)')
    .run('Store Admin', adminEmail, '', bcrypt.hashSync(adminPass, 10), 'admin');
  console.log(`Seeded catalogue. Admin login: ${adminEmail}`);
}
seed();

module.exports = { db, tx };
