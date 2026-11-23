/**
 * YEHONAM SUDS — SHOP & STRIPE PRODUCT LOADER
 * Fetches products from Stripe via serverless functions.
 * Handles filtering, sorting, variants and product display.
 *
 * Security: all Stripe-provided text is escaped before it is inserted into
 * HTML. Checkout sends only Stripe Price IDs and quantities; the server
 * re-validates every price and amount.
 */

const Shop = (() => {
  const MAX_QTY = 10;
  const productCache = new Map();
  let allProducts = [];
  let activeFilters = { category: 'all', availability: 'all', sort: 'featured' };
  let lastFetchFailed = false;
  let currentQty = 1;

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

  function formatMultiline(value) {
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
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

  function normalizeVariants(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const variants = [];

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const priceId = typeof item.priceId === 'string' && /^price_[A-Za-z0-9]+$/.test(item.priceId)
        ? item.priceId
        : '';
      const amount = Number.isInteger(item.amount) && item.amount > 0 ? item.amount : null;
      if (!priceId || amount === null || seen.has(priceId)) continue;

      seen.add(priceId);
      variants.push({
        priceId,
        amount,
        label: typeof item.label === 'string' ? item.label.trim().slice(0, 60) : '',
      });
    }

    return variants;
  }

  function normalizeProduct(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const id = typeof raw.id === 'string' && /^prod_[A-Za-z0-9]+$/.test(raw.id) ? raw.id : '';
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 250) : '';
    if (!id || !name) return null;

    const variants = normalizeVariants(raw.variants);
    const rawPriceId = typeof raw.priceId === 'string' && /^price_[A-Za-z0-9]+$/.test(raw.priceId)
      ? raw.priceId
      : '';

    let selected = variants.find((variant) => variant.priceId === rawPriceId) || variants[0] || null;
    if (!selected && rawPriceId && Number.isInteger(raw.price) && raw.price > 0) {
      selected = { priceId: rawPriceId, amount: raw.price, label: '' };
      variants.push(selected);
    }

    const metadata = {};
    if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
      for (const [key, value] of Object.entries(raw.metadata)) {
        if (typeof value === 'string') metadata[key] = value;
      }
    }

    return {
      id,
      name,
      description: typeof raw.description === 'string' ? raw.description.slice(0, 5000) : '',
      images: Array.isArray(raw.images)
        ? raw.images.map(safeImageUrl).filter(Boolean).slice(0, 8)
        : [],
      priceId: selected ? selected.priceId : null,
      price: selected ? selected.amount : 0,
      currency: typeof raw.currency === 'string' ? raw.currency : 'usd',
      priceIsFrom: raw.priceIsFrom === true,
      variants,
      metadata,
      active: raw.active !== false,
      created: Number.isFinite(raw.created) ? raw.created : 0,
    };
  }

  function productDisplayOrder(product) {
    const parsed = parseInt(product.metadata && product.metadata.display_order, 10);
    return Number.isFinite(parsed) ? parsed : 999;
  }

  function loadingHtml(message) {
    return `<div class="loading-spinner" style="grid-column:1/-1"><div class="spinner"></div><p>${escapeHtml(message)}</p></div>`;
  }

  function noProductsHtml(message) {
    return `<div class="no-products"><p>${message}</p></div>`;
  }

  function loadErrorHtml() {
    return `<div class="no-products"><p>We couldn't load products right now. Please try again shortly.</p><button type="button" class="btn btn-outline-gold btn-sm" data-retry-products>Try Again</button></div>`;
  }

  // ---- FETCH PRODUCTS ----
  async function fetchProducts(params = {}) {
    lastFetchFailed = false;

    try {
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`/api/get-products${qs ? '?' + qs : ''}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Product request failed (${res.status})`);

      const data = await res.json();
      if (!data || !Array.isArray(data.products)) throw new Error('Invalid product response');

      const products = data.products.map(normalizeProduct).filter(Boolean);
      products.forEach((product) => productCache.set(product.id, product));
      return products;
    } catch (err) {
      console.error('Product fetch error:', err);
      lastFetchFailed = true;
      return [];
    }
  }

  // ---- RENDER PRODUCT CARD ----
  function renderProductCard(product) {
    const image = product.images[0] || '';
    const name = escapeHtml(product.name);
    const categoryText = typeof product.metadata.category === 'string' ? product.metadata.category : '';
    const category = escapeHtml(categoryText || 'Product');
    const categoryKey = escapeHtml((categoryText || 'product').toLowerCase());
    const productUrl = `product.html?id=${encodeURIComponent(product.id)}`;
    const canBuy = Boolean(product.priceId);

    const originalPrice = parseInt(product.metadata.original_price, 10);
    const hasOriginalPrice = Number.isFinite(originalPrice) && originalPrice > product.price;
    const bestseller = String(product.metadata.bestseller || '').toLowerCase() === 'true';
    const isNew = String(product.metadata.new || '').toLowerCase() === 'true';

    let badge = '';
    if (bestseller) badge = `<span class="product-badge">Bestseller</span>`;
    else if (isNew) badge = `<span class="product-badge new">New</span>`;
    else if (hasOriginalPrice) badge = `<span class="product-badge sale">Sale</span>`;

    const imgHtml = image
      ? `<img src="${escapeHtml(image)}" alt="${name}" loading="lazy">`
      : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#0E6B3B,#084D29);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.25);font-family:Georgia,serif;font-style:italic;padding:20px;text-align:center;">${name}</div>`;

    const priceHtml = canBuy
      ? `${product.priceIsFrom ? '<span class="price-from">From </span>' : ''}${Cart.formatPrice(product.price)}`
      : 'Unavailable';

    return `
      <div class="product-card fade-in" data-id="${escapeHtml(product.id)}" data-category="${categoryKey}">
        <a href="${productUrl}">
          <div class="product-img-wrap">
            ${imgHtml}
            ${badge}
          </div>
        </a>
        <div class="product-info">
          <div class="product-category">${category}</div>
          <a href="${productUrl}">
            <h3 class="product-name">${name}</h3>
          </a>
          <div class="product-pricing">
            <span class="product-price">${priceHtml}</span>
            ${hasOriginalPrice ? `<span class="product-original-price">${Cart.formatPrice(originalPrice)}</span>` : ''}
          </div>
          <div class="product-card-actions">
            <button type="button" class="btn btn-primary btn-sm" style="flex:1" data-add-id="${escapeHtml(product.id)}" ${canBuy ? '' : 'disabled'}>
              ${canBuy ? 'Add to Cart' : 'Unavailable'}
            </button>
            <a href="${productUrl}" class="btn btn-outline-gold btn-sm">View</a>
          </div>
        </div>
      </div>
    `;
  }

  // ---- LOAD FEATURED PRODUCTS (homepage) ----
  async function loadFeatured(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = loadingHtml('Loading products...');
    const products = await fetchProducts({ featured: 'true', limit: 4 });

    if (!products.length) {
      container.innerHTML = lastFetchFailed
        ? loadErrorHtml()
        : noProductsHtml('Products coming soon. Check back later!');
      return;
    }

    container.innerHTML = products.map(renderProductCard).join('');
  }

  // ---- LOAD SHOP PAGE PRODUCTS ----
  async function loadShop(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = loadingHtml('Loading products...');
    allProducts = await fetchProducts();

    if (lastFetchFailed) {
      container.innerHTML = loadErrorHtml();
      return;
    }

    renderFilteredProducts(container);
  }

  // ---- LOAD RELATED PRODUCTS ----
  async function loadRelated(containerId, excludeId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = loadingHtml('Loading products...');
    const products = await fetchProducts({ limit: 8 });
    const related = products.filter((product) => product.id !== excludeId).slice(0, 4);

    if (!related.length) {
      container.innerHTML = lastFetchFailed
        ? loadErrorHtml()
        : noProductsHtml('More products coming soon.');
      return;
    }

    container.innerHTML = related.map(renderProductCard).join('');
  }

  function renderFilteredProducts(container) {
    let products = [...allProducts];

    // Category filter
    if (activeFilters.category !== 'all') {
      products = products.filter((product) =>
        String(product.metadata.category || '').toLowerCase() === activeFilters.category.toLowerCase()
      );
    }

    // Availability (the API already excludes inactive products)
    if (activeFilters.availability === 'available') {
      products = products.filter((product) => product.active !== false && product.priceId);
    }

    // Search
    const query = activeFilters.search ? activeFilters.search.toLowerCase() : '';
    if (query) {
      products = products.filter((product) =>
        product.name.toLowerCase().includes(query) ||
        product.description.toLowerCase().includes(query)
      );
    }

    // Price range (display values are entered in dollars)
    const minPrice = Number(activeFilters.minPrice);
    if (Number.isFinite(minPrice) && minPrice > 0) {
      products = products.filter((product) => product.price >= minPrice * 100);
    }
    const maxPrice = Number(activeFilters.maxPrice);
    if (Number.isFinite(maxPrice) && maxPrice > 0) {
      products = products.filter((product) => product.price <= maxPrice * 100);
    }

    // Sort
    switch (activeFilters.sort) {
      case 'price-asc': products.sort((a, b) => a.price - b.price); break;
      case 'price-desc': products.sort((a, b) => b.price - a.price); break;
      case 'name-asc': products.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'name-desc': products.sort((a, b) => b.name.localeCompare(a.name)); break;
      case 'newest': products.sort((a, b) => b.created - a.created); break;
      default:
        products.sort((a, b) =>
          productDisplayOrder(a) - productDisplayOrder(b) || a.name.localeCompare(b.name)
        );
    }

    const countEl = document.getElementById('products-count');
    if (countEl) countEl.textContent = `${products.length} product${products.length !== 1 ? 's' : ''}`;

    if (!products.length) {
      container.innerHTML = noProductsHtml(
        allProducts.length
          ? 'No products found. Try adjusting your filters.'
          : 'No products are available yet. Please check back soon.'
      );
      return;
    }

    container.innerHTML = products.map(renderProductCard).join('');
  }

  // ---- LOAD SINGLE PRODUCT ----
  async function loadProduct(productId) {
    const res = await fetch(`/api/get-product?id=${encodeURIComponent(productId)}`, {
      headers: { Accept: 'application/json' },
    });

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Product request failed (${res.status})`);

    const data = await res.json();
    const product = normalizeProduct(data);
    if (!product) throw new Error('Invalid product response');

    productCache.set(product.id, product);
    return product;
  }

  // ---- RENDER PRODUCT DETAIL PAGE ----
  async function renderProductPage() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) {
      window.location.href = 'shop.html';
      return;
    }

    const wrap = document.getElementById('product-detail-wrap');
    if (!wrap) return;

    if (!/^prod_[A-Za-z0-9]+$/.test(id)) {
      wrap.innerHTML = noProductsHtml('Product not found. <a href="shop.html" style="color:var(--emerald)">Browse all products →</a>');
      return;
    }

    currentQty = 1;
    wrap.innerHTML = loadingHtml('Loading product...');

    let product;
    try {
      product = await loadProduct(id);
    } catch (err) {
      console.error('Product load error:', err);
      wrap.innerHTML = noProductsHtml('We could not load this product right now. Please refresh or try again shortly.');
      return;
    }

    if (!product) {
      wrap.innerHTML = noProductsHtml('Product not found. <a href="shop.html" style="color:var(--emerald)">Browse all products →</a>');
      return;
    }

    productCache.set(product.id, product);

    const variants = product.variants.slice();
    let selectedVariant = variants.find((variant) => variant.priceId === product.priceId) || variants[0] || null;
    const images = product.images;
    const primaryImage = images[0] || '';
    const categoryText = typeof product.metadata.category === 'string' ? product.metadata.category : '';
    const category = escapeHtml(categoryText);
    const name = escapeHtml(product.name);
    const description = product.description ||
      product.metadata.short_description ||
      'Quality beauty and care product from Yehonam Suds.';

    const originalPrice = parseInt(product.metadata.original_price, 10);
    const showOriginalPrice = Number.isFinite(originalPrice) && originalPrice > product.price && variants.length <= 1;
    const showVariantPicker = variants.length > 1;

    const benefits = typeof product.metadata.benefits === 'string' ? product.metadata.benefits : '';
    const ingredients = typeof product.metadata.ingredients === 'string' ? product.metadata.ingredients : '';
    const directions = typeof product.metadata.directions === 'string' ? product.metadata.directions : '';
    const hasInfoTab = Boolean(benefits || ingredients || directions);

    document.title = `${product.name} — Yehonam Suds`;

    const canonical = document.getElementById('canonical-link');
    if (canonical) {
      canonical.href = `https://yehonam.com/product.html?id=${encodeURIComponent(product.id)}`;
    }

    const galleryHtml = `
      <div class="gallery-main" id="gallery-main">
        ${primaryImage
          ? `<img src="${escapeHtml(primaryImage)}" alt="${name}" id="main-img">`
          : `<div class="hero-placeholder"><svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><circle cx="9" cy="13" r="2"/><path d="M21 15l-5-5L5 20"/></svg><p>${name}</p></div>`
        }
      </div>
      ${images.length > 1 ? `
        <div class="gallery-thumbs">
          ${images.map((image, index) => `
            <button type="button" class="gallery-thumb ${index === 0 ? 'active' : ''}" data-gallery-index="${index}" aria-label="View image ${index + 1}">
              <img src="${escapeHtml(image)}" alt="${name} view ${index + 1}">
            </button>
          `).join('')}
        </div>
      ` : ''}
    `;

    const variantHtml = showVariantPicker ? `
      <div class="product-options">
        <span class="option-label">Size</span>
        <div class="option-buttons" id="size-options">
          ${variants.map((variant) => {
            const label = variant.label || Cart.formatPrice(variant.amount);
            const selected = Boolean(selectedVariant && variant.priceId === selectedVariant.priceId);
            return `<button type="button" class="option-btn ${selected ? 'selected' : ''}" data-variant-price-id="${escapeHtml(variant.priceId)}" aria-pressed="${selected ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
          }).join('')}
        </div>
      </div>
    ` : '';

    const currentPrice = selectedVariant ? selectedVariant.amount : 0;
    const priceHtml = selectedVariant
      ? `${product.priceIsFrom && !showVariantPicker ? '<span class="price-from">From </span>' : ''}${Cart.formatPrice(currentPrice)}${showOriginalPrice ? `<span class="original">${Cart.formatPrice(originalPrice)}</span>` : ''}`
      : 'Unavailable';

    wrap.innerHTML = `
      <div class="product-gallery">
        ${galleryHtml}
      </div>

      <div class="product-detail-info">
        <div class="breadcrumb">
          <a href="index.html">Home</a> /
          <a href="shop.html">Shop</a> /
          ${categoryText ? `<a href="shop.html?category=${encodeURIComponent(categoryText.toLowerCase())}">${category}</a> / ` : ''}
          <span>${name}</span>
        </div>

        <h1 class="product-detail-title">${name}</h1>

        <div class="product-detail-price" id="product-price-display">${priceHtml}</div>

        <p class="product-desc">${formatMultiline(description)}</p>

        ${variantHtml}

        ${selectedVariant ? `
          <div class="qty-selector" id="qty-selector">
            <button type="button" class="qty-btn" data-qty-delta="-1" aria-label="Decrease quantity">−</button>
            <span class="qty-num" id="qty-display">1</span>
            <button type="button" class="qty-btn" data-qty-delta="1" aria-label="Increase quantity">+</button>
          </div>
        ` : `
          <p class="product-unavailable">This product is currently unavailable. Please check back soon or contact us for help.</p>
        `}

        <div class="product-cta">
          <button type="button" class="btn btn-primary" style="flex:1" id="add-to-cart-btn" ${selectedVariant ? '' : 'disabled'}>
            Add to Cart
          </button>
          <button type="button" class="btn btn-dark" style="flex:1" id="buy-now-btn" ${selectedVariant ? '' : 'disabled'}>
            Buy Now
          </button>
        </div>

        <div class="product-tabs">
          <div class="tab-buttons">
            ${benefits ? `<button type="button" class="tab-btn active" data-tab-target="benefits">Benefits</button>` : ''}
            ${ingredients ? `<button type="button" class="tab-btn ${!benefits ? 'active' : ''}" data-tab-target="ingredients">Ingredients</button>` : ''}
            ${directions ? `<button type="button" class="tab-btn ${!benefits && !ingredients ? 'active' : ''}" data-tab-target="directions">How to Use</button>` : ''}
            <button type="button" class="tab-btn ${!hasInfoTab ? 'active' : ''}" data-tab-target="shipping-info">Shipping</button>
          </div>

          ${benefits ? `<div class="tab-panel active" id="tab-benefits"><p>${formatMultiline(benefits)}</p></div>` : ''}
          ${ingredients ? `<div class="tab-panel ${!benefits ? 'active' : ''}" id="tab-ingredients"><p>${formatMultiline(ingredients)}</p></div>` : ''}
          ${directions ? `<div class="tab-panel ${!benefits && !ingredients ? 'active' : ''}" id="tab-directions"><p>${formatMultiline(directions)}</p></div>` : ''}
          <div class="tab-panel ${!hasInfoTab ? 'active' : ''}" id="tab-shipping-info">
            <p>Orders within the US typically take 3–5 business days. International shipping is available. Delivery charges, where applicable, are communicated separately by the business. See our <a href="shipping.html" style="color:var(--gold)">Shipping &amp; Returns</a> page for full details.</p>
          </div>
        </div>
      </div>
    `;

    const priceEl = document.getElementById('product-price-display');
    const qtyDisplay = document.getElementById('qty-display');
    const mainImage = document.getElementById('main-img');
    const addButton = document.getElementById('add-to-cart-btn');
    const buyButton = document.getElementById('buy-now-btn');

    wrap.querySelectorAll('[data-variant-price-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = variants.find((variant) => variant.priceId === button.dataset.variantPriceId);
        if (!next) return;

        selectedVariant = next;
        wrap.querySelectorAll('[data-variant-price-id]').forEach((item) => {
          const active = item === button;
          item.classList.toggle('selected', active);
          item.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        if (priceEl) priceEl.textContent = Cart.formatPrice(next.amount);
      });
    });

    wrap.querySelectorAll('[data-qty-delta]').forEach((button) => {
      button.addEventListener('click', () => {
        const delta = Number(button.dataset.qtyDelta);
        currentQty = Math.min(MAX_QTY, Math.max(1, currentQty + (Number.isFinite(delta) ? delta : 0)));
        if (qtyDisplay) qtyDisplay.textContent = String(currentQty);
      });
    });

    function addSelectedToCart(goToCart) {
      if (!selectedVariant) {
        Cart.showToast('This product is currently unavailable.', 'error');
        return;
      }

      const added = Cart.addItem({
        id: product.id,
        name: product.name,
        price: selectedVariant.amount,
        priceId: selectedVariant.priceId,
        image: primaryImage,
        category: categoryText,
        variant: selectedVariant.label,
        qty: currentQty,
      });

      if (added && goToCart) {
        window.location.href = 'cart.html';
      }
    }

    if (addButton) addButton.addEventListener('click', () => addSelectedToCart(false));
    if (buyButton) buyButton.addEventListener('click', () => addSelectedToCart(true));

    wrap.querySelectorAll('[data-gallery-index]').forEach((thumb) => {
      thumb.addEventListener('click', () => {
        const index = Number(thumb.dataset.galleryIndex);
        const image = images[index];
        if (!image || !mainImage) return;

        mainImage.src = image;
        wrap.querySelectorAll('[data-gallery-index]').forEach((item) => {
          item.classList.toggle('active', item === thumb);
        });
      });
    });

    wrap.querySelectorAll('[data-tab-target]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.tabTarget;

        wrap.querySelectorAll('[data-tab-target]').forEach((item) => {
          item.classList.toggle('active', item === button);
        });
        wrap.querySelectorAll('.tab-panel').forEach((panel) => {
          panel.classList.toggle('active', panel.id === `tab-${target}`);
        });
      });
    });

    void loadRelated('related-products', product.id);
  }

  // ---- FILTER INIT ----
  function initFilters() {
    const container = document.getElementById('shop-products');
    if (!container) return;

    document.querySelectorAll('[data-filter-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-filter-cat]').forEach((item) => item.classList.remove('active'));
        btn.classList.add('active');
        activeFilters.category = btn.dataset.filterCat;
        renderFilteredProducts(container);
      });
    });

    const sortEl = document.getElementById('sort-select');
    if (sortEl) {
      sortEl.addEventListener('change', () => {
        activeFilters.sort = sortEl.value;
        renderFilteredProducts(container);
      });
    }

    const searchInput = document.getElementById('product-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        activeFilters.search = searchInput.value;
        renderFilteredProducts(container);
      });
    }

    const urlCategory = new URLSearchParams(location.search).get('category');
    if (urlCategory) {
      activeFilters.category = urlCategory;
      const buttons = Array.from(document.querySelectorAll('[data-filter-cat]'));
      const matching = buttons.find((btn) => btn.dataset.filterCat === urlCategory);
      if (matching) {
        buttons.forEach((btn) => btn.classList.remove('active'));
        matching.classList.add('active');
      }
    }
  }

  function setFilters(next) {
    activeFilters = { ...activeFilters, ...(next || {}) };
    const container = document.getElementById('shop-products');
    if (container) renderFilteredProducts(container);
  }

  return {
    loadFeatured,
    loadShop,
    loadRelated,
    renderProductPage,
    initFilters,
    renderFilteredProducts,
    setFilters,
    getProduct: (id) => productCache.get(id),
  };
})();

// ---- GLOBAL CHECKOUT HELPER (called from cart.html) ----
let checkoutInProgress = false;

async function proceedToCheckout() {
  if (checkoutInProgress) return;

  const button = document.getElementById('checkout-btn');
  const cartItems = Cart.getCart();

  if (!cartItems.length) return;

  if (Cart.getInvalidItemCount() > 0) {
    Cart.showToast('Some items in your cart are unavailable. Please remove them before checking out.', 'error');
    return;
  }

  const items = Cart.getCheckoutItems();
  if (!items.length) {
    Cart.showToast('Your cart has no purchasable items.', 'error');
    return;
  }

  checkoutInProgress = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Starting checkout...';
  }

  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Checkout failed');
    }

    window.location.href = data.url;
  } catch (err) {
    console.error('Checkout error:', err);
    Cart.showToast('Checkout could not be started. Please try again.', 'error');
    checkoutInProgress = false;
    if (button) {
      button.disabled = false;
      button.textContent = 'Proceed to Checkout →';
    }
  }
}

// ---- DELEGATED CARD ACTIONS ----
document.addEventListener('click', (event) => {
  const target = event.target && event.target.closest ? event.target : null;
  if (!target) return;

  const addButton = target.closest('[data-add-id]');
  if (addButton) {
    const product = Shop.getProduct(addButton.dataset.addId);
    if (!product || !product.priceId) {
      Cart.showToast('This product is currently unavailable.', 'error');
      return;
    }

    const variant = product.variants.find((item) => item.priceId === product.priceId) || null;
    Cart.addItem({
      id: product.id,
      name: product.name,
      price: variant ? variant.amount : product.price,
      priceId: product.priceId,
      image: product.images[0] || '',
      category: product.metadata.category || '',
      variant: variant ? variant.label : '',
      qty: 1,
    });
    return;
  }

  if (target.closest('[data-retry-products]')) {
    window.location.reload();
  }
});

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

// Restore the checkout button when returning via the browser back/forward cache.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;

  checkoutInProgress = false;
  const button = document.getElementById('checkout-btn');
  if (button) {
    button.disabled = false;
    button.textContent = 'Proceed to Checkout →';
  }
});
