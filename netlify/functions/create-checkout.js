/**
 * POST /create-checkout — Creates a Stripe Checkout Session
 *
 * SETUP:
 * 1. Add STRIPE_SECRET_KEY to Netlify environment variables
 * 2. Never expose this key in frontend code
 *
 * Security: validates all prices server-side against Stripe before
 * creating the session. Browser-submitted prices are NEVER trusted.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { items, success_url, cancel_url } = JSON.parse(event.body || '{}');

    if (!items || !Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No items provided' }) };
    }

    // SECURITY: Validate every price ID against Stripe before checkout
    // This prevents price manipulation from the frontend
    const lineItems = [];
    for (const item of items) {
      if (!item.price || !item.quantity || item.quantity < 1) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid item' }) };
      }

      // Verify price exists in Stripe (throws if not found/invalid)
      const stripePrice = await stripe.prices.retrieve(item.price);
      if (!stripePrice.active) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Price ${item.price} is no longer available` }) };
      }

      lineItems.push({
        price: stripePrice.id,            // Always use the verified Stripe price ID
        quantity: Math.min(parseInt(item.quantity) || 1, 99),
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: success_url || `${process.env.SITE_URL || 'https://yehonam.com'}/confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${process.env.SITE_URL || 'https://yehonam.com'}/cart.html`,
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['GB', 'US', 'CA', 'AU', 'NG', 'GH', 'ZA', 'DE', 'FR', 'NL', 'IE'],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 395, currency: 'gbp' },
            display_name: 'Standard Delivery (3–5 days)',
          },
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 695, currency: 'gbp' },
            display_name: 'Express Delivery (1–2 days)',
          },
        },
      ],
      allow_promotion_codes: true,
      metadata: {
        source: 'yehonam-website',
        created_at: new Date().toISOString(),
      },
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (error) {
    console.error('Checkout error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Checkout session creation failed' }) };
  }
};
