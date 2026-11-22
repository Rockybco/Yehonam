/**
 * YEHONAM SUDS — TRANSACTIONAL ORDER-CONFIRMATION EMAIL
 *
 * Sends an order confirmation email after a Stripe Checkout Session has
 * been verified as paid (see api/verify-order.js). Uses the existing
 * Hostinger SMTP configuration via Nodemailer. No email is sent for
 * failed, pending or unpaid sessions.
 *
 * SMTP settings come from environment variables only (never logged or
 * returned): SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
 * EMAIL_FROM, EMAIL_FROM_NAME.
 *
 * Duplicate emails: the durable check is the PaymentIntent metadata
 * (`yehonam_order_email_status: 'sent'`) plus an in-process sent-set.
 * There is no database in this project, so a cold start or another
 * instance can still re-send on a repeat webhook delivery — a limitation,
 * reported rather than claimed impossible. A race between SMTP delivery
 * and marker persistence is also possible: if the marker update fails
 * after a successful send, a Stripe retry can resend the email.
 */

const nodemailer = require('nodemailer');

const MAX_SESSION_ID = 255;
const MAX_EMAIL_LENGTH = 320;
const SUPPORT_EMAIL = 'support@yehonam.com';
const DEFAULT_FROM_NAME = 'Yehonam Suds';

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function isValidEmail(value) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function formatMoney(cents, currency) {
  const amount = Number.isFinite(Number(cents)) ? Number(cents) / 100 : 0;
  const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency)
    ? currency.toUpperCase()
    : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

function envString(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function parseSecure(port) {
  const raw = process.env.SMTP_SECURE;
  if (raw === undefined || String(raw).trim() === '') {
    return port === 465;
  }
  return !['false', '0', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

function getSmtpConfig() {
  const portRaw = Number.parseInt(envString('SMTP_PORT'), 10);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 465;
  const host = envString('SMTP_HOST');
  const user = envString('SMTP_USER');
  const password = typeof process.env.SMTP_PASS === 'string' ? process.env.SMTP_PASS : '';
  const fromAddress = envString('EMAIL_FROM');
  const fromName = envString('EMAIL_FROM_NAME') || DEFAULT_FROM_NAME;
  return { host, port, secure: parseSecure(port), user, password, fromAddress, fromName };
}

function extractCustomerEmail(session) {
  const candidates = [
    session.customer_details && typeof session.customer_details === 'object'
      ? session.customer_details.email
      : null,
    session.customer_email,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isValidEmail(candidate)) {
      return candidate.trim();
    }
  }
  return null;
}

function extractItems(session) {
  const data = session.line_items && Array.isArray(session.line_items.data)
    ? session.line_items.data
    : [];
  return data
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      description: typeof item.description === 'string' && item.description.trim()
        ? item.description.trim().slice(0, 200)
        : 'Product',
      quantity: Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1,
      amountTotal: Number.isInteger(item.amount_total) ? item.amount_total : null,
      currency: typeof item.currency === 'string' && item.currency ? item.currency : 'USD',
    }));
}

function extractShippingAddress(session) {
  const details = session.shipping_details;
  if (!details || typeof details !== 'object') return '';
  const address = details.address && typeof details.address === 'object' ? details.address : {};
  const lines = [];
  const name = [details.name, address.name].find(
    (value) => typeof value === 'string' && value.trim()
  );
  if (name) lines.push(name.trim());

  [address.line1, address.line2, address.city,
   address.state ? `${address.state} ${address.postal_code}`.trim() : address.postal_code,
   address.country
  ].forEach((line) => {
    if (typeof line === 'string' && line.trim()) lines.push(line.trim());
  });

  return lines.join('\n');
}

function extractMailData(session) {
  if (!session || typeof session !== 'object') return null;

  const id = typeof session.id === 'string' ? session.id.trim() : '';
  if (!id || id.length > MAX_SESSION_ID) return null;

  const email = extractCustomerEmail(session);
  if (!email) return null;

  const currency = typeof session.currency === 'string' && session.currency ? session.currency : 'USD';
  const amount = Number.isInteger(session.amount_total) ? session.amount_total : null;

  return {
    id,
    reference: id.slice(-8).toUpperCase(),
    email,
    currency,
    amount,
    items: extractItems(session),
    address: extractShippingAddress(session),
  };
}

