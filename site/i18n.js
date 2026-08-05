// Golazo 26 — client i18n overlay (v3.14 a later change, plan §3). Zero-dep vanilla JS. Chrome labels
// flip pre-paint via baked lang-scoped spans + html[data-lang] CSS — this file owns the PROSE
// tier: fetch the same-origin baked fragment /i18n/<lang>/p/<route>.json, swap innerHTML on
// matching [data-i18n-block] sections (per-block lang attrs), set <html lang> only AFTER the
// swap completes, then fire g26:lang so app.js re-runs its enhancement passes. The degrade
// path IS the design: missing fragment / 404 / slow network → English stays, silently.
// [data-i18n-skip] subtrees (score clusters, status pills — an earlier revision) are NEVER translated, and
// live skip nodes inside a swapped block survive the swap as the SAME DOM nodes, so the live
// score tick's targets are never destroyed (OM2 untouched).
(() => {
  const doc = document.documentElement;
  const KEY = 'g26-lang';
  const FAILSAFE_MS = 400; // failsafe reveal-to-English budget (constant; measured under throttling in a later change)
  // Per-language kill-switch (data/i18n/config.json langs) is the authority: build.mjs bakes the
  // ENABLED set into <html data-i18n-langs>. LANGS = en + that set. A stored/param language not in
  // it is rejected (falls to English) and its stored key is cleared, so disabling a language cleanly
  // reverts a returning g26-lang visitor instead of stranding a blank/mixed state.
  const LANGS = ['en', ...(doc.dataset.i18nLangs || '').split(',').filter(Boolean)];

  // ?lang= overrides AND persists — the ?contrast sticky pattern (app.js §6). A disabled ?lang= is
  // NOT persisted (LANGS gate), so a kill-switched language cannot be re-stuck via the URL.
  const qs = new URLSearchParams(location.search).get('lang');
  if (qs && LANGS.indexOf(qs) >= 0) localStorage.setItem(KEY, qs);

  const current = () => {
    const stored = localStorage.getItem(KEY);
    if (stored && LANGS.indexOf(stored) < 0) localStorage.removeItem(KEY); // disabled/unknown lang: clear the stale key
    const v = qs || localStorage.getItem(KEY) || doc.dataset.lang || 'en';
    return LANGS.indexOf(v) >= 0 ? v : 'en';
  };

  // route → fragment path: pathname mirrored under /i18n/<lang>/p/ ('/' → index; trailing slash + .html dropped).
  // Profile pages are stamped [data-i18n-pack] (plan §3 per-team packs): they fetch the shared
  // per-TEAM pack /i18n/<lang>/t/<team-slug>.json INSTEAD of a per-route fragment (same flat
  // { blockId: html } shape, same blocks.json merge, same silent English degrade).
  const packOf = () => {
    const el = document.querySelector('[data-i18n-pack]');
    const pk = el && el.getAttribute('data-i18n-pack');
    return pk && /^t\/[a-z0-9_-]+$/.test(pk) ? pk : null;
  };
  const fragURL = (lang) => {
    const pk = packOf();
    return pk ? '/i18n/' + lang + '/' + pk + '.json'
      : '/i18n/' + lang + '/p/' + (location.pathname.replace(/\.html$/, '').replace(/^\/+|\/+$/g, '') || 'index') + '.json';
  };

  // prose blocks eligible for swapping — anything inside a [data-i18n-skip] cluster stays English permanently (an earlier revision)
  const blocks = () => [...document.querySelectorAll('[data-i18n-block]')].filter((el) => !el.closest('[data-i18n-skip]'));
  const originals = new Map(); // block-id → baked English innerHTML (revert-to-en + per-block degrade)
  const fire = () => document.dispatchEvent(new CustomEvent('g26:lang')); // re-enhancement contract

  // swap one block, keeping any LIVE [data-i18n-skip] descendants (score clusters mid-tick) as the same nodes
  const swap = (el, html, lang) => {
    const keep = [...el.querySelectorAll('[data-i18n-skip]')];
    el.innerHTML = html;
    const slots = el.querySelectorAll('[data-i18n-skip]');
    if (slots.length === keep.length) for (let i = 0; i < keep.length; i++) slots[i].replaceWith(keep[i]);
    el.setAttribute('lang', lang);
  };

  let epoch = 0; // a newer selection invalidates any in-flight fetch
  let revealed = false; // failsafe fired: English is being read — a late fragment must NOT hot-swap (next nav, warm cache)

  const restoreEnglish = () => {
    for (const el of blocks()) {
      if (el.getAttribute('lang') && originals.has(el.dataset.i18nBlock)) {
        el.innerHTML = originals.get(el.dataset.i18nBlock);
        el.removeAttribute('lang');
      }
      el.style.opacity = '';
    }
    doc.lang = 'en';
    // ALWAYS fire (not just when a block reverted): dynamic API-hydrated prose (recap / Bar Talk /
    // Watch-Along / AI-league) is not an i18n block — switching back to English must still
    // tell those hydrators to re-fetch without ?lang=. The passes/hydrators are idempotent.
    fire();
  };

  const apply = (lang) => {
    const my = ++epoch;
    if (lang === 'en') { doc.removeAttribute('data-lang'); restoreEnglish(); return; }
    if (doc.dataset.lang !== lang) doc.dataset.lang = lang; // pre-paint normally set this already — never fight it, just align
    const pending = blocks().filter((el) => el.getAttribute('lang') !== lang);
    // chrome-only page (or already swapped): nothing to fetch — but still fire, so the dynamic
    // endpoint hydrators (a later change: recap / Bar Talk / Watch-Along / AI-league) re-fetch with ?lang=.
    if (!pending.length) { doc.lang = lang; fire(); return; }
    if (!revealed) for (const el of pending) el.style.opacity = '0'; // opacity gate while the fragment loads
    const failsafe = setTimeout(() => { revealed = true; for (const el of pending) el.style.opacity = ''; }, FAILSAFE_MS);
    // Two same-origin fetches: the per-route fragment (page-unique prose) + the shared S-valued
    // blocks file (site-wide footnotes/notes/subs — one browser-cached file per language). Either
    // may 404 (partial coverage is normal); the route fragment wins on id collision.
    const grab = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null); // 404 / offline / blocked: English degrade, silent by design (no console spam)
    Promise.all([grab(fragURL(lang)), grab('/i18n/' + lang + '/blocks.json')])
      .then(([route, shared]) => (route || shared ? Object.assign({}, shared || {}, route || {}) : null))
      .then((map) => {
        clearTimeout(failsafe);
        if (my !== epoch) return; // superseded by a newer selection
        if (map && !revealed) {
          for (const el of pending) {
            const id = el.dataset.i18nBlock;
            if (typeof map[id] === 'string') {
              if (!originals.has(id)) originals.set(id, el.innerHTML);
              swap(el, map[id], lang);
            } else if (el.getAttribute('lang') && originals.has(id)) {
              el.innerHTML = originals.get(id); // edited/missing unit: per-block degrade to baked English
              el.removeAttribute('lang');
            }
          }
          doc.lang = lang; // <html lang> only AFTER the swap completes
          for (const el of pending) el.style.opacity = '';
          fire();
        } else {
          for (const el of pending) el.style.opacity = ''; // English holds; the warm cache serves next navigation
        }
      });
  };

  const sel = document.getElementById('lang-sel'); // exists only when the feature is enabled (config.json langs non-empty)
  if (sel) {
    sel.value = current();
    sel.addEventListener('change', () => {
      const v = LANGS.indexOf(sel.value) >= 0 ? sel.value : 'en';
      localStorage.setItem(KEY, v);
      revealed = false; // an explicit user selection is not "mid-read": gate + failsafe run afresh
      apply(v);
    });
  }

  const lang = current();
  if (lang !== 'en') apply(lang);
  else if (doc.dataset.lang) apply('en'); // ?lang=en overrode a stored language: clean up pre-paint's attr
})();
