# Kernel & Co. — Nuts, Seeds & Healthy Foods Store

A complete, mobile-first e-commerce site for an India-based packer of nuts, seeds, dry fruits and healthy snacks.

**Stack:** Node.js 22 + Express 5 · SQLite (Node's built-in driver, no native build) · vanilla JS storefront · Razorpay payments.

## Features

| Area | What's included |
|---|---|
| Storefront | Home, search, sort, product pages with pack-size variants (250 g / 500 g / 1 kg), MRP vs price and % off, GST note, stock limits, related products, product photos (or generated artwork) |
| Multi-level categories | Unlimited nesting (e.g. Healthy Snacks › Makhana › Flavoured Makhana). Desktop mega-menu, mobile slide-in drawer, sidebar tree, sub-category chips and full breadcrumbs. Parent pages include products from all sub-categories |
| Cart | Persistent cart (survives refresh), quantity changes, free-shipping progress meter, server-side price re-check |
| Checkout | **Guest checkout** (email only) or logged-in checkout with saved addresses; Indian address validation (36 states/UTs, 6-digit PIN, 10-digit mobile) |
| Payments | **Razorpay** (UPI, cards, net banking, wallets) with server-side signature verification + webhook; **Cash on Delivery** with a configurable order cap; retry payment for unpaid orders |
| Accounts | Self-registration, login/logout, profile & password change, order history, saved addresses. Guest orders are auto-linked when that email registers later |
| Order tracking | Guests track with order no. + email; secure per-order link; status timeline (confirmed → packed → shipped → delivered) |
| Admin back office | `/admin` with tabs: **Orders** (search, status, cancel restores stock) · **Products** (create/edit/delete, photo upload, pack sizes with price/MRP/stock/SKU, GST class, HSN, live/featured toggles) · **Categories** (add/edit/nest/hide/delete with safety checks) · **Stock & prices** (bulk grid, +/- stock adjustments, low-stock filter) · **Taxes** (GST classes, default class, prices incl./excl. GST) · **Shipping** (standard fee, free-shipping threshold, COD on/off, COD limit & charge, state-based zones) · **Settings** (store name, contacts, address, GSTIN, FSSAI) |
| GST | Per-product tax class; tax computed per line, stored on each order line with rate and HSN code; summary by rate shown at checkout. Works with tax-inclusive (default) or tax-exclusive pricing |
| Shipping | Standard fee + free-above threshold, plus zones by state (seeded: North-East & Islands, J&K & Ladakh). Checkout recalculates as soon as the customer picks a state |
| Compliance | Contact, shipping, cancellation & refund, privacy, terms pages (Razorpay requires these for account activation); FSSAI & GSTIN shown in footer |
| Security | Prices always computed on the server, bcrypt passwords, httpOnly JWT cookie, JSON-only API (CSRF guard), rate limits on login/orders, Helmet CSP, timing-safe signature checks |

## Run locally

```bash
npm install
cp .env.example .env      # optional locally
npm start                 # http://localhost:3000
```

* Admin: `admin@example.com` / `ChangeMe@123` (set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` **before first start**).
* Without Razorpay keys, "Pay online" opens a **demo payment** window so you can test the whole flow. Demo mode is switched off automatically when `NODE_ENV=production`.
* `npm run reset-db` deletes the database; it re-seeds 16 sample products in a 3-level category tree on next start. Existing databases are upgraded automatically (new columns are added on start).
* Uploaded product photos are stored in `data/uploads/` — back this folder up together with `data/store.db`.

## Going live with Razorpay

1. Create an account at dashboard.razorpay.com and complete KYC (needs the policy pages — edit their text in `public/js/app.js` → `PAGES`, and fill in your registered address).
2. Put **test** keys (`rzp_test_…`) into `.env` → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`; place a test order with Razorpay's test UPI/cards.
3. Dashboard → Webhooks → add `https://YOURDOMAIN/api/payments/razorpay-webhook`, events `payment.captured`, `order.paid`, `payment.failed`; copy the secret into `RAZORPAY_WEBHOOK_SECRET`. The webhook confirms orders even if a customer closes the browser right after paying.
4. Swap to live keys after activation. Refunds for cancelled prepaid orders are issued from the Razorpay dashboard (the admin desk reminds you).

## Deploying

Any Node 22.13+ host works (Render, Railway, a VPS with PM2 + Nginx, AWS Lightsail…).

* Set `NODE_ENV=production`, a long random `JWT_SECRET`, and serve over **HTTPS** (cookies are `Secure` in production).
* SQLite lives in `data/store.db` — put it on a persistent disk and back it up daily. For high volume or multiple servers, move to PostgreSQL (the SQL is plain and portable).

## Project layout

```
server.js              Express app, security headers, routing
src/config.js          env settings (port, secrets, Razorpay)
src/settings.js        admin-editable store/shipping/COD/tax settings
src/pricing.js         cart pricing: GST per line, zone shipping, COD fee
src/categories.js      category tree helpers
src/db.js              schema + seed catalogue + admin user
src/auth.js            session cookie / role middleware
src/validate.js        Indian address, phone, PIN validation
src/routes/catalog.js  categories, products, public config
src/routes/account.js  register, login, profile, addresses
src/routes/orders.js   quote, place order, Razorpay verify/webhook, tracking
src/routes/admin.js    back-office APIs: orders, products, categories, uploads, stock, taxes, zones, settings
public/                storefront (index.html, css/style.css, js/app.js) + js/admin.js (loaded only for admins)
```

## Customising

* **Everything operational** (catalogue, categories, prices, stock, GST, shipping, COD, store details) is managed in the admin back office. Values in `.env` are only first-run defaults.
* **Brand colours** are CSS variables at the top of `public/css/style.css`.
* **GST rates & HSN codes** in the sample data are placeholders — confirm them with the client's CA before going live.

## Suggested next steps

Order emails/SMS (e.g. SES, MSG91), shipping integration (Shiprocket/Delhivery) with AWB tracking, coupon codes, GST tax invoices (PDF — the per-line GST and HSN data is already stored), bulk CSV product import, password reset by email, product photo upload in admin, and Salesforce sync (Commerce Cloud or Service Cloud for orders & customers) if the client runs Salesforce.
