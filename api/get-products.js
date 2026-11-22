/**
 * GET /api/get-products — Fetches active, purchasable products from Stripe
 *
 * Supports: ?featured=true&limit=4&category=haircare
 *
 * Only products that have at least one active, one-time, USD Price are
 * returned. Products without a usable price are skipped without breaking
 * the rest of the catalogue.
 *
 * SETUP: Add STRIPE_SECRET_KEY to Vercel environment variables.
 */

const MAX_PRODUCTS = 200;
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

function displayOrder(product) {
  const parsed = parseInt(product.metadata && product.metadata.display_order, 10);
  return Number.isFinite(parsed) ? parsed : 999;
}

/**
 * Walk a Stripe list endpoint until every page has been read.
 * MAX_PAGES keeps a runaway catalogue from making an unbounded request.
 */
async function listAll(resource, params) {
  const results = [];
  let startingAfter;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await resource.list({
      ...params,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    if (!response || !Array.isArray(response.data)) break;
    results.push(...response.data);

    if (!response.has_more || response.data.length === 0) break;
    startingAfter = response.data[response.data.length - 1].id;
  }

  return results;
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

  const stripe = getStripe();
  if (!stripe) {
    console.error('Catalogue configuration error: STRIPE_SECRET_KEY is missing or invalid');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Catalogue is not configured', products: [] });
  }

  try {
    const params = req.query || {};
    const requestedLimit = parseInt(first(params.limit), 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_PRODUCTS)
      : 100;

    // Fetch active products and all active one-time USD prices. Fetching prices
    // separately lets us include products whose default price is inactive or
    // missing, while still requiring a real Stripe Price for every card.
    const [rawProducts, rawPrices] = await Promise.all([
      listAll(stripe.products, {
        active: true,
        limit: 100,
        expand: ['data.default_price'],
      }),
      listAll(stripe.prices, {
        active: true,
        type: 'one_time',
        currency: ALLOWED_CURRENCY,
        limit: 100,
      }),
    ]);

    const activeProducts = rawProducts.filter((product) =>
      product &&
      product.active === true &&
      typeof product.id === 'string' &&
      PRODUCT_ID_RE.test(product.id)
    );
    const activeProductIds = new Set(activeProducts.map((product) => product.id));

    // Group usable prices by their product ID.
    const pricesByProduct = new Map();
    for (const rawPrice of rawPrices) {
      if (!usablePrice(rawPrice)) continue;

      const productId = typeof rawPrice.product === 'string'
        ? rawPrice.product
        : (rawPrice.product && rawPrice.product.id);

      if (!productId || !activeProductIds.has(productId)) continue;

      if (!pricesByProduct.has(productId)) pricesByProduct.set(productId, []);
      pricesByProduct.get(productId).push(rawPrice);
    }

    let products = [];

    for (const product of activeProducts) {
      const prices = (pricesByProduct.get(product.id) || [])
        .slice()
        .sort((a, b) => a.unit_amount - b.unit_amount);

      if (prices.length === 0) continue;

      const defaultPriceId = typeof product.default_price === 'string'
        ? product.default_price
        : (product.default_price && product.default_price.id);
      const defaultPrice = prices.find((price) => price.id === defaultPriceId) || null;
      const displayPrice = defaultPrice || prices[0];

      const variants = prices.map((price) => ({
        priceId: price.id,
        amount: price.unit_amount,
        currency: price.currency,
        label: variantLabel(price),
      }));

      products.push({
        id: product.id,
        name: safeString(product.name, 250) || 'Product',
        description: safeString(product.description, 5000),
        images: safeImages(product.images),
        priceId: displayPrice.id,
        price: displayPrice.unit_amount,
        currency: displayPrice.currency,
        priceIsFrom: !defaultPrice && prices.length > 1,
        variants,
        metadata: sanitizeMetadata(product.metadata),
        active: true,
        created: Number.isFinite(product.created) ? product.created : 0,
      });
    }

    // Preserve the existing featured/category filters.
    if (String(first(params.featured)).toLowerCase() === 'true') {
      products = products.filter((product) =>
        String(product.metadata.featured || '').toLowerCase() === 'true'
      );
    }

    const category = first(params.category);
    if (typeof category === 'string' && category.trim()) {
      const wanted = category.trim().toLowerCase();
      products = products.filter((product) =>
        String(product.metadata.category || '').toLowerCase() === wanted
      );
    }

    // Preserve display_order sorting, with a stable name fallback.
    products.sort((a, b) =>
      displayOrder(a) - displayOrder(b) ||
      a.name.localeCompare(b.name)
    );

    products = products.slice(0, limit);

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ products, count: products.length });
  } catch (error) {
    console.error('Stripe catalogue error:', error.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Failed to load products', products: [] });
  }
};
