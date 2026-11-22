/**
 * POST /api/create-checkout — Creates a Stripe Checkout Session
 *
 * Security:
 * - The browser only sends Stripe Price IDs and quantities.
 * - Every Price ID is looked up again on the server before checkout.
 * - Prices must be active, one-time, USD, and belong to an active product.
 * - Amounts always come from Stripe, never from the browser.
 * - Success/cancel URLs are built server-side from SITE_URL.
 * - Shipping address is collected during checkout, but no flat shipping
 *   rate is charged; the session total is the product total.
 *
 * SETUP:
 * 1. Add STRIPE_SECRET_KEY to Vercel environment variables.
 * 2. Add SITE_URL (for example https://yehonam.com).
 * 3. Never expose STRIPE_SECRET_KEY in frontend code.
 */

const MAX_LINE_ITEMS = 20;
const MAX_QTY_PER_ITEM = 10;
const MAX_TOTAL_QTY = 50;
const ALLOWED_CURRENCY = 'usd';
const PRICE_ID_RE = /^price_[A-Za-z0-9]+$/;
const SITE_URL_FALLBACK = 'https://yehonam.com';

let stripeClient = null;

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) {
    try {
      stripeClient = require('stripe')(key);
    } catch {
      return null;
    }
  }
  return stripeClient;
}

// Vercel query/header values can be string | string[]
const first = (value) => (Array.isArray(value) ? value[0] : value);

function parseBody(req) {
  let body;
  try {
    body = req.body;
  } catch {
    return null;
  }

  if (body == null) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  return null;
}

function getSiteUrl() {
  const raw = process.env.SITE_URL || SITE_URL_FALLBACK;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Validate the shape of the submitted cart and merge duplicate Price IDs.
 * Returns { items } or { error }.
 */
function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'No items provided' };
  }
  if (rawItems.length > MAX_LINE_ITEMS) {
    return { error: 'Too many items in cart' };
  }

  const merged = new Map();

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: 'Invalid item' };
    }

    // Accept `priceId`; also accept the old `price` field, which held a Price ID.
    const priceId = typeof raw.priceId === 'string'
      ? raw.priceId
      : (typeof raw.price === 'string' ? raw.price : '');

    if (!PRICE_ID_RE.test(priceId) || priceId.length > 255) {
      return { error: 'Invalid item' };
    }

    if (typeof raw.quantity !== 'number' || !Number.isInteger(raw.quantity)) {
      return { error: 'Quantity must be a whole number' };
    }
    if (raw.quantity < 1 || raw.quantity > MAX_QTY_PER_ITEM) {
      return { error: `Quantity must be between 1 and ${MAX_QTY_PER_ITEM}` };
    }

    merged.set(priceId, (merged.get(priceId) || 0) + raw.quantity);
  }

  if (merged.size > MAX_LINE_ITEMS) {
    return { error: 'Too many items in cart' };
  }

  const items = [];
  let totalQuantity = 0;

  for (const [priceId, quantity] of merged) {
    if (quantity > MAX_QTY_PER_ITEM) {
      return { error: `Quantity must be between 1 and ${MAX_QTY_PER_ITEM}` };
    }
    totalQuantity += quantity;
    items.push({ priceId, quantity });
  }

  if (totalQuantity > MAX_TOTAL_QTY) {
    return { error: 'Cart quantity limit exceeded' };
  }

  return { items };
}

/**
 * Confirm a Price ID is still purchasable and belongs to an active product.
 * Returns the Stripe Price object, or null when it is not usable.
 */
async function validatePrice(stripe, priceId) {
  const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });

  if (!price || price.active !== true) return null;
  if (price.type !== 'one_time' || price.recurring) return null;
  if (price.currency !== ALLOWED_CURRENCY) return null;
  if (!Number.isInteger(price.unit_amount) || price.unit_amount <= 0) return null;

  let product = price.product;
  if (!product || typeof product === 'string') {
    if (!product) return null;
    product = await stripe.products.retrieve(product);
  }

  if (!product || product.active !== true || product.deleted === true) return null;

  return price;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = getStripe();
  if (!stripe) {
    console.error('Checkout configuration error: STRIPE_SECRET_KEY is missing or invalid');
    return res.status(503).json({ error: 'Checkout is not configured' });
  }

  const siteUrl = getSiteUrl();
  if (!siteUrl) {
    console.error('Checkout configuration error: SITE_URL is invalid');
    return res.status(503).json({ error: 'Checkout is not configured' });
  }

  const body = parseBody(req);
  if (!body) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const normalized = normalizeItems(body.items);
  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  try {
    // Re-check every price against Stripe. Any missing/inactive price blocks
    // the whole checkout instead of silently charging a different amount.
    const lineItems = await Promise.all(normalized.items.map(async (item) => {
      const price = await validatePrice(stripe, item.priceId);
      if (!price) return null;
      return { price: price.id, quantity: item.quantity };
    }));

    if (lineItems.some((item) => item === null)) {
      return res.status(400).json({ error: 'One or more items are no longer available' });
    }

    const totalQuantity = normalized.items.reduce((sum, item) => sum + item.quantity, 0);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: `${siteUrl}/confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/cart.html`,
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['GB', 'US', 'CA', 'AU', 'NG', 'GH', 'ZA', 'DE', 'FR', 'NL', 'IE'],
      },
      allow_promotion_codes: true,
      metadata: {
        source: 'yehonam-website',
        total_quantity: String(totalQuantity),
        created_at: new Date().toISOString(),
      },
    });

    if (!session || !session.url) {
      console.error('Checkout error: Stripe did not return a session URL');
      return res.status(502).json({ error: 'Unable to start checkout right now' });
    }

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    // Bad/expired Price IDs surface as StripeInvalidRequestError. Treat these
    // as a normal "item unavailable" response, not a server outage.
    if (error && (error.type === 'StripeInvalidRequestError' || error.code === 'resource_missing')) {
      console.error('Checkout validation error:', error.message);
      return res.status(400).json({ error: 'One or more items are no longer available' });
    }

    console.error('Checkout error:', error.message);
    return res.status(502).json({ error: 'Unable to start checkout right now' });
  }
};
