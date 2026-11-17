/**
 * GET /api/get-products — Fetches active products from Stripe
 * Supports: ?featured=true&limit=4&category=haircare
 *
 * SETUP: Add STRIPE_SECRET_KEY to Vercel environment variables.
 * Dashboard → Project → Settings → Environment Variables → STRIPE_SECRET_KEY
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Vercel query params can be string | string[]
const first = (v) => (Array.isArray(v) ? v[0] : v);

module.exports = async (req, res) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60', // 1-minute cache
  };
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const params = req.query || {};
    const limit = Math.min(parseInt(first(params.limit)) || 50, 100);

    // Fetch active products
    const stripeProducts = await stripe.products.list({
      active: true,
      limit,
      expand: ['data.default_price'],
    });

    // Transform for frontend
    let products = stripeProducts.data.map(p => {
      const price = p.default_price;
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        images: p.images,
        priceId: price?.id || null,
        price: price?.unit_amount || 0,
        currency: price?.currency || 'usd',
        metadata: p.metadata || {},
        active: p.active,
        created: p.created,
      };
    });

    // Client-side filters (also available server-side via metadata search)
    if (first(params.featured) === 'true') {
      products = products.filter(p => p.metadata.featured === 'true');
    }

    const category = first(params.category);
    if (category) {
      products = products.filter(p =>
        (p.metadata.category || '').toLowerCase() === String(category).toLowerCase()
      );
    }

    // Sort by display_order metadata
    products.sort((a, b) =>
      parseInt(a.metadata.display_order || 999) - parseInt(b.metadata.display_order || 999)
    );

    return res.status(200).json({ products });
  } catch (error) {
    console.error('Stripe error:', error.message);
    return res.status(500).json({ error: 'Failed to load products', products: [] });
  }
};
