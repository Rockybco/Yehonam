/**
 * GET /verify-order?session_id=cs_xxx — Verifies a completed Stripe checkout session
 * Called from the confirmation page. Returns session details for display.
 * SETUP: Add STRIPE_SECRET_KEY to Netlify environment variables.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { session_id } = event.queryStringParameters || {};
  if (!session_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Session ID required' }) };

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items', 'line_items.data.price.product'],
    });

    if (session.payment_status !== 'paid') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment not completed' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: session.id,
        amount_total: session.amount_total,
        currency: session.currency,
        customer_details: session.customer_details,
        shipping_details: session.shipping_details,
        payment_status: session.payment_status,
      }),
    };
  } catch (error) {
    console.error('Verify order error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Order verification failed' }) };
  }
};
