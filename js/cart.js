/**
 * YEHONAM SUDS — SHOPPING CART
 * Persistent cart via localStorage
 */

const Cart = (() => {
  const STORAGE_KEY = 'yehonam_cart';

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
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
    // item: { id, priceId, name, price, image, category, variant }
    const cart = getCart();
    const key = item.variant ? `${item.id}_${item.variant}` : item.id;
    const existing = cart.find(i => i.key === key);

    if (existing) {
      existing.qty = (existing.qty || 1) + (item.qty || 1);
    } else {
      cart.push({ ...item, key, qty: item.qty || 1 });
    }
    saveCart(cart);
    showToast(`"${item.name}" added to cart ✓`);
  }

  function removeItem(key) {
    const cart = getCart().filter(i => i.key !== key);
    saveCart(cart);
  }

  function updateQty(key, qty) {
    const cart = getCart();
    const item = cart.find(i => i.key === key);
    if (item) {
      item.qty = Math.max(1, qty);
      saveCart(cart);
    }
  }

  function clearCart() {
    localStorage.removeItem(STORAGE_KEY);
    updateBadge();
    dispatchUpdate();
  }

  function getCount() {
    return getCart().reduce((sum, i) => sum + (i.qty || 1), 0);
  }

  function getTotal() {
    return getCart().reduce((sum, i) => sum + (i.price * (i.qty || 1)), 0);
  }

  function updateBadge() {
    const count = getCount();
    document.querySelectorAll('.cart-count').forEach(el => {
      el.textContent = count;
      el.style.display = count > 0 ? 'flex' : 'none';
    });
  }

  function dispatchUpdate() {
    document.dispatchEvent(new CustomEvent('cartUpdated', { detail: { count: getCount(), total: getTotal() } }));
  }

  function formatPrice(cents) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  function showToast(message, type = 'success') {
    let toast = document.getElementById('cart-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cart-toast';
      toast.className = 'toast';
      toast.innerHTML = `<span class="toast-icon">✓</span><span class="toast-msg"></span>`;
      document.body.appendChild(toast);
    }
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

    wrap.innerHTML = cart.map(item => `
      <div class="cart-item" data-key="${item.key}">
        <div class="cart-item-img">
          ${item.image
            ? `<img src="${item.image}" alt="${item.name}" loading="lazy">`
            : `<div style="width:100%;height:100%;background:linear-gradient(135deg,var(--emerald),var(--dark-green));display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);font-style:italic;font-size:0.75rem;text-align:center;padding:8px;">Product</div>`
          }
        </div>
        <div>
          <div class="cart-item-name">${item.name}</div>
          ${item.variant ? `<div class="cart-item-variant">${item.variant}</div>` : ''}
          <div class="product-pricing">
            <span class="product-price">${formatPrice(item.price * item.qty)}</span>
            <span style="font-size:0.8rem;color:var(--gray-500)">(${formatPrice(item.price)} each)</span>
          </div>
          <button class="cart-item-remove" onclick="Cart.removeItem('${item.key}')">Remove</button>
        </div>
        <div class="qty-selector">
          <button class="qty-btn" onclick="Cart.updateQty('${item.key}', ${item.qty - 1})">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="Cart.updateQty('${item.key}', ${item.qty + 1})">+</button>
        </div>
      </div>
    `).join('');

    // Update summary — shipping is calculated by Stripe at checkout
    const subtotal = getTotal();

    const sub = document.getElementById('summary-subtotal');
    const shp = document.getElementById('summary-shipping');
    const tot = document.getElementById('summary-total');
    if (sub) sub.textContent = formatPrice(subtotal);
    if (shp) shp.textContent = 'Calculated at checkout';
    if (tot) tot.textContent = formatPrice(subtotal);
  }

  // Build checkout line items for serverless function
  function getCheckoutItems() {
    return getCart().map(item => ({
      price: item.priceId,
      quantity: item.qty || 1
    }));
  }

  // Init on load
  function init() {
    updateBadge();
    if (document.getElementById('cart-items-wrap')) {
      renderCartPage();
      document.addEventListener('cartUpdated', renderCartPage);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { addItem, removeItem, updateQty, clearCart, getCart, getCount, getTotal, getCheckoutItems, formatPrice, showToast, renderCartPage };
})();
