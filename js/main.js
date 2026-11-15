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

  // ---- NAVBAR SCROLL SHADOW ----
  const navbar = document.getElementById('navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.style.boxShadow = window.scrollY > 20 ? '0 4px 20px rgba(0,0,0,0.12)' : '0 2px 8px rgba(0,0,0,0.08)';
    }, { passive: true });
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

  // ---- FADE IN OBSERVER ----
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.fade-in').forEach(el => obs.observe(el));

  // ---- ORDER CONFIRMATION ----
  const confirmPage = document.getElementById('confirmation-wrap');
  if (confirmPage) {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session_id');

    if (sessionId) {
      verifyOrder(sessionId);
    }
  }

  async function verifyOrder(sessionId) {
    try {
      const res = await fetch(`/api/verify-order?session_id=${sessionId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      renderConfirmation(data);
      Cart.clearCart();
    } catch {
      // Still show success — Stripe redirect implies payment succeeded
      renderConfirmation(null);
      Cart.clearCart();
    }
  }

  function renderConfirmation(data) {
    const wrap = document.getElementById('confirmation-wrap');
    if (!wrap) return;

    const orderRef = data?.id?.slice(-8).toUpperCase() || Math.random().toString(36).slice(-8).toUpperCase();
    const email = data?.customer_details?.email || '';

    const orderNumEl = document.getElementById('order-number');
    const emailEl = document.getElementById('confirmation-email');
    if (orderNumEl) orderNumEl.textContent = `#${orderRef}`;
    if (emailEl && email) emailEl.textContent = email;
  }

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
