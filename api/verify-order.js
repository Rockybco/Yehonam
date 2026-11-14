/**
 * GET /api/verify-order?session_id=cs_xxx — Verifies a completed Stripe checkout session
 * Called from the confirmation page. Returns session details for display.
 *
 * Vercel port of netlify/functions/verify-order.js (Netlify copy kept intact).
 * The frontend still calls /.netlify/functions/verify-order, which vercel.json
 * rewrites to /api/verify-order.
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

  const sessionId = first((req.query || {}).session_id);
  if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'line_items.data.price.product'],
    });

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    return res.status(200).json({
      id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_details: session.customer_details,
      shipping_details: session.shipping_details,
      payment_status: session.payment_status,
    });
  } catch (error) {
    console.error('Verify order error:', error.message);
    return res.status(500).json({ error: 'Order verification failed' });
  }
};
