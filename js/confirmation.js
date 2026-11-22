/**
 * YEHONAM SUDS — ORDER CONFIRMATION
 *
 * A redirect from Stripe is not proof of payment. This page asks the server
 * to verify the Checkout Session and only shows the success state when Stripe
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

  function lineItemsHtml(items) {
    if (!Array.isArray(items) || items.length === 0) return '';

    return `
      <div class="order-items">
        <div class="order-items-title">Items</div>
        ${items.map((item) => {
          const description = escapeHtml(
            item && typeof item.description === 'string' ? item.description : 'Item'
          );
          const quantity = item && Number.isInteger(item.quantity) && item.quantity > 0
            ? item.quantity
            : 1;
          const amount = item
            ? formatAmount(item.amount_total, item.currency)
            : 'Not available';

          return `<div class="order-item-line"><span>${description} × ${quantity}</span><span>${amount}</span></div>`;
        }).join('')}
      </div>
    `;
  }

  function orderDetails(data, statusText) {
    const email = customerEmail(data);

    return `
      <div class="order-summary-box">
        <div class="order-detail-row">
          <span>Order Reference</span>
          <strong>${orderReference(data)}</strong>
        </div>
        ${email ? `
          <div class="order-detail-row">
            <span>Email</span>
            <span>${escapeHtml(email)}</span>
          </div>
        ` : ''}
        <div class="order-detail-row">
          <span>${statusText === 'Paid' ? 'Amount Paid' : 'Status'}</span>
          <strong>${statusText === 'Paid' ? formatAmount(data.amount_total, data.currency) : escapeHtml(statusText)}</strong>
        </div>
        ${statusText === 'Paid' ? lineItemsHtml(data.line_items) : ''}
      </div>
    `;
  }

  function successHtml(data) {
    return `
      <div class="confirmation-icon">
        <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h1>Order Confirmed!</h1>
      <p>Thank you for shopping with Yehonam Suds. Your payment has been confirmed by Stripe and your order is being prepared.</p>

      ${orderDetails(data, 'Paid')}

      <div class="confirmation-actions">
        <a href="shop.html" class="btn btn-primary">Continue Shopping</a>
        <a href="contact.html" class="btn btn-outline-gold">Contact Support</a>
      </div>

      <div class="confirmation-steps">
        <div>
          <div class="confirmation-step-icon">📦</div>
          <div class="confirmation-step-title">Processing</div>
          <div class="confirmation-step-text">Order being prepared</div>
        </div>
        <div>
          <div class="confirmation-step-icon">🚚</div>
          <div class="confirmation-step-title">Shipping</div>
          <div class="confirmation-step-text">3–5 business days</div>
        </div>
        <div>
          <div class="confirmation-step-icon">✨</div>
          <div class="confirmation-step-title">Delivered</div>
          <div class="confirmation-step-text">Enjoy your products</div>
        </div>
      </div>
    `;
  }

  function pendingHtml(data, noPaymentRequired) {
    return `
      <div class="confirmation-icon pending">
        <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <h1>Payment Pending</h1>
      <p>${noPaymentRequired
        ? 'This order did not require an online card payment, and it could not be confirmed automatically. Please contact support with the reference below.'
        : "We haven't received payment confirmation from Stripe yet. If you completed checkout, wait a moment and check again. Your cart has not been cleared."
      }</p>

      ${orderDetails(data, noPaymentRequired ? 'Payment not required' : 'Pending')}

      <div class="confirmation-actions">
        <button type="button" class="btn btn-primary" data-retry>Check Again</button>
        <a href="${noPaymentRequired ? 'contact.html' : 'cart.html'}" class="btn btn-outline-gold">
          ${noPaymentRequired ? 'Contact Support' : 'Return to Cart'}
        </a>
      </div>
    `;
  }

  function failedHtml(data) {
    return `
      <div class="confirmation-icon error">
        <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <h1>Payment Not Completed</h1>
      <p>Stripe did not confirm this order as paid. Your cart has not been cleared, so you can review it and try again.</p>

      ${orderDetails(data, 'Not paid')}

      <div class="confirmation-actions">
        <a href="cart.html" class="btn btn-primary">Return to Cart</a>
        <a href="contact.html" class="btn btn-outline-gold">Contact Support</a>
      </div>
    `;
  }

  function invalidHtml(message) {
    return `
      <div class="confirmation-icon error">
        <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <h1>Order Not Found</h1>
      <p>${escapeHtml(message)} If you completed a payment, contact support with your receipt or order reference.</p>

      <div class="confirmation-actions">
        <a href="shop.html" class="btn btn-primary">Continue Shopping</a>
        <a href="contact.html" class="btn btn-outline-gold">Contact Support</a>
      </div>
    `;
  }

  function errorHtml() {
    return `
      <div class="confirmation-icon error">
        <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <h1>Unable to Verify Order</h1>
      <p>We couldn't reach the payment service. Your cart has not been cleared. Please check your connection and try again.</p>

      <div class="confirmation-actions">
        <button type="button" class="btn btn-primary" data-retry>Try Again</button>
        <a href="contact.html" class="btn btn-outline-gold">Contact Support</a>
      </div>
    `;
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
