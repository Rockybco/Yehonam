/**
 * GET /products — Fetches active products from Stripe
 * Supports: ?featured=true&limit=4&category=haircare
 *
 * SETUP: Add STRIPE_SECRET_KEY to your Netlify environment variables.
 * Dashboard → Site settings → Environment variables → STRIPE_SECRET_KEY
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60', // 1-minute cache
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(parseInt(params.limit) || 50, 100);

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
        currency: price?.currency || 'gbp',
        metadata: p.metadata || {},
        active: p.active,
        created: p.created,
      };
    });

    // Client-side filters (also available server-side via metadata search)
    if (params.featured === 'true') {
      products = products.filter(p => p.metadata.featured === 'true');
    }

    if (params.category) {
      products = products.filter(p =>
        (p.metadata.category || '').toLowerCase() === params.category.toLowerCase()
      );
    }

    // Sort by display_order metadata
    products.sort((a, b) =>
      parseInt(a.metadata.display_order || 999) - parseInt(b.metadata.display_order || 999)
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ products }),
    };
  } catch (error) {
    console.error('Stripe error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load products', products: [] }),
    };
  }
};
