/**
 * GET /api/get-product?id=prod_xxx — Fetches one active product from Stripe
 *
 * Returns every active, one-time, USD Price for the product so the page can
 * map a size/variant button to a real Stripe Price ID. The product is not
 * purchasable when no usable price exists.
 *
 * SETUP: Add STRIPE_SECRET_KEY to Vercel environment variables.
 */

const MAX_PAGES = 10;
const ALLOWED_CURRENCY = 'usd';
const PRODUCT_ID_RE = /^prod_[A-Za-z0-9]+$/;

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

// Vercel query params can be string | string[]
const first = (value) => (Array.isArray(value) ? value[0] : value);

function safeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function safeImageUrl(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > 2048) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function safeImages(images) {
  if (!Array.isArray(images)) return [];
  return images.map(safeImageUrl).filter(Boolean).slice(0, 8);
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof key === 'string' && key.length <= 100 && typeof value === 'string' && value.length <= 500) {
      clean[key] = value;
    }
  }
  return clean;
}

function usablePrice(price) {
  if (!price || typeof price !== 'object') return false;
  if (price.active !== true) return false;
  if (price.type !== 'one_time' || price.recurring) return false;
  if (price.currency !== ALLOWED_CURRENCY) return false;
  if (!Number.isInteger(price.unit_amount) || price.unit_amount <= 0) return false;
  return true;
}

function variantLabel(price) {
  const candidates = [
    price.nickname,
    price.metadata && price.metadata.size,
    price.metadata && price.metadata.variant,
    price.metadata && price.metadata.label,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, 60);
    }
  }
  return '';
}

async function listProductPrices(resource, productId) {
  const prices = [];
  let startingAfter;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await resource.list({
      product: productId,
      active: true,
      type: 'one_time',
      currency: ALLOWED_CURRENCY,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    if (!response || !Array.isArray(response.data)) break;
    prices.push(...response.data);

    if (!response.has_more || response.data.length === 0) break;
    startingAfter = response.data[response.data.length - 1].id;
  }

  return prices;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = first((req.query || {}).id);
  if (typeof id !== 'string' || !PRODUCT_ID_RE.test(id) || id.length > 255) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }

  const stripe = getStripe();
  if (!stripe) {
    console.error('Product configuration error: STRIPE_SECRET_KEY is missing or invalid');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Product catalogue is not configured' });
  }

  try {
    const product = await stripe.products.retrieve(id, { expand: ['default_price'] });

    if (!product || product.active !== true || product.deleted === true) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const rawPrices = await listProductPrices(stripe.prices, id);
    const prices = rawPrices
      .filter(usablePrice)
      .slice()
      .sort((a, b) => a.unit_amount - b.unit_amount);

    const defaultPriceId = typeof product.default_price === 'string'
      ? product.default_price
      : (product.default_price && product.default_price.id);
    const defaultPrice = prices.find((price) => price.id === defaultPriceId) || null;
    const displayPrice = defaultPrice || prices[0] || null;

    const variants = prices.map((price) => ({
      priceId: price.id,
      amount: price.unit_amount,
      currency: price.currency,
      label: variantLabel(price),
    }));

    const data = {
      id: product.id,
      name: safeString(product.name, 250) || 'Product',
      description: safeString(product.description, 5000),
      images: safeImages(product.images),
      priceId: displayPrice ? displayPrice.id : null,
      price: displayPrice ? displayPrice.unit_amount : 0,
      currency: displayPrice ? displayPrice.currency : ALLOWED_CURRENCY,
      priceIsFrom: Boolean(displayPrice && !defaultPrice && prices.length > 1),
      variants,
      available: Boolean(displayPrice),
      metadata: sanitizeMetadata(product.metadata),
      active: true,
      created: Number.isFinite(product.created) ? product.created : 0,
    };

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(data);
  } catch (error) {
    if (error && (error.code === 'resource_missing' || error.statusCode === 404)) {
      return res.status(404).json({ error: 'Product not found' });
    }

    console.error('Stripe product error:', error.message);
    return res.status(502).json({ error: 'Failed to load product' });
  }
};
