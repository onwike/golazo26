// v3: client-side AI-league hydration. The baked /ai-league page shows the league as of the
// last bake (SEO + first paint); this overlays the LIVE league from /api/v1/ai-league (D1,
// updated after every re-bet and every confirmed result) so the competition updates with NO
// rebuild. Renders with the SAME functions build.mjs bakes with (/ai-league-render.mjs) — one
// renderer, two runtimes. Fails safe: any error leaves the baked content untouched.
import { aiStandings, aiFeatured, aiEveryPick } from '/ai-league-render.mjs';

const standingsSlot = document.querySelector('[data-ai-standings]');
if (standingsSlot) {
  const API = self.__G26_API__ || 'https://golazo26-data.onwike.workers.dev';
  const fmtAsOf = (iso) => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) + ' ET';
    } catch (e) { return ''; }
  };
  const set = (sel, html) => { const el = document.querySelector(sel); if (el != null && html != null) el.innerHTML = html; };
  // i18n: current non-English site language (site/i18n.js sets data-lang pre-paint) →
  // ?lang= on the endpoint; the worker swaps pick notes/defense per row with English fallback.
  const i18nLang = () => { const l = document.documentElement.dataset.lang; return l && l !== 'en' ? l : null; };

  const hydrate = async () => {
    const lang = i18nLang();
    const data = await fetch(API + '/api/v1/ai-league' + (lang ? `?lang=${lang}` : ''), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!data || !Array.isArray(data.standings)) return; // API unreachable → keep baked content
    set('[data-ai-standings]', aiStandings(data));
    set('[data-ai-featured]', aiFeatured(data));
    set('[data-ai-everypick]', aiEveryPick(data));
    const asOf = document.querySelector('[data-ai-asof]');
    if (asOf && data.as_of) asOf.textContent = fmtAsOf(data.as_of);
  };

  // language switch (site/i18n.js fires g26:lang after every selection): re-fetch + re-render in
  // the new language — the render is a full innerHTML replacement, so the re-run is idempotent.
  document.addEventListener('g26:lang', () => { hydrate().catch(() => {}); });

  try {
    await hydrate();
    setInterval(() => { hydrate().catch(() => {}); }, 120e3); // league moves on each result/re-bet
  } catch (e) { /* keep the baked content */ }
}
