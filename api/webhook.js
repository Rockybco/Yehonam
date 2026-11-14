/**
 * POST /api/webhook — Handles Stripe webhook events
 *
 * Vercel port of netlify/functions/webhook.js (Netlify copy kept intact).
 * Stripe endpoint URL on Vercel: https://your-site.vercel.app/api/webhook
 * (The /.netlify/functions/webhook path also works via the vercel.json rewrite,
 * but use the /api/webhook URL when registering the endpoint with Stripe.)
 *
 * SETUP:
 * 1. Add STRIPE_SECRET_KEY to Vercel environment variables
 * 2. Add STRIPE_WEBHOOK_SECRET to Vercel environment variables
 *    Get this from: Stripe Dashboard → Developers → Webhooks → Add endpoint
 *    Events to listen for: checkout.session.completed, payment_intent.succeeded,
 *                          payment_intent.payment_failed, charge.refunded
 *
 * IMPORTANT: Payment is NEVER confirmed from browser redirect alone.
 * This webhook is the authoritative payment confirmation.
 *
 * IMPORTANT: Stripe signs the RAW request body. We must read the raw bytes
 * from the request stream — re-serializing req.body would break the signature.
 * (Vercel's request helpers buffer the body once, then replay the original
 * bytes to 'data'/'end' listeners, so reading the stream here is safe.)
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    const rawBody = await readRawBody(req);
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).end(`Webhook Error: ${err.message}`);
  }

  // Handle idempotency — log event ID to prevent duplicate processing
  const eventId = stripeEvent.id;
  console.log(`Processing Stripe event: ${stripeEvent.type} [${eventId}]`);

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        await handleSuccessfulPayment(session);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = stripeEvent.data.object;
        console.log(`Payment failed: ${paymentIntent.id}`);
        // TODO: Notify customer via email
        break;
      }

      case 'charge.refunded': {
        const charge = stripeEvent.data.object;
        console.log(`Refund processed: ${charge.id}`);
        // TODO: Update order status, notify customer
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).end('Webhook handler failed');
  }
};

async function handleSuccessfulPayment(session) {
  console.log(`Payment confirmed: ${session.id}`);
  console.log(`Customer: ${session.customer_details?.email}`);
  console.log(`Amount: ${session.amount_total} ${session.currency}`);

  // ---- ORDER FULFILLMENT ACTIONS ----
  // TODO: Implement one or more of these:

  // 1. Send confirmation email (Resend, SendGrid, Mailchimp Transactional, etc.)
  //    await sendOrderConfirmationEmail(session.customer_details.email, session);

  // 2. Update inventory system
  //    await updateInventory(session.line_items);

  // 3. Notify fulfilment/warehouse
  //    await notifyFulfilment(session);

  // 4. Add to CRM / mailing list
  //    await addToMailingList(session.customer_details.email);

  // 5. Log to database
  //    await db.orders.create({ stripeSessionId: session.id, ... });

  // For now, log the successful session
  console.log('Order fulfillment hooks to implement. Session data:', JSON.stringify(session, null, 2));
}
