// Basic utilities wrapped in DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  // YEAR IN FOOTER
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  // MOBILE MENU TOGGLE
  const hamburger = document.querySelector('.hamburger');
  const mobileMenu = document.getElementById('mobileMenu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
    });

    // Close menu when clicking a link
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
      });
    });
  }

  // STICKY HEADER SHRINK ON SCROLL
  const header = document.querySelector('.nav-header');
  const onScroll = () => {
    if (!header) return;
    const scrolled = window.scrollY > 10;
    header.classList.toggle('scrolled', scrolled);
  };
  window.addEventListener('scroll', onScroll);
  onScroll(); // initial

  // ACTIVE NAV LINK BASED ON PAGE
  const page = document.body.dataset.page;
  if (page) {
    document
      .querySelectorAll('.desktop-nav a[data-page]')
      .forEach(link => {
        const lp = link.getAttribute('data-page');
        if (lp === page) {
          link.classList.add('is-active');
        }
      });
  }

  // SCROLL REVEAL
  const revealEls = document.querySelectorAll('.reveal, .card');
  if ('IntersectionObserver' in window && revealEls.length) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('show');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.18 });

    revealEls.forEach(el => observer.observe(el));
  } else {
    // Fallback: show all
    revealEls.forEach(el => el.classList.add('show'));
  }

  // FLOATING SUPPORT BUTTON
  const fab = document.querySelector('.support-fab');
  const panel = document.querySelector('.support-panel');

  if (fab && panel) {
    fab.addEventListener('click', () => {
      const open = !panel.classList.contains('open');
      panel.classList.toggle('open', open);
      panel.setAttribute('aria-hidden', String(!open));
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('open')) return;
      const target = e.target;
      if (!panel.contains(target) && !fab.contains(target)) {
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // CONTACT FORM (prevent actual submit for now)
  const contactForm = document.querySelector('.contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      alert('Thanks for your message. This demo form does not send yet — please email support@willex.example.');
    });
  }
});
