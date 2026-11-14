/**
 * GET /api/get-product?id=prod_xxx — Fetches a single product from Stripe
 *
 * SETUP: Add STRIPE_SECRET_KEY to Vercel environment variables.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Vercel query params can be string | string[]
const first = (v) => (Array.isArray(v) ? v[0] : v);

module.exports = async (req, res) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === 'OPTIONS') return res.status(200).end();

  const id = first((req.query || {}).id);
  if (!id) return res.status(400).json({ error: 'Product ID required' });

  try {
    const product = await stripe.products.retrieve(id, { expand: ['default_price'] });
    const price = product.default_price;

    // Retrieve all prices for this product (for size/variant options)
    const prices = await stripe.prices.list({ product: id, active: true });

    const data = {
      id: product.id,
      name: product.name,
      description: product.description,
      images: product.images,
      priceId: price?.id || null,
      price: price?.unit_amount || 0,
      currency: price?.currency || 'gbp',
      metadata: product.metadata || {},
      active: product.active,
      created: product.created,
      allPrices: prices.data.map(p => ({
        id: p.id,
        amount: p.unit_amount,
        currency: p.currency,
        nickname: p.nickname,
      })),
    };

    return res.status(200).json(data);
  } catch (error) {
    console.error('Stripe error:', error.message);
    return res.status(404).json({ error: 'Product not found' });
  }
};
