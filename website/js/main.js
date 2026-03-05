/* Ouijit Website — Shared layout injection */

(function () {
  // Determine path prefix based on page depth
  const depth = window.location.pathname.split('/').filter(Boolean).length;
  const inDocs = window.location.pathname.includes('/docs/');
  // In docs/ pages, assets are one level up; in root pages, same level
  const prefix = inDocs ? '../' : './';

  // --- Nav ---
  const navEl = document.getElementById('site-nav');
  if (navEl) {
    const docsHref = prefix + 'docs/';
    const pricingHref = prefix + 'pricing.html';
    const isHome = window.location.pathname.endsWith('/') || window.location.pathname.endsWith('/index.html');
    const featuresHref = isHome ? '#features' : prefix + 'index.html#features';
    navEl.innerHTML = `
      <nav class="site-nav">
        <div class="nav-inner">
          <a class="nav-logo" href="${prefix}index.html"><img src="${prefix}assets/ouijit-logo.svg" alt="ouijit" height="28"></a>
          <ul class="nav-links">
            <li><a href="${featuresHref}">Features</a></li>
            <li><a href="${pricingHref}">Pricing</a></li>
            <li><a href="${docsHref}">Docs</a></li>
            <li><a href="https://github.com/ouijit/ouijit" target="_blank" rel="noopener">GitHub</a></li>
          </ul>
          <button class="nav-hamburger" aria-label="Menu">&#9776;</button>
        </div>
        <div class="nav-mobile" id="nav-mobile">
          <a href="${featuresHref}">Features</a>
          <a href="${pricingHref}">Pricing</a>
          <a href="${docsHref}">Docs</a>
          <a href="https://github.com/ouijit/ouijit" target="_blank" rel="noopener">GitHub</a>
        </div>
      </nav>
    `;

    const hamburger = navEl.querySelector('.nav-hamburger');
    const mobileMenu = navEl.querySelector('#nav-mobile');
    const overlay = document.createElement('div');
    overlay.className = 'nav-overlay';
    document.body.appendChild(overlay);

    function toggleMenu() {
      const open = mobileMenu.classList.toggle('open');
      overlay.style.display = open ? 'block' : 'none';
      document.body.style.overflow = open ? 'hidden' : '';
    }

    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', toggleMenu);
      overlay.addEventListener('click', toggleMenu);
    }
  }

  // --- Footer ---
  const footerEl = document.getElementById('site-footer');
  if (footerEl) {
    footerEl.innerHTML = `
      <footer class="site-footer">
        <div class="footer-inner">
          <span>&copy; ${new Date().getFullYear()} Ouijit. Licensed under AGPL-3.0.</span>
          <ul class="footer-links">
            <li><a href="https://github.com/ouijit/ouijit" target="_blank" rel="noopener">GitHub</a></li>
            <li><a href="https://github.com/ouijit/ouijit/releases" target="_blank" rel="noopener">Releases</a></li>
            <li><a href="${prefix}docs/">Docs</a></li>
          </ul>
        </div>
      </footer>
    `;
  }

  // --- Docs Sidebar ---
  const sidebarEl = document.getElementById('docs-sidebar');
  if (sidebarEl) {
    const pages = [
      { href: 'index.html', label: 'Overview' },
      { href: 'getting-started.html', label: 'Getting Started' },
      { href: 'worktrees.html', label: 'Worktree Isolation' },
      { href: 'kanban.html', label: 'Kanban Board' },
      { href: 'terminals.html', label: 'Terminal Sessions' },
      { href: 'vm-sandbox.html', label: 'VM Sandbox' },
      { href: 'hooks.html', label: 'Hooks' },
      { href: 'claude-code.html', label: 'Claude Code' },
    ];

    const pathEnd = window.location.pathname.split('/').pop() || '';
    const current = pathEnd.replace(/\.html$/, '') || 'index';
    const links = pages
      .map((p) => {
        const slug = p.href.replace(/\.html$/, '');
        const active = current === slug || (current === 'docs' && slug === 'index') ? ' class="active"' : '';
        return `<li><a href="${p.href}"${active}>${p.label}</a></li>`;
      })
      .join('\n');

    sidebarEl.innerHTML = `
      <h4>Documentation</h4>
      <ul>${links}</ul>
    `;
  }
})();
