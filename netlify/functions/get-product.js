/**
 * GET /get-product?id=prod_xxx — Fetches a single product from Stripe
 * SETUP: Add STRIPE_SECRET_KEY to Netlify environment variables.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { id } = event.queryStringParameters || {};
  if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product ID required' }) };

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

    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (error) {
    console.error('Stripe error:', error.message);
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Product not found' }) };
  }
};
