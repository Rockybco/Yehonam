/**
 * YEHONAM SUDS — ORDER CONFIRMATION (receipt-styled page)
 *
 * A redirect from Stripe is not proof of payment. This page asks the server
 * to verify the Checkout Session and only shows the receipt state when Stripe
 * reports payment_status === 'paid'. The cart is cleared only at that point.
 */

(() => {
  const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9_]+$/;

  const loadingEl = document.getElementById('confirmation-loading');
  const resultEl = document.getElementById('confirmation-result');
  if (!loadingEl || !resultEl) return;

  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session_id');
  let verifying = false;

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

  function formatAmount(cents, currency) {
    if (!Number.isInteger(cents)) return 'Not available';

    const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency)
      ? currency.toUpperCase()
      : 'USD';

    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
      }).format(cents / 100);
    } catch {
      return `$${(cents / 100).toFixed(2)}`;
    }
  }

  function formatReceiptDate(iso) {
    if (typeof iso !== 'string' || !iso) return 'Not available';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Not available';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function orderReference(data) {
    const raw = data && typeof data.order_reference === 'string' && data.order_reference
      ? data.order_reference
      : (sessionId || '');
    const cleaned = raw.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
    return cleaned ? `#${cleaned}` : 'Unavailable';
  }

  function customerEmail(data) {
    if (!data || typeof data.email !== 'string') return '';
    const email = data.email.trim();
    return email && email.length <= 320 ? email : '';
  }

  // ---- RECEIPT (page version of the branded order-confirmation email) ----
  function receiptShell(content) {
    return `
      <div class="receipt-card">
        <div class="receipt-brand">
          <a class="receipt-brand-link" href="https://www.yehonam.com">
            <img class="receipt-brand-logo" src="images/logo.svg" width="210" height="71" alt="Yehonam — Suds, Hair &amp; Body">
          </a>
        </div>
        ${content}
      </div>
    `;
  }

  function orderInfoRows(data) {
    const address = (data.address || []).map((line) => escapeHtml(line)).join('<br>') || 'Not collected during checkout';
    const status = data.payment_status
      ? `${data.payment_status.charAt(0).toUpperCase()}${data.payment_status.slice(1)}`
      : 'Unpaid';

    return `
      <div class="receipt-row"><span class="receipt-row-label">Order reference</span><span class="receipt-row-value">${orderReference(data)}</span></div>
      <div class="receipt-row"><span class="receipt-row-label">Order date</span><span class="receipt-row-value">${formatReceiptDate(data.order_date)}</span></div>
      <div class="receipt-row"><span class="receipt-row-label">Payment status</span><span class="receipt-row-value receipt-row-value--paid">${escapeHtml(status)}</span></div>
    `;
  }

  function successHtml(data) {
    const name = typeof data.customer_name === 'string' ? data.customer_name.trim() : '';
    const greeting = name ? `Hello, ${escapeHtml(name)}` : 'Hello!';
    const address = (data.address || []).map((line) => escapeHtml(line)).join('<br>') || 'Not collected during checkout';

    const items = (data.line_items || []).map((item) => ({
      name: item && typeof item.description === 'string' && item.description
        ? item.description
        : 'Product',
      quantity: item && Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1,
      lineTotal: item ? formatAmount(item.amount_total, item.currency) : 'Not available',
    }));

    const productRows = items.length
      ? items.map((item) => `
          <tr>
            <td class="receipt-product-name">${escapeHtml(item.name)}</td>
            <td class="receipt-product-qty">${item.quantity}</td>
            <td class="receipt-product-total">${item.lineTotal}</td>
          </tr>`).join('')
      : '<tr><td class="receipt-empty" colspan="3">No items recorded</td></tr>';

    const discountRow = Number.isFinite(data.discount_amount) && data.discount_amount > 0
      ? `<div class="receipt-row"><span class="receipt-row-label">Discount</span><span class="receipt-row-value">-${formatAmount(data.discount_amount, data.currency)}</span></div>`
      : '';
    const taxRow = Number.isFinite(data.tax_amount) && data.tax_amount > 0
      ? `<div class="receipt-row"><span class="receipt-row-label">Tax</span><span class="receipt-row-value">+${formatAmount(data.tax_amount, data.currency)}</span></div>`
      : '';

    return receiptShell(`
      <h1 class="receipt-heading">YOUR ORDER IS CONFIRMED!</h1>
      <p class="receipt-sub">Payment successful.</p>
      <p class="receipt-message">${greeting} — thank you for your order. Your payment has been received and your order is being prepared.</p>
      <h2 class="receipt-section-title">ORDER INFORMATION</h2>
      <div class="receipt-rows">${orderInfoRows(data)}</div>
      <h2 class="receipt-section-title">YOUR ORDER</h2>
      <table class="receipt-product-table">
        <thead><tr><th>Product</th><th>Qty</th><th>Line Total</th></tr></thead>
        <tbody>${productRows}</tbody>
      </table>
      <h2 class="receipt-section-title">PAYMENT SUMMARY</h2>
      <div class="receipt-rows">
        <div class="receipt-row"><span class="receipt-row-label">Subtotal</span><span class="receipt-row-value">${formatAmount(data.amount_subtotal, data.currency)}</span></div>
        ${discountRow}${taxRow}
        <div class="receipt-row receipt-row--total"><span class="receipt-row-label">Total paid</span><span class="receipt-row-value receipt-row-value--bold">${formatAmount(data.amount_total, data.currency)}</span></div>
      </div>
      <h2 class="receipt-section-title">DELIVERY DETAILS</h2>
      <div class="receipt-rows">
        <div class="receipt-row"><span class="receipt-row-label">Recipient</span><span class="receipt-row-value">${escapeHtml(name || 'Not provided')}</span></div>
        <div class="receipt-row"><span class="receipt-row-label">Customer email</span><span class="receipt-row-value">${escapeHtml(customerEmail(data))}</span></div>
        <div class="receipt-row"><span class="receipt-row-label">Shipping address</span><span class="receipt-row-value">${address}</span></div>
      </div>
      <p class="receipt-delivery-info">Your delivery details have been received. Any applicable delivery charges will be communicated separately by the Yehonam team.</p>
      <p class="receipt-assistance">Questions? Email us at <a class="receipt-link" href="mailto:support@yehonam.com">support@yehonam.com</a> or visit our website at <a class="receipt-link" href="https://www.yehonam.com">www.yehonam.com</a>.</p>
      <div class="receipt-closing">
        <p class="receipt-closing-primary">Thank you for choosing Yehonam.</p>
        <p class="receipt-closing-secondary">With care, The Yehonam Team.</p>
        <a class="receipt-button" href="https://www.yehonam.com/shop">Continue Shopping</a>
        <p class="receipt-disclaimer">Automated order confirmation and payment receipt — your purchase has been recorded. Not an invoice.</p>
      </div>
    `);
  }

  function stateReceipt(heading, message, data, withInfo, actionsHtml) {
    return receiptShell(`
      <h1 class="receipt-heading">${escapeHtml(heading)}</h1>
      <p class="receipt-message">${message}</p>
      ${withInfo && data ? `<div class="receipt-rows">${orderInfoRows(data)}</div>` : ''}
      ${actionsHtml ? `<div class="receipt-actions">${actionsHtml}</div>` : ''}
    `);
  }

  function pendingHtml(data, noPaymentRequired) {
    return stateReceipt(
      'Payment Pending',
      noPaymentRequired
        ? 'This order did not require an online card payment, and it could not be confirmed automatically. Please contact support with the reference below.'
        : "We haven't received payment confirmation from Stripe yet. If you completed checkout, wait a moment and check again. Your cart has not been cleared.",
      data,
      true,
      `
        <button type="button" class="receipt-button" data-retry>Check Again</button>
        <a class="receipt-button receipt-button--outline" href="${noPaymentRequired ? 'contact.html' : 'cart.html'}">${noPaymentRequired ? 'Contact Support' : 'Return to Cart'}</a>
      `
    );
  }

  function failedHtml(data) {
    return stateReceipt(
      'Payment Not Completed',
      'Stripe did not confirm this order as paid. Your cart has not been cleared, so you can review it and try again.',
      data,
      true,
      '<a class="receipt-button" href="cart.html">Return to Cart</a><a class="receipt-button receipt-button--outline" href="contact.html">Contact Support</a>'
    );
  }

  function invalidHtml(message) {
    return stateReceipt(
      'Order Not Found',
      `${escapeHtml(message)} If you completed a payment, contact support with your receipt or order reference.`,
      null,
      false,
      '<a class="receipt-button" href="shop.html">Continue Shopping</a><a class="receipt-button receipt-button--outline" href="contact.html">Contact Support</a>'
    );
  }

  function errorHtml() {
    return stateReceipt(
      'Unable to Verify Order',
      "We couldn't reach the payment service. Your cart has not been cleared. Please check your connection and try again.",
      null,
      false,
      '<button type="button" class="receipt-button" data-retry>Try Again</button><a class="receipt-button receipt-button--outline" href="contact.html">Contact Support</a>'
    );
  }

  function setLoading() {
    resultEl.hidden = true;
    resultEl.innerHTML = '';
    loadingEl.hidden = false;
  }

  function setResult(html, state) {
    loadingEl.hidden = true;
    resultEl.hidden = false;
    resultEl.dataset.state = state;
    resultEl.innerHTML = html;
    document.title = state === 'success'
      ? 'Order Confirmed — Yehonam Suds, Hair & Body'
      : 'Order Status — Yehonam Suds, Hair & Body';

    resultEl.querySelectorAll('[data-retry]').forEach((button) => {
      button.addEventListener('click', verify);
    });
  }

  async function fetchVerification(id) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`/api/verify-order?session_id=${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      return { response, data };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function verify() {
    if (verifying) return;
    verifying = true;
    setLoading();

    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId) || sessionId.length > 255) {
      setResult(invalidHtml('This link is missing a valid order reference.'), 'invalid');
      verifying = false;
      return;
    }

    try {
      const { response, data } = await fetchVerification(sessionId);

      if (response.status === 404) {
        setResult(invalidHtml('We could not find an order for this link.'), 'invalid');
        return;
      }

      if (!response.ok || !data || typeof data !== 'object') {
        setResult(errorHtml(), 'error');
        return;
      }

      const paymentStatus = typeof data.payment_status === 'string' ? data.payment_status : 'unpaid';
      const verified = data.verified === true && paymentStatus === 'paid';

      if (verified) {
        // Render the verified state first, then clear the cart. A failed
        // verification or a pending payment never reaches this branch.
        setResult(successHtml(data), 'success');
        try {
          if (typeof Cart !== 'undefined' && Cart && typeof Cart.clearCart === 'function') {
            Cart.clearCart();
          }
        } catch (error) {
          // Storage can be blocked in privacy modes; the order is still paid.
          console.warn('Could not clear cart:', error);
        }
        return;
      }

      if (data.payment_failed === true || data.status === 'expired') {
        setResult(failedHtml(data), 'failed');
        return;
      }

      if (paymentStatus === 'no_payment_required') {
        setResult(pendingHtml(data, true), 'pending');
        return;
      }

      setResult(pendingHtml(data, false), 'pending');
    } catch (error) {
      console.error('Order verification error:', error);
      setResult(errorHtml(), 'error');
    } finally {
      verifying = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', verify);
  } else {
    verify();
  }
})();
