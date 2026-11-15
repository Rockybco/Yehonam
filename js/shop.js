/**
 * YEHONAM SUDS — SHOP & STRIPE PRODUCT LOADER
 * Fetches products from Stripe via serverless functions
 * Handles filtering, sorting, and product display
 */

const Shop = (() => {
  let allProducts = [];
  let activeFilters = { category: 'all', availability: 'all', sort: 'featured' };

  // ---- FETCH PRODUCTS ----
  async function fetchProducts(params = {}) {
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`/api/get-products${qs ? '?' + qs : ''}`);
      if (!res.ok) throw new Error('Failed to load products');
      const data = await res.json();
      return data.products || [];
    } catch (err) {
      console.error('Product fetch error:', err);
      return [];
    }
  }

  // ---- RENDER PRODUCT CARD ----
  function renderProductCard(product) {
    const image = product.images?.[0] || '';
    const price = product.price || 0;
    const originalPrice = product.metadata?.original_price;
    const category = product.metadata?.category || 'Product';
    const featured = product.metadata?.featured === 'true';
    const bestseller = product.metadata?.bestseller === 'true';
    const isNew = product.metadata?.new === 'true';

    let badge = '';
    if (bestseller) badge = `<span class="product-badge">Bestseller</span>`;
    else if (isNew) badge = `<span class="product-badge new">New</span>`;
    else if (originalPrice) badge = `<span class="product-badge sale">Sale</span>`;

    const imgHtml = image
      ? `<img src="${image}" alt="${product.name}" loading="lazy">`
      : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#0E6B3B,#084D29);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.25);font-family:Georgia,serif;font-style:italic;padding:20px;text-align:center;">${product.name}</div>`;

    return `
      <div class="product-card fade-in" data-id="${product.id}" data-category="${category.toLowerCase()}">
        <a href="product.html?id=${product.id}">
          <div class="product-img-wrap">
            ${imgHtml}
            ${badge}
          </div>
        </a>
        <div class="product-info">
          <div class="product-category">${category}</div>
          <a href="product.html?id=${product.id}">
            <h3 class="product-name">${product.name}</h3>
          </a>
          <div class="product-pricing">
            <span class="product-price">${Cart.formatPrice(price)}</span>
            ${originalPrice ? `<span class="product-original-price">${Cart.formatPrice(parseInt(originalPrice))}</span>` : ''}
          </div>
          <div class="product-card-actions">
            <button class="btn btn-primary btn-sm" style="flex:1" onclick="addToCart('${product.id}', '${product.name}', ${price}, '${product.priceId}', '${image}', '${category}')">
              Add to Cart
            </button>
            <a href="product.html?id=${product.id}" class="btn btn-outline-gold btn-sm">View</a>
          </div>
        </div>
      </div>
    `;
  }

  // ---- LOAD FEATURED PRODUCTS (homepage) ----
  async function loadFeatured(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading products...</p></div>`;

    const products = await fetchProducts({ featured: 'true', limit: 4 });

    if (!products.length) {
      container.innerHTML = `<p class="no-products">Products coming soon. Check back later!</p>`;
      return;
    }

    container.innerHTML = products.map(renderProductCard).join('');
    initFadeIn();
  }

  // ---- LOAD SHOP PAGE PRODUCTS ----
  async function loadShop(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading products...</p></div>`;

    allProducts = await fetchProducts();
    renderFilteredProducts(container);
  }

  function renderFilteredProducts(container) {
    let products = [...allProducts];

    // Category filter
    if (activeFilters.category !== 'all') {
      products = products.filter(p =>
        (p.metadata?.category || '').toLowerCase() === activeFilters.category.toLowerCase()
      );
    }

    // Availability
    if (activeFilters.availability === 'available') {
      products = products.filter(p => p.active !== false);
    }

    // Search
    const q = activeFilters.search?.toLowerCase();
    if (q) {
      products = products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
    }

    // Price range
    if (activeFilters.minPrice) products = products.filter(p => p.price >= activeFilters.minPrice * 100);
    if (activeFilters.maxPrice) products = products.filter(p => p.price <= activeFilters.maxPrice * 100);

    // Sort
    switch (activeFilters.sort) {
      case 'price-asc':  products.sort((a, b) => a.price - b.price); break;
      case 'price-desc': products.sort((a, b) => b.price - a.price); break;
      case 'name-asc':   products.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'name-desc':  products.sort((a, b) => b.name.localeCompare(a.name)); break;
      case 'newest':     products.sort((a, b) => b.created - a.created); break;
      default:           products.sort((a, b) => (a.metadata?.display_order || 999) - (b.metadata?.display_order || 999));
    }

    const countEl = document.getElementById('products-count');
    if (countEl) countEl.textContent = `${products.length} product${products.length !== 1 ? 's' : ''}`;

    if (!products.length) {
      container.innerHTML = `<div class="no-products"><p>No products found. Try adjusting your filters.</p></div>`;
      return;
    }

    container.innerHTML = products.map(renderProductCard).join('');
  }

  // ---- LOAD SINGLE PRODUCT ----
  async function loadProduct(productId) {
    try {
      const res = await fetch(`/api/get-product?id=${productId}`);
      if (!res.ok) throw new Error('Product not found');
      return await res.json();
    } catch (err) {
      console.error('Product load error:', err);
      return null;
    }
  }

  // ---- RENDER PRODUCT DETAIL PAGE ----
  async function renderProductPage() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) { window.location.href = 'shop.html'; return; }

    const wrap = document.getElementById('product-detail-wrap');
    if (!wrap) return;

    wrap.innerHTML = `<div class="loading-spinner" style="grid-column:1/-1"><div class="spinner"></div><p>Loading product...</p></div>`;

    const product = await loadProduct(id);

    if (!product) {
      wrap.innerHTML = `<div class="no-products"><p>Product not found. <a href="shop.html" style="color:var(--emerald)">Browse all products →</a></p></div>`;
      return;
    }

    const price = product.price || 0;
    const originalPrice = product.metadata?.original_price;
    const category = product.metadata?.category || '';
    const images = product.images || [];

    document.title = `${product.name} — Yehonam Suds`;

    wrap.innerHTML = `
      <div class="product-gallery">
        <div class="gallery-main" id="gallery-main">
          ${images[0]
            ? `<img src="${images[0]}" alt="${product.name}" id="main-img">`
            : `<div class="hero-placeholder"><svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><circle cx="9" cy="13" r="2"/><path d="M21 15l-5-5L5 20"/></svg><p>${product.name}</p></div>`
          }
        </div>
        ${images.length > 1 ? `
          <div class="gallery-thumbs">
            ${images.map((img, i) => `
              <div class="gallery-thumb ${i === 0 ? 'active' : ''}" onclick="switchImage(this, '${img}')">
                <img src="${img}" alt="${product.name} view ${i + 1}">
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <div class="product-detail-info">
        <div class="breadcrumb">
          <a href="index.html">Home</a> / 
          <a href="shop.html">Shop</a> / 
          ${category ? `<a href="shop.html?category=${category.toLowerCase()}">${category}</a> / ` : ''}
          <span>${product.name}</span>
        </div>

        <h1 class="product-detail-title">${product.name}</h1>

        <div class="product-detail-price">
          ${Cart.formatPrice(price)}
          ${originalPrice ? `<span class="original">${Cart.formatPrice(parseInt(originalPrice))}</span>` : ''}
        </div>

        <p class="product-desc">${product.description || product.metadata?.short_description || 'Quality beauty and care product from Yehonam Suds.'}</p>

        ${product.metadata?.sizes ? `
          <div class="product-options">
            <span class="option-label">Size</span>
            <div class="option-buttons" id="size-options">
              ${product.metadata.sizes.split(',').map((s, i) => `
                <button class="option-btn ${i === 0 ? 'selected' : ''}" onclick="selectOption(this, 'size')">${s.trim()}</button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="qty-selector" id="qty-selector">
          <button class="qty-btn" onclick="changeQty(-1)">−</button>
          <span class="qty-num" id="qty-display">1</span>
          <button class="qty-btn" onclick="changeQty(1)">+</button>
        </div>

        <div class="product-cta">
          <button class="btn btn-primary" style="flex:1" onclick="addProductToCart('${product.id}', '${product.name}', ${price}, '${product.priceId}', '${images[0] || ''}', '${category}')">
            Add to Cart
          </button>
          <button class="btn btn-dark" style="flex:1" onclick="buyNow('${product.id}', '${product.name}', ${price}, '${product.priceId}', '${images[0] || ''}', '${category}')">
            Buy Now
          </button>
        </div>

        <div class="product-tabs">
          <div class="tab-buttons">
            ${product.metadata?.benefits ? `<button class="tab-btn active" onclick="switchTab(this, 'benefits')">Benefits</button>` : ''}
            ${product.metadata?.ingredients ? `<button class="tab-btn ${!product.metadata?.benefits ? 'active' : ''}" onclick="switchTab(this, 'ingredients')">Ingredients</button>` : ''}
            ${product.metadata?.directions ? `<button class="tab-btn" onclick="switchTab(this, 'directions')">How to Use</button>` : ''}
            <button class="tab-btn" onclick="switchTab(this, 'shipping-info')">Shipping</button>
          </div>

          ${product.metadata?.benefits ? `<div class="tab-panel active" id="tab-benefits"><p>${product.metadata.benefits}</p></div>` : ''}
          ${product.metadata?.ingredients ? `<div class="tab-panel ${!product.metadata?.benefits ? 'active' : ''}" id="tab-ingredients"><p>${product.metadata.ingredients}</p></div>` : ''}
          ${product.metadata?.directions ? `<div class="tab-panel" id="tab-directions"><p>${product.metadata.directions}</p></div>` : ''}
          <div class="tab-panel" id="tab-shipping-info">
            <p>We offer standard UK delivery (3–5 working days) and express delivery (1–2 working days). Free shipping on orders over £50. International shipping available. See our <a href="shipping.html" style="color:var(--gold)">Shipping & Returns</a> page for full details.</p>
          </div>
        </div>
      </div>
    `;
  }

  // ---- FILTER INIT ----
  function initFilters() {
    const container = document.getElementById('shop-products');
    if (!container) return;

    // Category filter buttons
    document.querySelectorAll('[data-filter-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-filter-cat]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilters.category = btn.dataset.filterCat;
        renderFilteredProducts(container);
      });
    });

    // Sort select
    const sortEl = document.getElementById('sort-select');
    if (sortEl) {
      sortEl.addEventListener('change', () => {
        activeFilters.sort = sortEl.value;
        renderFilteredProducts(container);
      });
    }

    // Search
    const searchInput = document.getElementById('product-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        activeFilters.search = searchInput.value;
        renderFilteredProducts(container);
      });
    }

    // URL category param
    const urlCat = new URLSearchParams(location.search).get('category');
    if (urlCat) {
      activeFilters.category = urlCat;
      const btn = document.querySelector(`[data-filter-cat="${urlCat}"]`);
      if (btn) {
        document.querySelectorAll('[data-filter-cat]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    }
  }

  // ---- FADE IN ----
  // Reveal animations are handled globally by main.js via IntersectionObserver,
  // including cards injected after load.

  return { loadFeatured, loadShop, renderProductPage, initFilters, renderFilteredProducts };
})();

