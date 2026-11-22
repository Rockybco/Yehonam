/**
 * GET /api/verify-order?session_id=cs_xxx
 *
 * Called by confirmation.html. Verifies the Checkout Session with Stripe and
 * returns only the fields needed by the confirmation page.
 *
 * A Stripe redirect is NOT proof of payment. The page treats the order as
 * confirmed only when this endpoint returns verified: true, which happens
 * only when Stripe reports payment_status === 'paid'.
 *
 * This endpoint verifies the session and returns order information to the
 * confirmation page. Order confirmation emails are sent from the Stripe
 * webhook (api/webhook.js), not from here.
 *
 * SETUP: Add STRIPE_SECRET_KEY to Vercel environment variables.
 */

const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9_]+$/;

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

function safeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (!email || email.length > 320) return null;
  return email;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = first((req.query || {}).session_id);
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId) || sessionId.length > 255) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  const stripe = getStripe();
  if (!stripe) {
    console.error('Verification configuration error: STRIPE_SECRET_KEY is missing or invalid');
    return res.status(503).json({ error: 'Order verification is not configured' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'payment_intent'],
    });

    const paymentIntent = session.payment_intent && typeof session.payment_intent === 'object'
      ? session.payment_intent
      : null;

    const paymentFailed = Boolean(
      paymentIntent &&
      (paymentIntent.last_payment_error || paymentIntent.status === 'canceled')
    );

    const lineItems = (session.line_items && Array.isArray(session.line_items.data)
      ? session.line_items.data
      : []
    ).map((item) => ({
      description: typeof item.description === 'string'
        ? item.description.trim().slice(0, 250)
        : 'Item',
      quantity: Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1,
      amount_total: Number.isInteger(item.amount_total) ? item.amount_total : 0,
      currency: typeof item.currency === 'string' ? item.currency : (session.currency || 'usd'),
    }));

    return res.status(200).json({
      // Only a paid session is treated as confirmed. This excludes sessions
      // where Stripe has not yet finalized the payment.
      verified: session.payment_status === 'paid',
      payment_status: typeof session.payment_status === 'string' ? session.payment_status : 'unpaid',
      status: typeof session.status === 'string' ? session.status : 'open',
      payment_failed: paymentFailed,
      order_reference: session.id,
      email: safeEmail(session.customer_details && session.customer_details.email) ||
        safeEmail(session.customer_email),
      amount_total: Number.isInteger(session.amount_total) ? session.amount_total : null,
      currency: typeof session.currency === 'string' ? session.currency : 'usd',
      line_items: lineItems,
    });
  } catch (error) {
    if (error && (error.code === 'resource_missing' || error.statusCode === 404)) {
      return res.status(404).json({ error: 'Order not found' });
    }

    console.error('Verify order error:', error.message);
    return res.status(502).json({ error: 'Order verification failed' });
  }
};
