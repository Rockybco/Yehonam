/**
 * YEHONAM SUDS — SHOPPING CART
 * Persistent cart via localStorage.
 *
 * Cart entries are display data only. Checkout sends Stripe Price IDs and
 * quantities; the server always re-checks the real price and product status.
 */

const Cart = (() => {
  const STORAGE_KEY = 'yehonam_cart';
  const MAX_QTY = 10;
  const PRICE_ID_RE = /^price_[A-Za-z0-9]+$/;
  const PRODUCT_ID_RE = /^prod_[A-Za-z0-9]+$/;

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

  function safeImageUrl(value) {
    if (typeof value !== 'string') return '';
    const raw = value.trim();
    if (!raw || raw.length > 2048) return '';
    const candidate = raw.startsWith('//') ? `https:${raw}` : raw;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function isValidPriceId(value) {
    return typeof value === 'string' && value.length <= 255 && PRICE_ID_RE.test(value);
  }

  function normalizeQty(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(Math.max(parsed, 1), MAX_QTY);
  }

  function getCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item, index) => ({
          id: typeof item.id === 'string' ? item.id : '',
          priceId: typeof item.priceId === 'string' ? item.priceId : '',
          name: typeof item.name === 'string' ? item.name.slice(0, 250) : '',
          price: Number(item.price),
          image: typeof item.image === 'string' ? item.image : '',
          category: typeof item.category === 'string' ? item.category.slice(0, 100) : '',
          variant: typeof item.variant === 'string' ? item.variant.slice(0, 60) : '',
          qty: normalizeQty(item.qty),
          key: typeof item.key === 'string' && item.key ? item.key : `legacy_${index}`,
        }));
    } catch {
      return [];
    }
  }

  function saveCart(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    updateBadge();
    dispatchUpdate();
  }

  function addItem(item) {
    if (!item || typeof item !== 'object') {
      showToast('This item is currently unavailable.', 'error');
      return false;
    }

    const id = typeof item.id === 'string' && PRODUCT_ID_RE.test(item.id) ? item.id : '';
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 250) : '';
    const priceId = isValidPriceId(item.priceId) ? item.priceId : '';
    const price = Number(item.price);

    if (!id || !name || !priceId || !Number.isInteger(price) || price <= 0) {
      showToast('This item is currently unavailable.', 'error');
      return false;
    }

    const variant = typeof item.variant === 'string' ? item.variant.trim().slice(0, 60) : '';
    const image = safeImageUrl(item.image);
    const category = typeof item.category === 'string' ? item.category.trim().slice(0, 100) : '';
    const qty = normalizeQty(item.qty);
    const key = `${id}_${priceId}${variant ? '_' + variant : ''}`;

    const cart = getCart();
    const existing = cart.find((entry) => entry.key === key);

    if (existing) {
      existing.qty = Math.min(MAX_QTY, normalizeQty(existing.qty) + qty);
      existing.name = name;
      existing.price = price;
      existing.image = image;
      existing.category = category;
    } else {
      cart.push({ id, priceId, name, price, image, category, variant, qty, key });
    }

    saveCart(cart);
    showToast(`"${name}" added to cart ✓`);
    return true;
  }

  function removeItem(key) {
    const cart = getCart().filter((item) => item.key !== key);
    saveCart(cart);
  }

  function updateQty(key, qty) {
    const cart = getCart();
    const item = cart.find((entry) => entry.key === key);
    if (!item) return;

    item.qty = normalizeQty(qty);
    saveCart(cart);
  }

  function clearCart() {
    localStorage.removeItem(STORAGE_KEY);
    updateBadge();
    dispatchUpdate();
  }

  function getCount() {
    return getCart().reduce((sum, item) => sum + normalizeQty(item.qty), 0);
  }

  function getTotal() {
    return getCart().reduce((sum, item) => {
      if (!isValidPriceId(item.priceId)) return sum;
      const price = Number(item.price);
      return sum + (Number.isInteger(price) && price > 0 ? price * normalizeQty(item.qty) : 0);
    }, 0);
  }

  function updateBadge() {
    const count = getCount();
    document.querySelectorAll('.cart-count').forEach((el) => {
      el.textContent = count;
      el.style.display = count > 0 ? 'flex' : 'none';
    });
  }

  function dispatchUpdate() {
    document.dispatchEvent(new CustomEvent('cartUpdated', {
      detail: { count: getCount(), total: getTotal() },
    }));
  }

  function formatPrice(cents) {
    const amount = Number(cents);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format((Number.isFinite(amount) ? amount : 0) / 100);
  }

  function showToast(message, type = 'success') {
    let toast = document.getElementById('cart-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cart-toast';
      toast.className = 'toast';
      toast.innerHTML = '<span class="toast-icon">✓</span><span class="toast-msg"></span>';
      document.body.appendChild(toast);
    }

    toast.dataset.type = type;
    const icon = toast.querySelector('.toast-icon');
    if (icon) icon.textContent = type === 'error' ? '!' : '✓';
    toast.querySelector('.toast-msg').textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  // Render cart page
  function renderCartPage() {
    const wrap = document.getElementById('cart-items-wrap');
    const emptyWrap = document.getElementById('cart-empty');
    const summaryWrap = document.getElementById('cart-summary-wrap');
    if (!wrap) return;

    const cart = getCart();

    if (cart.length === 0) {
      wrap.innerHTML = '';
      if (emptyWrap) emptyWrap.style.display = 'block';
      if (summaryWrap) summaryWrap.style.display = 'none';
      return;
    }

    if (emptyWrap) emptyWrap.style.display = 'none';
    if (summaryWrap) summaryWrap.style.display = 'block';

    wrap.innerHTML = cart.map((item) => {
      const name = escapeHtml(item.name || 'Product');
      const variant = typeof item.variant === 'string' ? item.variant : '';
      const key = escapeHtml(item.key);
      const image = safeImageUrl(item.image);
      const price = Number(item.price);
      const qty = normalizeQty(item.qty);
      const available = isValidPriceId(item.priceId) && Number.isInteger(price) && price > 0;

      return `
        <div class="cart-item" data-key="${key}">
          <div class="cart-item-img">
            ${image
              ? `<img src="${escapeHtml(image)}" alt="${name}" loading="lazy">`
              : '<div style="width:100%;height:100%;background:linear-gradient(135deg,var(--emerald),var(--dark-green));display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);font-style:italic;font-size:0.75rem;text-align:center;padding:8px;">Product</div>'
            }
          </div>
          <div>
            <div class="cart-item-name">${name}</div>
            ${variant ? `<div class="cart-item-variant">${escapeHtml(variant)}</div>` : ''}
            ${available ? `
              <div class="product-pricing">
                <span class="product-price">${formatPrice(price * qty)}</span>
                <span style="font-size:0.8rem;color:var(--gray-500)">(${formatPrice(price)} each)</span>
              </div>
            ` : `
              <div class="cart-item-unavailable">This item is no longer available. Please remove it.</div>
            `}
            <button type="button" class="cart-item-remove" data-remove-key="${key}">Remove</button>
          </div>
          ${available ? `
            <div class="qty-selector">
              <button type="button" class="qty-btn" data-qty-key="${key}" data-qty-delta="-1" aria-label="Decrease quantity">−</button>
              <span class="qty-num">${qty}</span>
              <button type="button" class="qty-btn" data-qty-key="${key}" data-qty-delta="1" aria-label="Increase quantity">+</button>
            </div>
          ` : '<div></div>'}
        </div>
      `;
    }).join('');

    // No shipping is added to the cart total; delivery charges are
  // communicated separately during checkout.
    const subtotal = getTotal();

    const sub = document.getElementById('summary-subtotal');
    const shipping = document.getElementById('summary-shipping');
    const total = document.getElementById('summary-total');
    if (sub) sub.textContent = formatPrice(subtotal);
    if (shipping) shipping.textContent = 'Delivery charges, where applicable, are communicated separately by the business.';
    if (total) total.textContent = formatPrice(subtotal);
  }

  // Build checkout line items for the serverless function.
  function getCheckoutItems() {
    return getCart()
      .filter((item) => isValidPriceId(item.priceId) && Number.isInteger(Number(item.price)) && Number(item.price) > 0)
      .map((item) => ({
        priceId: item.priceId,
        quantity: normalizeQty(item.qty),
      }));
  }

  function getInvalidItemCount() {
    return getCart().filter((item) =>
      !isValidPriceId(item.priceId) ||
      !Number.isInteger(Number(item.price)) ||
      Number(item.price) <= 0
    ).length;
  }

  function init() {
    updateBadge();

    const wrap = document.getElementById('cart-items-wrap');
    if (!wrap) return;

    wrap.addEventListener('click', (event) => {
      const target = event.target && event.target.closest ? event.target : null;
      if (!target) return;

      const removeButton = target.closest('[data-remove-key]');
      if (removeButton) {
        removeItem(removeButton.dataset.removeKey);
        return;
      }

      const qtyButton = target.closest('[data-qty-key]');
      if (qtyButton) {
        const key = qtyButton.dataset.qtyKey;
        const item = getCart().find((entry) => entry.key === key);
        if (!item) return;

        const delta = Number(qtyButton.dataset.qtyDelta);
        updateQty(key, normalizeQty(item.qty) + (Number.isFinite(delta) ? delta : 0));
      }
    });

    renderCartPage();
    document.addEventListener('cartUpdated', renderCartPage);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    addItem,
    removeItem,
    updateQty,
    clearCart,
    getCart,
    getCount,
    getTotal,
    getCheckoutItems,
    getInvalidItemCount,
    formatPrice,
    showToast,
    renderCartPage,
  };
})();
