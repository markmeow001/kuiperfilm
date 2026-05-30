/* KuiperAI Design Preview · i18n Runtime
 *
 * Usage:
 *   <html>
 *     <head>
 *       <link rel="stylesheet" href="tokens.css">
 *       <script src="i18n-dict.js"></script>
 *       <script src="i18n.js" defer></script>
 *     </head>
 *     <body>
 *       <span data-i18n="ws.step.script"></span>
 *       <input data-i18n-placeholder="search.placeholder">
 *       <!-- Or use [data-i18n-html] if value contains HTML -->
 *     </body>
 *   </html>
 *
 * Toggle:
 *   <div class="lang-switcher">
 *     <button data-lang="zh" class="active">中</button>
 *     <button data-lang="en">EN</button>
 *   </div>
 *
 * Default: zh (Simplified Chinese)
 */
(function() {
  const LANG_KEY = 'kp-lang';
  const DEFAULT_LANG = 'zh';

  function getLang() {
    return localStorage.getItem(LANG_KEY) || DEFAULT_LANG;
  }

  function setLang(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    localStorage.setItem(LANG_KEY, lang);
    apply();
  }

  function apply() {
    const dict = window.kpDict || {};
    const lang = getLang();

    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
    document.documentElement.setAttribute('data-lang', lang);

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (dict[key] && dict[key][lang] !== undefined) {
        el.textContent = dict[key][lang];
      } else if (!dict[key]) {
        // missing key — leave existing content as-is (so繁體可以漸進改造)
        // To debug: console.warn('[i18n] missing key:', key);
      }
    });

    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.dataset.i18nHtml;
      if (dict[key] && dict[key][lang] !== undefined) {
        el.innerHTML = dict[key][lang];
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      if (dict[key] && dict[key][lang] !== undefined) {
        el.placeholder = dict[key][lang];
      }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      if (dict[key] && dict[key][lang] !== undefined) {
        el.title = dict[key][lang];
      }
    });

    // Sync lang-switcher button active state
    document.querySelectorAll('.lang-switcher button[data-lang]').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
  }

  function bindSwitcher() {
    document.addEventListener('click', e => {
      const target = e.target.closest('.lang-switcher button[data-lang]');
      if (target) {
        e.preventDefault();
        setLang(target.dataset.lang);
      }
    });
  }

  // Expose for console testing
  window.kpI18n = { getLang, setLang, apply };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { apply(); bindSwitcher(); });
  } else {
    apply();
    bindSwitcher();
  }
})();
