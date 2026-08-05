// v3 Phase 3 PROTOTYPE — the schedule page rendered entirely client-side from the
// data API + a static render context, with NO rebuild. Proves the dynamic-delivery
// loop: static shell → import the SHARED renderer (/render.mjs, the same module the
// build uses) → fetch data → render into the DOM. Unlinked prototype; the real
// /schedule stays baked until this approach is verified and rolled out per page type.
import { makeRenderers, etDate } from '/render.mjs';

const API = self.__G26_API__ || 'https://golazo26-data.onwike.workers.dev';
const fetchLive = async () => {
  // dynamic live state (status/score/clock) — prefer the API, fall back to the static snapshot
  try { const r = await fetch(API + '/api/v1/live', { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch (e) { /* fall through */ }
  const r = await fetch('/data/live.json', { cache: 'no-cache' });
  return r.json();
};

const app = document.getElementById('app');
try {
  const [ctx, live] = await Promise.all([
    fetch('/data/schedule-context.json').then((r) => r.json()), // static maps + match base (free asset)
    fetchLive(),
  ]);
  // rebuild the lookup maps the factory needs, then bind the SAME srow the build uses
  const teams = new Map(ctx.teams.map((t) => [t.name, t]));
  const venues = new Map(ctx.venues.map((v) => [v.id, v]));
  const bcast = new Map(ctx.bcast.map((r) => [r.n, r]));
  const { srow } = makeRenderers({ teams, flagMap: ctx.flagMap, teamColors: ctx.teamColors, bcast, venues });

  // overlay the live status/score onto the static match base (the build's merge, client-side)
  const liveBy = new Map((live?.matches || []).map((m) => [m.n, m]));
  const matches = ctx.matches.map((m) => {
    const lv = liveBy.get(m.match_no);
    return { ...m, status: lv ? lv.status : 'scheduled', score: lv ? lv.score : null };
  });

  // day-rail grouping (same as the baked schedule), then render rows via the shared srow
  const days = [...new Set(matches.slice().sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc)).map((m) => etDate(m.kickoff_utc)))];
  app.innerHTML = days.map((d) => {
    const ms = matches.filter((m) => etDate(m.kickoff_utc) === d).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
    return `<section class="daysec"><div class="dayrail"><div class="d">${d}</div><div class="rulebar"></div><div class="meta">${ms.length} ${ms.length === 1 ? 'MATCH' : 'MATCHES'}</div></div><div class="slist">${ms.map(srow).join('')}</div></section>`;
  }).join('');
} catch (e) {
  app.innerHTML = '<p class="muted">Failed to load schedule: ' + (e && e.message) + '</p>';
}
