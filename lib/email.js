/**
 * YEHONAM SUDS — TRANSACTIONAL ORDER-CONFIRMATION EMAIL
 *
 * Sends the Yehonam branded order confirmation receipt after a Stripe
 * Checkout Session is verified as paid (see api/webhook.js). Uses the
 * existing Hostinger SMTP configuration via Nodemailer. No email is sent
 * for failed, pending or unpaid sessions.
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
const MAX_NAME_LENGTH = 80;
const SUPPORT_EMAIL = 'support@yehonam.com';
const DEFAULT_FROM_NAME = 'Yehonam Suds';
const SITE_URL = 'https://www.yehonam.com';
// Gmail/Outlook block SVG images, so email uses a PNG rendered from the same logo.svg.
const LOGO_URL = 'https://www.yehonam.com/images/logo-email.png';

// Receipt visual identity — Yehonam brand palette.
const RECEIPT_EMERALD = '#004D2B';
const RECEIPT_GOLD = '#D4AF37';
const RECEIPT_BLACK = '#000000';
const RECEIPT_DARK_GREEN = '#0B2419';
const RECEIPT_LIGHT_GOLD = '#F5D88A';
const RECEIPT_CREAM = '#FFF5E6';

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

function formatReceiptDate(iso) {
  if (typeof iso !== 'string' || !iso) return 'Not available';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

function extractCustomerName(session) {
  const candidates = [
    session.customer_details && typeof session.customer_details === 'object'
      ? session.customer_details.name
      : null,
    session.customer_name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, MAX_NAME_LENGTH);
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
  // Keep this aligned with extractAddressLines() so every receipt surface
  // displays the same address component order and line breaks.
  return extractAddressLines(session).join('\n');
}

function extractAddressLines(session) {
  const details = session.shipping_details;
  if (!details || typeof details !== 'object') return [];
  const address = details.address && typeof details.address === 'object' ? details.address : details;
  const lines = [];
  const name = typeof details.name === 'string' ? details.name.trim() : '';
  if (name) lines.push(name);

  ['line1', 'line2', 'city', 'state', 'postal_code', 'country'].forEach((key) => {
    const value = address[key];
    if (typeof value === 'string' && value.trim()) lines.push(value.trim());
  });

  return lines.slice(0, 8).map((line) => line.slice(0, 120));
}

function extractMailData(session) {
  if (!session || typeof session !== 'object') return null;

  const id = typeof session.id === 'string' ? session.id.trim() : '';
  if (!id || id.length > MAX_SESSION_ID) return null;

  const email = extractCustomerEmail(session);
  if (!email) return null;

  const currency = typeof session.currency === 'string' && session.currency ? session.currency : 'USD';
  const amount = Number.isInteger(session.amount_total) ? session.amount_total : null;

  const totalDetails = session.total_details && typeof session.total_details === 'object'
    ? session.total_details
    : null;
  const discount = totalDetails && Number.isInteger(totalDetails.amount_discount)
    ? Math.max(0, totalDetails.amount_discount)
    : 0;
  const tax = totalDetails && Number.isInteger(totalDetails.amount_tax)
    ? Math.max(0, totalDetails.amount_tax)
    : 0;
  const subtotal = Number.isInteger(session.amount_subtotal) && session.amount_subtotal >= 0
    ? session.amount_subtotal
    : (Number.isInteger(session.amount_total)
      ? Math.max(0, session.amount_total - discount - tax)
      : null);

  return {
    id,
    reference: id.slice(-8).toUpperCase(),
    email,
    currency,
    amount,
    subtotal,
    discount,
    tax,
    customerName: extractCustomerName(session),
    orderDate: typeof session.created === 'number' && session.created > 0
      ? new Date(session.created * 1000).toISOString()
      : null,
    paymentStatus: typeof session.payment_status === 'string' ? session.payment_status : null,
    items: extractItems(session),
    address: extractShippingAddress(session),
    addressLines: extractAddressLines(session),
  };
}

function receiptTableCell(content, color = RECEIPT_DARK_GREEN) {
  return `<td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${color};padding:4px 12px;border-bottom:1px solid ${RECEIPT_GOLD};text-align:right;">${content}</td>`;
}

function buildMailOptions(data, config) {
  const ref = data.reference ? `#${data.reference}` : 'Not available';
  const date = data.orderDate ? formatReceiptDate(data.orderDate) : 'Not available';
  const status = data.paymentStatus
    ? `${data.paymentStatus.charAt(0).toUpperCase()}${data.paymentStatus.slice(1)}`
    : 'Paid';
  const name = typeof data.customerName === 'string' ? data.customerName.trim() : '';
  const greeting = name ? `Hello, ${escapeHtml(name)}` : 'Hello!';

  const subtotal = data.subtotal === null ? 'Not available' : formatMoney(data.subtotal, data.currency);
  const total = data.amount === null ? 'Not available' : formatMoney(data.amount, data.currency);
  const discountText = data.discount > 0 ? formatMoney(data.discount, data.currency) : '';
  const taxText = data.tax > 0 ? formatMoney(data.tax, data.currency) : '';
  const addressText = data.addressLines.length
    ? data.addressLines.map((line) => escapeHtml(line)).join('<br>')
    : 'Not collected during checkout';

  const productRows = data.items.length
    ? data.items.map((item) => `
          <tr>
            <td width="60%" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${RECEIPT_DARK_GREEN};padding:8px 12px;border-bottom:1px solid ${RECEIPT_GOLD};">${escapeHtml(item.description)}</td>
            <td width="15%" align="center" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${RECEIPT_DARK_GREEN};text-align:center;padding:8px 12px;border-bottom:1px solid ${RECEIPT_GOLD};">${item.quantity}</td>
            <td width="25%" align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${RECEIPT_GOLD};font-weight:600;padding:8px 12px;border-bottom:1px solid ${RECEIPT_GOLD};text-align:right;">${escapeHtml(formatMoney(item.amountTotal, item.currency))}</td>
          </tr>`).join('')
    : `<tr><td colspan="3" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};padding:14px 12px;">No items recorded</td></tr>`;

  const summaryRows = [
    `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};padding:5px 0;">Subtotal</td>${receiptTableCell(subtotal, RECEIPT_GOLD)}</tr>`,
    discountText ? `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};padding:5px 0;">Discount</td>${receiptTableCell(`-${escapeHtml(discountText)}`, RECEIPT_GOLD)}</tr>` : '',
    taxText ? `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};padding:5px 0;">Tax</td>${receiptTableCell(`+${escapeHtml(taxText)}`, RECEIPT_GOLD)}</tr>` : '',
    `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:16px;color:${RECEIPT_GOLD};font-weight:700;padding:8px 0;border-top:2px solid ${RECEIPT_GOLD};">Total paid</td>${receiptTableCell(`<span style="color:${RECEIPT_GOLD};font-weight:700;">${escapeHtml(total)}</span>`)}</tr>`,
  ].join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Order confirmed — Yehonam Suds, Hair &amp; Body</title>
</head>
<body style="margin:0;padding:0;background:${RECEIPT_CREAM};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${RECEIPT_CREAM}">
    <tr><td height="28" style="font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td width="100%" align="center">
      <table width="600" border="0" cellpadding="0" cellspacing="0" style="border:1px solid ${RECEIPT_GOLD};border-radius:16px;background:${RECEIPT_CREAM};">
        <!-- A. Brand header -->
        <tr><td style="padding:32px 28px 12px;">
          <a href="${SITE_URL}" style="text-decoration:none;"><img src="${LOGO_URL}" width="210" height="71" alt="Yehonam — Suds, Hair &amp; Body" style="display:block;width:210px;max-width:100%;height:auto;border:0;"></a>
        </td></tr>
        <!-- B. Order confirmation -->
        <tr><td style="padding:20px 28px;text-align:center;">
          <p style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:${RECEIPT_EMERALD};margin:0 0 6px;">YOUR ORDER IS CONFIRMED!</p>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:16px;color:${RECEIPT_GOLD};margin:0 0 10px;">Payment successful</p>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${RECEIPT_DARK_GREEN};margin:0;">${greeting} — thank you for your order. Your payment has been received and your order is being prepared.</p>
        </td></tr>
        <tr><td height="1" style="background:${RECEIPT_GOLD};"></td></tr>
        <!-- C. Order information -->
        <tr><td style="padding:16px 28px;">
          <p style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:${RECEIPT_EMERALD};margin:0 0 10px;">ORDER INFORMATION</p>
          <table width="100%" border="0" cellpadding="5" cellspacing="0">
            <tr><td width="32%" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};">Order reference</td>${receiptTableCell(ref)}</tr>
            <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};">Order date</td>${receiptTableCell(date)}</tr>
            <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};">Payment status</td>${receiptTableCell(`<span style="color:${RECEIPT_GOLD};font-weight:700;">${escapeHtml(status)}</span>`)}</tr>
          </table>
        </td></tr>
        <!-- D. Your order -->
        <tr><td style="padding:16px 28px;">
          <p style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:${RECEIPT_EMERALD};margin:0 0 10px;">YOUR ORDER</p>
          <table width="100%" border="0" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td width="60%" align="left" style="background:${RECEIPT_EMERALD};padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;white-space:nowrap;color:${RECEIPT_LIGHT_GOLD};">Product</td>
              <td width="15%" align="center" style="background:${RECEIPT_EMERALD};padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;white-space:nowrap;color:${RECEIPT_LIGHT_GOLD};">Qty</td>
              <td width="25%" align="right" style="background:${RECEIPT_EMERALD};padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;white-space:nowrap;color:${RECEIPT_LIGHT_GOLD};">Line Total</td>
            </tr>
            ${productRows}
          </table>
        </td></tr>
        <!-- E. Payment summary -->
        <tr><td style="padding:16px 28px;">
          <p style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:${RECEIPT_EMERALD};margin:0 0 10px;">PAYMENT SUMMARY</p>
          <table width="100%" border="0" cellpadding="5" cellspacing="0" style="border-collapse:collapse;">
            ${summaryRows}
          </table>
        </td></tr>
        <!-- F. Delivery details -->
        <tr><td style="padding:16px 28px;">
          <p style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:${RECEIPT_EMERALD};margin:0 0 10px;">DELIVERY DETAILS</p>
          <table width="100%" border="0" cellpadding="5" cellspacing="0" style="border-collapse:collapse;">
            ${data.customerName ? `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};padding:5px 0;">Recipient</td>${receiptTableCell(escapeHtml(data.customerName))}</tr>` : ''}
            <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};padding:5px 0;">Customer email</td>${receiptTableCell(escapeHtml(data.email || ''))}</tr>
            <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${RECEIPT_DARK_GREEN};padding:5px 0;">Shipping address</td>${receiptTableCell(addressText)}</tr>
          </table>
        </td></tr>
        <!-- G. Delivery information -->
        <tr><td style="padding:14px 28px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${RECEIPT_DARK_GREEN};line-height:1.6;margin:0;">Your delivery details have been received. Any applicable delivery charges will be communicated separately by the Yehonam team.</p>
        </td></tr>
        <!-- H. Assistance -->
        <tr><td style="padding:14px 28px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${RECEIPT_DARK_GREEN};margin:0;">Questions? Email us at <a href="mailto:${SUPPORT_EMAIL}" style="color:${RECEIPT_EMERALD};text-decoration:underline;">${SUPPORT_EMAIL}</a> or visit our website at <a href="${SITE_URL}" style="color:${RECEIPT_EMERALD};text-decoration:underline;">www.yehonam.com</a>.</p>
        </td></tr>
        <!-- I. Closing -->
        <tr><td style="padding:16px 28px 20px;text-align:center;">
          <p style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:${RECEIPT_EMERALD};margin:0 0 4px;">Thank you for choosing Yehonam.</p>
          <p style="font-family:Georgia,serif;font-size:16px;color:${RECEIPT_DARK_GREEN};margin:0 0 12px;">With care, The Yehonam Team.</p>
          <a href="https://www.yehonam.com/shop" style="display:inline-block;background:${RECEIPT_GOLD};color:${RECEIPT_BLACK};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 28px;border-radius:4px;text-decoration:none;margin-bottom:12px;">Continue Shopping</a>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${RECEIPT_DARK_GREEN};line-height:1.5;margin:0;">Automated order confirmation and payment receipt — your purchase has been recorded. Not an invoice.</p>
        </td></tr>
      </table>
    </td></tr>
    <tr><td height="28" style="font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    'YEHONAM — ORDER CONFIRMED',
    '',
    name ? `Hello, ${name}` : 'Hello',
    '',
    'YOUR ORDER IS CONFIRMED!',
    'Payment successful.',
    '',
    `Order reference: ${ref}`,
    `Order date: ${date}`,
    `Payment status: ${status}`,
    '',
    'YOUR ORDER',
    ...data.items.map((item) => `  ${item.description} — ${item.quantity} × ${formatMoney(item.amountTotal, item.currency)}`),
    ...(data.items.length ? [] : ['  No items recorded']),
    '',
    'PAYMENT SUMMARY',
    `Subtotal: ${subtotal}`,
    ...(discountText ? [`Discount: -${discountText}`] : []),
    ...(taxText ? [`Tax: +${taxText}`] : []),
    `Total paid: ${total}`,
    '',
    'DELIVERY DETAILS',
    ...(name ? [`Recipient: ${name}`] : []),
    `Customer email: ${data.email || ''}`,
    `Shipping address: ${data.addressLines.map((line) => line.replace(/[\r\n]+/g, ' ')).join(' ') || 'Not collected during checkout'}`,
    '',
    'Your delivery details have been received. Any applicable delivery charges will be communicated separately by the Yehonam team.',
    '',
    `Questions? Email us at ${SUPPORT_EMAIL} or visit ${SITE_URL}.`,
    '',
    'Thank you for choosing Yehonam.',
    'With care, The Yehonam Team.',
    'Continue Shopping: https://www.yehonam.com/shop',
  ];

  const from = config.fromName
    ? `"${config.fromName.replace(/"/g, "'")}" <${config.fromAddress}>`
    : config.fromAddress;

  return {
    from,
    to: data.email,
    subject: `Order confirmed: ${ref}`,
    text: textLines.join('\n'),
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
