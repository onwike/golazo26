// v3: client-side "Today" rollover. The baked home picks its match-days from `now` at BUILD
// time, so between bakes (now ~daily) it goes stale once the day turns — showing yesterday
// until the next bake. This recomputes the next match-days from the VISITOR'S current time and
// re-renders the .firstday / .restdays sections via the SHARED /render.mjs — no rebuild. The day
// boundary is ET (etDate hardcodes America/New_York), so "today" rolls at ET midnight for every
// visitor, recomputed from their current time. The baked sections stay for SEO + first paint;
// this corrects them on load and re-checks hourly. Fails safe: any error (or a malformed
// context) leaves the baked content.
//
// NOTE: the daySection() header logic here mirrors build.mjs's index daySection — keep in sync.
import { makeRenderers, etDateLong, etDate } from '/render.mjs';
import { aiStandings, aiStandingsCompact } from '/ai-league-render.mjs';

const firstday = document.querySelector('.todaygrid > .firstday') || document.querySelector('.firstday');
const restdays = document.querySelector('.todaygrid > .restdays') || document.querySelector('.restdays');

if (firstday || restdays) {
  const API = self.__G26_API__ || 'https://golazo26-data.onwike.workers.dev';
  const fetchLive = async () => {
    try { const r = await fetch(API + '/api/v1/live', { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch (e) { /* fall through */ }
    try { return await fetch('/data/live.json', { cache: 'no-cache' }).then((r) => r.json()); } catch (e) { return null; }
  };

  const render = async () => {
    // ai-league is fetched alongside (fail-safe): its per-match picks feed the card prediction strip.
    const [ctx, live, ai] = await Promise.all([
      fetch('/data/schedule-context.json').then((r) => r.json()),
      fetchLive(),
      fetch(API + '/api/v1/ai-league', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (!ctx || !Array.isArray(ctx.teams) || !Array.isArray(ctx.matches) || !Array.isArray(ctx.venues) || !Array.isArray(ctx.bcast)) return; // malformed context → keep baked content (cert ops finding)
    const teams = new Map(ctx.teams.map((t) => [t.name, t]));
    const venues = new Map(ctx.venues.map((v) => [v.id, v]));
    const bcast = new Map(ctx.bcast.map((r) => [r.n, r]));
    const aiPicks = new Map((ai?.matches || []).filter((m) => m.picks && Object.keys(m.picks).length).map((m) => [m.match_no, m.picks]));
    const { matchCard, fchip } = makeRenderers({ teams, flagMap: ctx.flagMap, teamColors: ctx.teamColors, bcast, venues, aiPicks });
    const liveBy = new Map((live?.matches || []).map((m) => [m.n, m]));
    const matches = ctx.matches.map((m) => { const lv = liveBy.get(m.match_no); return { ...m, status: lv ? lv.status : 'scheduled', score: lv ? lv.score : null }; });

    // the home's selection rule, computed from the VISITOR'S now (not a baked timestamp)
    const now = Date.now();
    const upcomingDays = [...new Set(matches
      .filter((m) => new Date(m.kickoff_utc).getTime() > now - 6 * 3600e3)
      .sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc))
      .map((m) => etDate(m.kickoff_utc)))].slice(0, 2);

    const daySection = (d) => {
      const ms = matches.filter((m) => etDate(m.kickoff_utc) === d).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
      if (!ms.length) return '';
      const usa = ms.some((m) => m.home.team === 'USA' || m.away.team === 'USA');
      const allFree = ms.every((m) => bcast.get(m.match_no)?.us_english === 'FOX');
      // lang="en": the kicker labels here are hardcoded English chrome (USA PLAYS / ALL FREE
      // OTA / MATCHES) — build.mjs bakes them as localized variant spans, which this re-render clobbers.
      // Localizing them needs the label pack baked onto the page, which costs ~105 B gz — it
      // does not fit the tier-1 ≤2 KB/page budget (Round-2 FIX 4 was implemented then DEFERRED for that
      // reason; see the ROADMAP follow-up ledger). English is the honest degrade; tagging the section
      // lang="en" keeps it correctly announced instead of mislabeled as the site language, and the
      // g26:rerender fired below re-runs app.js's kickoff-time pass on the fresh cards.
      return `<section class="daysec" lang="en"><h2>${etDateLong(ms[0].kickoff_utc)} <span class="kicker">${usa ? `${fchip('USA')} <b>USA PLAYS</b>` : allFree ? '<b>ALL FREE OTA</b>' : `${ms.length} MATCHES`}</span></h2>\n<div class="cards">${ms.map(matchCard).join('\n')}</div></section>`;
    };

    if (firstday) firstday.innerHTML = upcomingDays.length ? daySection(upcomingDays[0]) : '';
    if (restdays) restdays.innerHTML = upcomingDays.slice(1).map(daySection).join('\n');
    // (a later review round): this render() is ASYNC and lands AFTER app.js's synchronous g26:lang
    // kickoff-localization pass, replacing the home cards with fresh render.mjs cards whose
    // .local-time[data-utc] nodes carry raw en-US ET text app.js never re-localized. Signal a DISTINCT
    // g26:rerender (NOT g26:lang — re-firing it would re-enter this listener and self-loop) so app.js
    // re-runs localizeKickoffTimes on the new subtree; also covers the initial + ?lang-load race.
    document.dispatchEvent(new CustomEvent('g26:rerender'));
  };

  try {
    await render();
    // re-render hourly so a tab left open rolls over at ET midnight without a reload
    setInterval(() => { render().catch(() => {}); }, 3600e3);
    // re-run on a language switch (i18n.js fires g26:lang after every swap) so the re-rendered day
    // sections stay consistent and honestly tagged lang="en" rather than stranding a stale render
    // under the new site language. Idempotent + fail-safe; render() never fires g26:lang.
    document.addEventListener('g26:lang', () => { render().catch(() => {}); });
  } catch (e) { /* keep the baked content */ }
}

// AI prediction league standings widget (home page) — hydrate from /api/v1/ai-league with the SAME
// renderers the /ai-league page uses. The standings are featured at the top of the today rail
// (compact list); the full table is the fallback when the rail isn't rendered. Independent of the
// match-day rollover above; fails safe.
const aiRailSlot = document.querySelector('.rail-ai [data-ai-standings]');
const aiHomeSlot = document.querySelector('.ai-home [data-ai-standings]');
if (aiRailSlot || aiHomeSlot) {
  const API2 = self.__G26_API__ || 'https://golazo26-data.onwike.workers.dev';
  const hydrateAI = async () => {
    const data = await fetch(API2 + '/api/v1/ai-league', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!data || !Array.isArray(data.standings) || !data.standings.length) return;
    // lang="en": the standings widgets render hardcoded English labels client-side; tag the
    // hydrated slots English so they are honestly announced, not mislabeled as the site language.
    if (aiRailSlot) { aiRailSlot.innerHTML = aiStandingsCompact(data); aiRailSlot.setAttribute('lang', 'en'); }
    if (aiHomeSlot) { aiHomeSlot.innerHTML = aiStandings(data); aiHomeSlot.setAttribute('lang', 'en'); }
  };
  try { await hydrateAI(); setInterval(() => { hydrateAI().catch(() => {}); }, 120e3); } catch (e) { /* keep baked */ }
}
