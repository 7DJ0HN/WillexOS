// Willex OS website interactions
document.addEventListener('DOMContentLoaded', () => {
  // --- Year in footer ---
  const yearSpan = document.getElementById('year');
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

  // --- Scroll reveal animations ---
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.16 });

  document.querySelectorAll('.reveal, .card').forEach(el => observer.observe(el));

  // --- Mobile menu toggle (logo + text on phones) ---
  const mobileMenu = document.getElementById('mobileMenu');
  const brand = document.querySelector('.brand');
  const hamburger = document.querySelector('.hamburger');

  function toggleMenu() {
    if (!mobileMenu) return;
    mobileMenu.classList.toggle('open');
  }

  // hamburger button
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', toggleMenu);
  }

  // brand tap acts as menu toggle on mobile ONLY
  if (brand && mobileMenu) {
    brand.addEventListener('click', (e) => {
      if (window.innerWidth <= 880) {
        e.preventDefault();
        toggleMenu();
      }
    });
  }

  // Close menu when a link is clicked
  if (mobileMenu) {
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
      });
    });
  }

  // --- Highlight current page in desktop nav ---
  const page = document.body.dataset.page;
  if (page) {
    document.querySelectorAll('.desktop-nav a[data-page]').forEach(link => {
      if (link.dataset.page === page) {
        link.classList.add('active');
      }
    });
  }

  // --- Smooth scrolling for #anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const target = document.querySelector(targetId);

      if (target) {
        e.preventDefault();
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // --- Floating support button toggle ---
  const supportFab = document.querySelector('.support-fab');
  const supportPanel = document.querySelector('.support-panel');

  if (supportFab && supportPanel) {
    supportFab.addEventListener('click', () => {
      supportPanel.classList.toggle('open');
    });
  }
});