// ---- GLOBAL HELPERS (called from inline HTML) ----
let currentQty = 1;

function changeQty(delta) {
  currentQty = Math.max(1, currentQty + delta);
  const el = document.getElementById('qty-display');
  if (el) el.textContent = currentQty;
}

function selectOption(btn, group) {
  btn.closest('.option-buttons').querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function switchImage(thumb, src) {
  document.querySelectorAll('.gallery-thumb').forEach(t => t.classList.remove('active'));
  thumb.classList.add('active');
  const main = document.getElementById('main-img');
  if (main) main.src = src;
}

function switchTab(btn, tabId) {
  btn.closest('.tab-buttons').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  btn.closest('.product-tabs').querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + tabId);
  if (panel) panel.classList.add('active');
}

function getSelectedVariant() {
  const btn = document.querySelector('.option-btn.selected');
  return btn ? btn.textContent.trim() : '';
}

function addToCart(id, name, price, priceId, image, category) {
  Cart.addItem({ id, name, price, priceId, image, category, qty: 1 });
}

function addProductToCart(id, name, price, priceId, image, category) {
  const variant = getSelectedVariant();
  Cart.addItem({ id, name, price, priceId, image, category, variant, qty: currentQty });
}

async function buyNow(id, name, price, priceId, image, category) {
  const variant = getSelectedVariant();
  Cart.addItem({ id, name, price, priceId, image, category, variant, qty: currentQty });
  window.location.href = 'cart.html';
}

async function proceedToCheckout() {
  const items = Cart.getCheckoutItems();
  if (!items.length) return;

  const btn = document.getElementById('checkout-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, success_url: `${location.origin}/confirmation.html?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${location.origin}/cart.html` })
    });

    if (!res.ok) throw new Error('Checkout failed');
    const { url } = await res.json();
    if (url) window.location.href = url;
  } catch (err) {
    Cart.showToast('Checkout failed. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Proceed to Checkout'; }
  }
}

// ---- PAGE INIT ----
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;

  if (page === 'home' && document.getElementById('featured-products')) {
    Shop.loadFeatured('featured-products');
  }

  if (page === 'shop') {
    Shop.loadShop('shop-products');
    Shop.initFilters();
  }

  if (page === 'product') {
    Shop.renderProductPage();
  }
});
