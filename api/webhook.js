/**
 * POST /api/webhook — Handles Stripe webhook events
 *
 * Stripe endpoint URL: https://yehonam.com/api/webhook
 *
 * SETUP:
 * 1. Add STRIPE_SECRET_KEY to Vercel environment variables.
 * 2. Add STRIPE_WEBHOOK_SECRET to Vercel environment variables.
 *    Stripe Dashboard → Developers → Webhooks → Add endpoint
 *    Events: checkout.session.completed, payment_intent.payment_failed,
 *            charge.refunded
 *
 * RAW BODY:
 * Stripe signs the exact request bytes. Vercel's Node.js helper buffers the
 * body and replays the original bytes to 'data'/'end' listeners, so reading
 * the request stream here yields the raw body. Do not access req.body in this
 * function: that returns a parsed object and would break the signature.
 *
 * IMPORTANT:
 * This project has no database, order store, email service or event
 * deduplication. The handlers below only log events. Stripe may retry a
 * delivery; repeated logging is safe, but no duplicate protection is claimed.
 */

const MAX_BODY_BYTES = 1024 * 1024;

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

// Header values can be string | string[]
const first = (value) => (Array.isArray(value) ? value[0] : value);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(buffer);
    });

    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });

    req.on('error', (error) => {
      if (!tooLarge) reject(error);
    });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = getStripe();
  if (!stripe) {
    console.error('Webhook configuration error: STRIPE_SECRET_KEY is missing or invalid');
    return res.status(500).json({ error: 'Webhook is not configured' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Webhook configuration error: STRIPE_WEBHOOK_SECRET is missing');
    return res.status(500).json({ error: 'Webhook is not configured' });
  }

  const signature = first(req.headers['stripe-signature']);
  if (typeof signature !== 'string' || !signature) {
    return res.status(400).json({ error: 'Missing Stripe signature' });
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    if (error && error.message === 'Payload too large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    console.error('Webhook signature verification failed:', error.message);
    return res.status(400).json({ error: 'Invalid Stripe signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log(
          `[stripe] checkout.session.completed session=${session.id} ` +
          `payment_status=${session.payment_status} ` +
          `amount=${session.amount_total} ${session.currency}`
        );
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        const failureCode = paymentIntent.last_payment_error && paymentIntent.last_payment_error.code;
        console.log(
          `[stripe] payment_intent.payment_failed id=${paymentIntent.id} ` +
          `amount=${paymentIntent.amount} ${paymentIntent.currency} ` +
          `code=${failureCode || 'unknown'}`
        );
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        console.log(
          `[stripe] charge.refunded id=${charge.id} ` +
          `amount_refunded=${charge.amount_refunded} ${charge.currency}`
        );
        break;
      }

      default:
        // Acknowledge event types this project does not act on.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    // Returning 500 tells Stripe to retry. Handlers only log today, so this
    // path should be rare, but it is the correct signal if it happens.
    console.error('Webhook handler error:', error.message);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};
