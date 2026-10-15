require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const config = require('./src/config');
require('./src/db'); // creates + seeds the database
const { attachUser } = require('./src/auth');
const catalog = require('./src/routes/catalog');
const account = require('./src/routes/account');
const orders = require('./src/routes/orders');
const admin = require('./src/routes/admin');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
      frameSrc: ["'self'", 'https://*.razorpay.com'],
      connectSrc: ["'self'", 'https://*.razorpay.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      formAction: ["'self'", 'https://*.razorpay.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Webhook needs the raw body to verify Razorpay's signature — register before express.json()
app.post('/api/payments/razorpay-webhook', express.raw({ type: 'application/json', limit: '1mb' }), orders.webhook);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(attachUser);

// CSRF guard: state-changing API calls must be JSON from our own pages (SameSite=Lax cookie + JSON-only)
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.is('application/json')) return res.status(415).json({ error: 'Expected JSON' });
  next();
});

app.use('/api', catalog);
app.use('/api/auth', account);
app.use('/api/orders', orders.router);
app.use('/api/admin', admin);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProd ? '1h' : 0 }));
// Single-page app: every non-API route serves index.html
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 && !err.status
    ? 'Something went wrong on our side. Please try again.'
    : err.message || err.error?.description;
  res.status(status).json({ error: message, ...(err.extra || {}) });
});

app.listen(config.port, () => {
  console.log(`${config.store.name} running at http://localhost:${config.port}`);
  console.log(config.razorpay.enabled ? 'Razorpay: live/test keys loaded'
    : config.demoPayments ? 'Razorpay keys not set — DEMO payments enabled for local testing' : 'Razorpay not configured — COD only');
});
