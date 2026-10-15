# Kernel & Co. — Nuts, Seeds & Healthy Foods Store

A complete, mobile-first e-commerce site for an India-based packer of nuts, seeds, dry fruits and healthy snacks.

**Stack:** Node.js 22 + Express 5 · SQLite (Node's built-in driver, no native build) · vanilla JS storefront · Razorpay payments.

## Features

| Area | What's included |
|---|---|
| Storefront | Home, category pages, search, sort, product pages with pack-size variants (250 g / 500 g / 1 kg), MRP vs price and % off, stock limits, related products |
| Cart | Persistent cart (survives refresh), quantity changes, free-shipping progress meter, server-side price re-check |
| Checkout | **Guest checkout** (email only) or logged-in checkout with saved addresses; Indian address validation (36 states/UTs, 6-digit PIN, 10-digit mobile) |
| Payments | **Razorpay** (UPI, cards, net banking, wallets) with server-side signature verification + webhook; **Cash on Delivery** with a configurable order cap; retry payment for unpaid orders |
| Accounts | Self-registration, login/logout, profile & password change, order history, saved addresses. Guest orders are auto-linked when that email registers later |
| Order tracking | Guests track with order no. + email; secure per-order link; status timeline (confirmed → packed → shipped → delivered) |
| Admin desk | `/admin` — today's sales, orders to ship, search/filter orders, change status (cancel restores stock), edit price/MRP/stock, low-stock flag |
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
* `npm run reset-db` deletes the database; it re-seeds 16 sample products on next start.

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
src/config.js          env-driven settings (store details, shipping, COD, Razorpay)
src/db.js              schema + seed catalogue + admin user
src/auth.js            session cookie / role middleware
src/validate.js        Indian address, phone, PIN validation
src/routes/catalog.js  categories, products, public config
src/routes/account.js  register, login, profile, addresses
src/routes/orders.js   quote, place order, Razorpay verify/webhook, tracking
src/routes/admin.js    stats, order status, inventory
public/                storefront (index.html, css/style.css, js/app.js)
```

## Customising

* **Brand:** `STORE_NAME`, tagline, support contacts, FSSAI, GSTIN in `.env`; colours are CSS variables at the top of `public/css/style.css`.
* **Products:** edit the seed list in `src/db.js` (then `npm run reset-db`), or change prices/stock live from the admin desk.
* **Product images:** the site generates illustrated artwork per product so it looks complete out of the box. To use real photos, add an `image` column to `products` and render `<img>` in `productCard()` / the product page in `app.js`.
* **Shipping rules:** `FREE_SHIPPING_ABOVE`, `SHIPPING_FEE`, `COD_ENABLED`, `COD_MAX_ORDER`.

## Suggested next steps

Order emails/SMS (e.g. SES, MSG91), shipping integration (Shiprocket/Delhivery) with AWB tracking, coupon codes, GST tax invoices (PDF), password reset by email, product photo upload in admin, and Salesforce sync (Commerce Cloud or Service Cloud for orders & customers) if the client runs Salesforce.
