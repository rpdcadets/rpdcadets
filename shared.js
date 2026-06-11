// ═══════ RPD CADETS — SHARED NAV & FOOTER ═══════
// Edit this ONE file to update nav links, footer, and site info across all pages.

const SITE = {
  name: 'Richardson Police',
  unit: 'Public Safety Cadets — Unit #761',
  logo: 'logo.png',
  email: 'advisors@rpdcadets.com',
  instagram: 'https://www.instagram.com/richardsonpdexplorers',
  copyright: '© 2026 Richardson Police Department Public Safety Cadets Unit #761',
  affiliation: 'Affiliated with the Public Safety Cadets national organization'
};

const NAV_LINKS = [
  { label: 'Home', href: 'index.html' },
  { label: 'Members', href: 'members.html' },
  { label: 'Training', href: 'training.html' },
  { label: 'Trackers', href: 'trackers.html' },
  { label: 'FAQ', href: 'faq.html' },
  { label: 'Donate', href: 'donate.html' },
  { label: 'Contact', href: 'contact.html' }
];

// ─── Determine active page ───
function getActivePage() {
  const path = window.location.pathname;
  const file = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
  return file;
}

// ─── Build Nav HTML ───
function buildNav() {
  const active = getActivePage();
  const linksHTML = NAV_LINKS.map(l =>
    `<li><a href="${l.href}"${l.href === active ? ' class="active"' : ''}>${l.label}</a></li>`
  ).join('');
  const mobileLinksHTML = NAV_LINKS.map(l =>
    `<a href="${l.href}">${l.label}</a>`
  ).join('');

  const navEl = document.getElementById('site-nav');
  if (navEl) {
    navEl.innerHTML = `
      <nav id="navbar">
        <div class="nav-inner">
          <a href="index.html" class="nav-brand">
            <img src="${SITE.logo}" alt="RPD Cadets Logo">
            <div class="nav-brand-text">
              <span class="nav-brand-dept">${SITE.name}</span>
              <span class="nav-brand-unit">${SITE.unit}</span>
            </div>
          </a>
          <ul class="nav-links">${linksHTML}</ul>
          <button class="hamburger" id="hamburger" aria-label="Toggle menu"><span></span><span></span><span></span></button>
        </div>
      </nav>
      <div class="mobile-menu" id="mobileMenu">${mobileLinksHTML}</div>
    `;

    // Scroll effect
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    // Mobile menu toggle
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');
    hamburger.addEventListener('click', () => mobileMenu.classList.toggle('open'));
    document.querySelectorAll('.mobile-menu a').forEach(link => {
      link.addEventListener('click', () => mobileMenu.classList.remove('open'));
    });
  }
}

// ─── Build Footer HTML ───
function buildFooter() {
  const footerEl = document.getElementById('site-footer');
  if (footerEl) {
    const style = footerEl.dataset.style || 'full'; // 'full' or 'simple'

    if (style === 'full') {
      footerEl.innerHTML = `
        <footer>
          <div class="container">
            <div class="footer-inner">
              <div class="footer-brand">
                <img src="${SITE.logo}" alt="RPD Cadets">
                <div class="footer-brand-text">
                  <span class="footer-brand-name">RPD Public Safety Cadets</span>
                  <span class="footer-brand-sub">${SITE.name} Department — Unit #761</span>
                </div>
              </div>
              <div class="footer-links">
                ${NAV_LINKS.map(l => `<a href="${l.href}">${l.label}</a>`).join('')}
              </div>
              <div class="footer-social">
                <a href="${SITE.instagram}" target="_blank" aria-label="Instagram">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                </a>
                <a href="mailto:${SITE.email}" aria-label="Email">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </a>
              </div>
            </div>
            <div class="footer-bottom">
              <span class="footer-copy">${SITE.copyright}</span>
              <span class="footer-aff">${SITE.affiliation}</span>
            </div>
          </div>
        </footer>
      `;
    } else {
      footerEl.innerHTML = `
        <footer>
          <div class="container">
            <div class="footer-bottom">
              <span class="footer-copy">${SITE.copyright}</span>
              <div class="footer-back"><a href="index.html">&larr; Back to Home</a></div>
            </div>
          </div>
        </footer>
      `;
    }
  }
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  buildNav();
  buildFooter();
});
