// v3: client-side group-standings hydration. The baked groups page shows the standings as
// of the last code-deploy bake (good for SEO + first paint); this overlays the LIVE table
// from /api/v1/standings (D1, fed by the poll worker) so standings update with NO rebuild.
// The standings card is rendered by the SAME shared renderer build.mjs uses (/render.mjs) —
// one renderer, two runtimes. Fails safe: any error leaves the baked tables untouched.
import { makeRenderers } from '/render.mjs';

const slots = document.querySelectorAll('.groups2[data-group]');
const thirdBody = document.querySelector('[data-third-body]'); // /standings/groups third-place race target

if (slots.length || thirdBody) {
  const API = self.__G26_API__ || 'https://golazo26-data.onwike.workers.dev';
  const fmtAsOf = (iso) => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) + ' ET';
    } catch (e) { return ''; }
  };

  const hydrate = async () => {
    const [ctx, st] = await Promise.all([
      fetch('/data/schedule-context.json').then((r) => r.json()),
      fetch(API + '/api/v1/standings', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (!st || !Array.isArray(st.groups)) return; // API unreachable → keep the baked tables
    const teams = new Map(ctx.teams.map((t) => [t.name, t]));
    // venues/bcast aren't used by standingsCard, but makeRenderers needs the maps present.
    const { standingsCard, rankThirds, thirdRaceTable } = makeRenderers({ teams, flagMap: ctx.flagMap, teamColors: ctx.teamColors, bcast: new Map(), venues: new Map() });
    const byG = new Map(st.groups.map((g) => [g.group, g]));

    // Third-place race — same shared renderer; tracks live standings exactly like the group tables.
    if (thirdBody) {
      const fresh = thirdRaceTable(rankThirds(st.groups.map((g) => ({ group: g.group, rows: g.payload }))));
      if (thirdBody.innerHTML.trim() !== fresh.trim()) thirdBody.innerHTML = fresh;
    }

    let injected = 0;
    for (const wrap of slots) {
      const g = wrap.getAttribute('data-group');
      const entry = byG.get(g);
      const table = entry && entry.payload;
      // only render a table once a match has actually been played (mirrors build's fdTableFor)
      if (!Array.isArray(table) || !table.length || !table.some((r) => r.playedGames > 0)) continue;
      const asOf = entry.fetched_at ? fmtAsOf(entry.fetched_at) : '';
      const fresh = standingsCard(g, table, asOf);
      const existing = wrap.querySelector('[data-standings]');
      if (existing) existing.outerHTML = fresh;
      else wrap.insertAdjacentHTML('beforeend', fresh);
      injected++;
    }
    // once live tables are showing, keep the hero subtitle honest (the baked copy may say
    // "no matches played yet" if standings weren't baked — true at build, stale after kickoff)
    if (injected) {
      const sub = document.querySelector('.hero .sub');
      if (sub) sub.textContent = 'Standings from ESPN official tables — never computed locally.';
    }
  };

  try {
    await hydrate();
    // refresh a tab left open (API is edge-cached ~60s; standings move slowly); skip while the tab is
    // hidden so a backgrounded page makes no network calls (an internal review follow-up, mirrors bracket-connectors).
    setInterval(() => { if (document.visibilityState !== 'hidden') hydrate().catch(() => {}); }, 300e3);
  } catch (e) { /* keep the baked tables */ }
}
