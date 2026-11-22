/**
 * YEHONAM SUDS — MAIN JAVASCRIPT
 * Navigation, animations, FAQ, general UI
 */

document.addEventListener('DOMContentLoaded', () => {

  // ---- MOBILE MENU ----
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');
  const mobileClose = document.getElementById('mobile-menu-close');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      mobileMenu.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  }

  if (mobileClose && mobileMenu) {
    mobileClose.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    });
  }

  // ---- ACTIVE NAV LINK ----
  const path = location.pathname.replace(/\/$/, '') || 'index.html';
  document.querySelectorAll('.navbar-links a, .mobile-menu a').forEach(link => {
    const href = link.getAttribute('href');
    if (href && (path.endsWith(href) || (path === '' && href === '/') || (path === '/' && href === 'index.html'))) {
      link.classList.add('active');
    }
  });

  // ---- NAVBAR SCROLL STATE ----
  const navbar = document.getElementById('navbar');
  if (navbar) {
    const setNavState = () => navbar.classList.toggle('scrolled', window.scrollY > 24);
    setNavState();
    window.addEventListener('scroll', setNavState, { passive: true });
  }

  // ---- FAQ ACCORDION ----
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');

      // Close all
      document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));

      // Toggle current
      if (!isOpen) item.classList.add('open');
    });
  });

  // ---- SCROLL REVEAL & MOTION ----
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealClasses = ['fade-in', 'fade-in-left', 'fade-in-right', 'fade-in-scale'];
  const autoRevealSelector = '.review-card, .faq-item, .mv-card, .cart-summary, .cart-item, .product-gallery, .product-detail-info, .sidebar-widget, .empty-cart';
  const headerSelector = '.section-label, .section-title, .section-subtitle';

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      el.classList.add('visible');
      revealObserver.unobserve(el);

      // Clear the animation classes once done so hover transforms work normally
      const delay = parseInt(getComputedStyle(el).getPropertyValue('--reveal-delay'), 10) || 0;
      setTimeout(() => {
        revealClasses.forEach(cls => el.classList.remove(cls));
        el.classList.remove('visible');
        el.style.removeProperty('--reveal-delay');
        el.style.willChange = 'auto';
      }, 900 + delay);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

  function prepReveal(el) {
    if (!el || el.dataset.revealReady) return;
    el.dataset.revealReady = '1';

    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children)
        .filter(child => revealClasses.some(cls => child.classList.contains(cls)));
      const index = Math.min(siblings.indexOf(el), 7);
      if (index > 0) el.style.setProperty('--reveal-delay', (index * 70) + 'ms');
    }

    revealObserver.observe(el);
  }

  function tagReveals(root) {
    // Section headings cascade: label -> title -> subtitle
    root.querySelectorAll(headerSelector).forEach(el => {
      if (el.closest('.hero, .page-hero, .shop-hero, .about-hero')) return;
      if (el.closest(revealClasses.map(cls => '.' + cls).join(','))) return;
      if (!el.dataset.revealReady) el.classList.add('fade-in');
    });

    // Cards, lists and dynamic containers
    root.querySelectorAll(autoRevealSelector).forEach(el => {
      if (el.closest(revealClasses.map(cls => '.' + cls).join(','))) return;
      if (!el.dataset.revealReady) el.classList.add('fade-in');
    });

    root.querySelectorAll('.fade-in:not([data-reveal-ready])').forEach(prepReveal);
    if (root.matches && root.matches('.fade-in')) prepReveal(root);
  }

  if (reduceMotion) {
    tagReveals(document);
    document.querySelectorAll(revealClasses.map(cls => '.' + cls).join(','))
      .forEach(el => revealClasses.forEach(cls => el.classList.remove(cls)));
  } else {
    tagReveals(document);

    // Track grids that have already animated once, so filtering or changing
    // quantities doesn't replay the entrance animation on every update.
    const dynamicContainerSelector = '.products-grid, .shop-products-grid, #cart-items-wrap';
    const seenContainers = new WeakSet();
    document.querySelectorAll('#cart-items-wrap').forEach(el => seenContainers.add(el));

    // Handle content injected later (products, cart items, product details)
    const revealMutation = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;

          const container = node.closest(dynamicContainerSelector);
          if (container && seenContainers.has(container)) {
            // Already-animated grid: show new items immediately
            if (node.matches('.fade-in')) node.classList.remove('fade-in');
            node.querySelectorAll('.fade-in').forEach(el => el.classList.remove('fade-in'));
            return;
          }

          if (node.matches(autoRevealSelector) && !node.dataset.revealReady) {
            node.classList.add('fade-in');
          }
          tagReveals(node);
        });
      });

      setTimeout(() => {
        document.querySelectorAll(dynamicContainerSelector).forEach(el => seenContainers.add(el));
      }, 0);
    });
    revealMutation.observe(document.body, { childList: true, subtree: true });
  }

  // ---- SCROLL PROGRESS BAR ----
  if (!reduceMotion) {
    const progress = document.createElement('div');
    progress.className = 'scroll-progress';
    progress.setAttribute('aria-hidden', 'true');
    document.body.appendChild(progress);

    let ticking = false;
    const updateProgress = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = `scaleX(${max > 0 ? Math.min(window.scrollY / max, 1) : 0})`;
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(updateProgress);
        ticking = true;
      }
    }, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
    updateProgress();
  }

  // ---- CART BADGE POP ----
  document.addEventListener('cartUpdated', () => {
    document.querySelectorAll('.cart-count').forEach(el => {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    });
  });

  // ---- SMOOTH SCROLL ----
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ---- COOKIE NOTICE ----
  if (!localStorage.getItem('cookie-accepted')) {
    const banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.style.cssText = `position:fixed;bottom:0;left:0;right:0;background:rgba(16,28,21,0.97);border-top:1px solid var(--line);color:rgba(236,233,222,0.8);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;z-index:9999;flex-wrap:wrap;font-size:0.85rem;backdrop-filter:blur(10px);`;
    banner.innerHTML = `
      <span>We use cookies to improve your experience. By using our site, you agree to our <a href="privacy.html" style="color:var(--light-gold);text-decoration:underline">Privacy Policy</a>.</span>
      <button onclick="document.getElementById('cookie-banner').remove();localStorage.setItem('cookie-accepted','1')" style="background:var(--gold);color:var(--black);border:none;padding:8px 20px;border-radius:4px;cursor:pointer;font-weight:600;font-size:0.82rem;white-space:nowrap;">Accept</button>
    `;
    document.body.appendChild(banner);
  }

});
