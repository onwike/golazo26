// v3: instant profile-takedown overlay. A profile can be taken down (privacy / right-to-be-
// forgotten) by setting a D1 `overrides` row (entity_type='profile', field='takedown', active=1).
// /api/v1/takedowns (golazo26-data) serves the live suppression list; this hides the content
// IMMEDIATELY, before the next bake purges the page from the HTML. Best-effort: this is the fast
// path for the window between the takedown and a (forced) bake — the bake is the authoritative
// removal (build drops the page entirely). Fails safe: any error leaves the page as baked.
//
// NOTE: because the prose is in the baked HTML until the next bake, a takedown should ALSO trigger
// a forced bake for true removal; this overlay covers the ~2-minute window in between.
const root = document.querySelector('.profile[data-profile-slug]');

if (root) {
  const slug = root.getAttribute('data-profile-slug');
  const API = self.__G26_API__ || 'https://golazo26-data.onwike.workers.dev';
  (async () => {
    try {
      const r = await fetch(API + '/api/v1/takedowns', { cache: 'no-cache' });
      if (!r.ok) return;
      const { slugs } = await r.json();
      if (!Array.isArray(slugs) || !slugs.includes(slug)) return;
      // suppress: replace the profile body, drop it from indexing, retitle.
      root.innerHTML = '<section class="prose"><h1 class="matchup">Profile removed</h1>'
        + '<p class="muted">This profile has been removed at the subject’s request.</p></section>';
      const m = document.createElement('meta');
      m.name = 'robots';
      m.content = 'noindex, noarchive';
      document.head.appendChild(m);
      // scrub the baked <head> too, so JS-running scrapers / social cards don't leak the name
      // (the authoritative removal is still the next bake, which drops the page entirely).
      const REMOVED = 'Profile removed';
      document.title = REMOVED + ' · Golazo 26';
      for (const sel of ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]']) {
        document.querySelector(sel)?.setAttribute('content', REMOVED);
      }
      document.querySelector('meta[property="og:image"]')?.setAttribute('content', 'https://golazo26.onwike.workers.dev/brand/og/og-default.png');
    } catch (e) { /* keep the baked page */ }
  })();
}
