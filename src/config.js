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
  store: {
    name: process.env.STORE_NAME || 'Kernel & Co.',
    tagline: process.env.STORE_TAGLINE || 'Honest nuts, seeds & dry fruits — packed fresh in India',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
    supportPhone: process.env.SUPPORT_PHONE || '+91 90000 00000',
    gstin: process.env.STORE_GSTIN || '',
    fssai: process.env.STORE_FSSAI || '',
  },
  // Shipping rules (paise)
  freeShippingAbove: Number(process.env.FREE_SHIPPING_ABOVE || 499) * 100,
  shippingFee: Number(process.env.SHIPPING_FEE || 49) * 100,
  codEnabled: process.env.COD_ENABLED !== 'false',
  codMaxOrder: Number(process.env.COD_MAX_ORDER || 5000) * 100,
};
