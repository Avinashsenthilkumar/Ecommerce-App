const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) throw new Error('JWT_SECRET must be set in production');
  jwtSecret = crypto.randomBytes(32).toString('hex'); // dev only: sessions reset on restart
  console.warn('JWT_SECRET not set — using a temporary secret (logins reset on restart).');
}

const razorpay = {
  keyId: process.env.RAZORPAY_KEY_ID || '',
  keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
};
razorpay.enabled = Boolean(razorpay.keyId && razorpay.keySecret);

// Demo payments let you test the full flow locally without Razorpay keys.
// They are never available in production.
const demoPayments = !razorpay.enabled && !isProd;

module.exports = {
  isProd,
  port: Number(process.env.PORT || 3000),
  jwtSecret,
  razorpay,
  demoPayments,
  // Store details, shipping, COD and tax settings live in the database (src/settings.js)
  // and are edited from Admin → Settings / Shipping. .env values are first-run defaults.
};
