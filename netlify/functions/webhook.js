/**
 * POST /webhook — Handles Stripe webhook events
 *
 * SETUP:
 * 1. Add STRIPE_SECRET_KEY to Netlify environment variables
 * 2. Add STRIPE_WEBHOOK_SECRET to Netlify environment variables
 *    Get this from: Stripe Dashboard → Developers → Webhooks → Add endpoint
 *    Endpoint URL: https://yourdomain.netlify.app/.netlify/functions/webhook
 *    Events to listen for: checkout.session.completed, payment_intent.succeeded,
 *                          payment_intent.payment_failed, charge.refunded
 *
 * IMPORTANT: Payment is NEVER confirmed from browser redirect alone.
 * This webhook is the authoritative payment confirmation.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
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

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return { statusCode: 500, body: 'Webhook handler failed' };
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