function buildMailOptions(data, config) {
  const amountText = data.amount === null ? 'Not available' : formatMoney(data.amount, data.currency);

  const itemLines = data.items.length
    ? data.items.map(
        (item) => `  ${item.description} — ${item.quantity} × ${formatMoney(item.amountTotal, item.currency)}`
      ).join('\n')
    : '  No items recorded';

  const addressLines = data.address
    ? data.address.split('\n').map((line) => `  ${line}`).join('\n')
    : '  Not collected during checkout';

  const text = `Hello,

Thank you for your order from Yehonam Suds, Hair & Body! Your order has been confirmed and is being prepared.

Order reference: #${data.reference}

Purchased items:
${itemLines}

Amount paid: ${amountText}

Shipping address:
${addressLines}

Delivery: Orders within the US typically take 3–5 business days. International orders may take 7–14 business days. Delivery charges, where applicable, are communicated separately by the business.

Questions? Contact us at ${SUPPORT_EMAIL}.

The Yehonam Suds team
`;

  const itemRows = data.items.length
    ? data.items.map(
        (item) => `<li>${escapeHtml(item.description)} — ${item.quantity} × ${escapeHtml(formatMoney(item.amountTotal, item.currency))}</li>`
      ).join('')
    : '<li>No items recorded</li>';

  const addressRows = data.address
    ? data.address.split('\n').map((line) => `<p style="margin:2px 0">${escapeHtml(line)}</p>`).join('')
    : '<p style="margin:2px 0">Not collected during checkout</p>';

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Order confirmed — Yehonam Suds, Hair &amp; Body</title>
  </head>
  <body style="font-family:Helvetica,Arial,sans-serif;color:#222222;max-width:600px;margin:0 auto;padding:24px;">
    <p>Hello,</p>
    <p>Thank you for your order from <strong>Yehonam Suds, Hair &amp; Body</strong>! Your order has been confirmed and is being prepared.</p>
    <p style="font-size:1.15rem;font-weight:700;color:#0C4A2B;margin:24px 0 8px">Order reference: #${escapeHtml(data.reference)}</p>
    <p style="font-weight:700;margin-top:16px">Purchased items</p>
    <ul style="padding-left:20px;margin:8px 0;">${itemRows}</ul>
    <p><strong>Amount paid:</strong> ${escapeHtml(amountText)}</p>
    <p style="font-weight:700;margin-top:16px">Shipping address</p>
    ${addressRows}
    <p style="margin-top:16px">Delivery: Orders within the US typically take 3–5 business days. International orders may take 7–14 business days. Delivery charges, where applicable, are communicated separately by the business.</p>
    <p>Questions? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#0C4A2B;font-weight:600">${SUPPORT_EMAIL}</a>.</p>
    <p>The Yehonam Suds team</p>
  </body>
</html>`;

  const from = config.fromName
    ? `"${config.fromName.replace(/"/g, "'")}" <${config.fromAddress}>`
    : config.fromAddress;

  return {
    from,
    to: data.email,
    subject: `Order confirmed: #${data.reference}`,
    text,
    html,
  };
}

const sentSessionIds = new Set();
const inFlight = new Set();

async function sendOrderConfirmationEmail(session, stripeClient) {
  if (!session || typeof session !== 'object' || session.payment_status !== 'paid') {
    return { sent: false, reason: 'not-paid' };
  }

  const data = extractMailData(session);
  if (!data) return { sent: false, reason: 'invalid-session' };

  const paymentIntent = session.payment_intent && typeof session.payment_intent === 'object'
    ? session.payment_intent
    : null;

  // Persistent, per-order dedupe: check the PaymentIntent metadata first.
  if (paymentIntent &&
      paymentIntent.metadata &&
      paymentIntent.metadata.yehonam_order_email_status === 'sent') {
    return { sent: false, reason: 'already-sent' };
  }

  // In-process safety net so repeated deliveries while this instance is
  // warm do not re-send. This is NOT the durable dedupe mechanism.
  if (sentSessionIds.has(data.id)) return { sent: false, reason: 'already-sent' };

  const paymentIntentId = paymentIntent && typeof paymentIntent.id === 'string' ? paymentIntent.id : null;
  if (paymentIntentId) {
    if (inFlight.has(paymentIntentId)) return { sent: false, reason: 'in-flight' };
    inFlight.add(paymentIntentId);
  }

  try {
    const config = getSmtpConfig();
    if (!isValidEmail(config.fromAddress) || !config.user || !config.password || !config.host) {
      console.error('Order confirmation email not sent: SMTP configuration is incomplete');
      return { sent: false, reason: 'not-configured' };
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
    });

    const result = await transporter.sendMail(buildMailOptions(data, config));
    const delivered = Boolean(result) && !(result.rejected && result.rejected.length > 0);

    if (delivered) {
      // Persist the sent marker on the PaymentIntent so Stripe retries of
      // this webhook do not resend the email. If the marker update fails the
      // email was still sent; the failure is logged and the webhook returns
      // success (no duplicate desired).
      if (stripeClient && paymentIntentId) {
        try {
          await stripeClient.paymentIntents.update(paymentIntentId, {
            metadata: { yehonam_order_email_status: 'sent' },
          });
        } catch (error) {
          console.error(
            'Order confirmation email was sent but the sent marker could not be persisted:',
            error && error.message
          );
        }
      }
      sentSessionIds.add(data.id);
      return { sent: true };
    }

    return { sent: false, reason: 'send-failed' };
  } catch (error) {
    // Never log SMTP credentials or secrets; log only the error code.
    console.error('Order confirmation email failed:', error && error.code ? error.code : 'SMTP error');
    return { sent: false, reason: 'send-failed' };
  } finally {
    if (paymentIntentId) inFlight.delete(paymentIntentId);
  }
}

module.exports = {
  sendOrderConfirmationEmail,
  extractMailData,
};
