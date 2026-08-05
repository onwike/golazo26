// render.mjs — shared PURE renderers + formatters for Golazo 26 (v3 dynamic delivery).
//
// Extracted from scripts/build.mjs so the SAME functions render at build time (Node)
// and, in later v3 phases, in the browser shell — one renderer, two runtimes. Pure:
// data in → string out, no fs, no Node-only APIs, no closure over build-time data.
// Each is a verbatim copy of the inline version it replaced; the dist/ hash gate
// proves the build output is byte-identical after the move.

// SECURITY (cert hardening): escape &, <, >, " and ' so the primitive is safe in both
// element-text and double/single-quoted attribute contexts. safeUrl rejects dangerous schemes.
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const safeUrl = (u) => { const s = String(u ?? '').trim(); return /^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(s) && !/^\s*(javascript|data|vbscript):/i.test(s) ? esc(s) : '#'; };
// AI brand mark from the /brand/ai-logos.svg sprite, currentColor-tinted (theme-adaptive). Mirrors the
// helper in ai-league-render.mjs — both dual-runtime modules are deliberately import-free (Node bake +
// browser hydration), so the one-line sprite ref is repeated rather than cross-imported. Same sprite ids;
// guarded by test (the sprite + both references stay in lockstep).
export const aiLogo = (p) => `<svg class="ai-logo" viewBox="0 0 24 24" aria-hidden="true"><use href="/brand/ai-logos.svg#ai-${p}"/></svg>`;

// Visitor/venue time formatting (Intl only — pure).
export const et = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const etDate = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
export const etDateLong = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
export const localT = (iso, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));

// RGB→HSL for the away-edge kit-clash rule (cert M1).
export const hsl = (hex) => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: mx ? d / mx : 0, l: (mx + mn) / 2 };
};

// the narrow markdown subset the prompts permit (bold/em/paragraphs).
export const mdLite = (md) => String(md).split(/\n\n+/).map((par) =>
  `<p>${esc(par.trim()).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')}</p>`).join('');

// Shared display constants (moved from build.mjs; the browser shell uses them too).
export const STAGE = { group: 'Group stage', r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', third: 'Third place match', final: 'Final' };
export const SPRITE = '/brand/flags.svg?v=4';
export const ANT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 14V5.5 M3 2l5 3.5L13 2 M5.2 14h5.6"/></svg>';

// Data-dependent renderers as a FACTORY: inject the lookup maps once, get the bound
// renderers back. build.mjs calls this with its loaded maps; the v3 browser shell
// (Phase 3) will call it with maps built from the data API — one renderer, two runtimes.
//   ctx: { teams:Map<name,team>, flagMap:{slug:{fifa}}, teamColors:{slug:{ui,colors}}, bcast:Map<n,row> }
// Verbatim copies of the inline build.mjs versions; the dist/ hash gate proves byte-identity.
export function makeRenderers({ teams, flagMap, teamColors, bcast, venues, aiPicks }) {
  const slugOf = (name) => teams.get(name)?.slug;
  const fifaOf = (name) => flagMap[slugOf(name)]?.fifa ?? '';
  const fchip = (name, cls = 's') => {
    const s = slugOf(name);
    return s ? `<span class="fchip ${cls}"><svg viewBox="0 0 36 36" role="img" aria-label="${esc(name)} flag"><use href="${SPRITE}#f-${s}"/></svg></span>` : '';
  };
  const flagOf = (name) => teams.get(name)?.flag ?? '';
  const kitOf = (name) => { const c = teamColors[slugOf(name)]; return c?.ui ?? null; };
  // confetti palette (v2.06.00): >=2 flag colours; single-colour flags -> [primary, white]
  const confettiColors = (name) => {
    const c = teamColors[slugOf(name)]; if (!c) return [];
    const cols = (c.colors || []).filter(Boolean);
    return cols.length >= 2 ? cols.slice(0, 3) : [c.ui?.primary, c.ui?.secondary].filter(Boolean);
  };
  // away-edge clash rule (cert M1): same-hue, same-weight primaries -> away secondary
  const edgeColors = (homeName, awayName) => {
    const hk = homeName ? kitOf(homeName) : null, ak = awayName ? kitOf(awayName) : null;
    let c1 = hk?.primary ?? 'var(--line)', c2 = ak?.primary ?? 'var(--line)';
    if (hk && ak) {
      const a = hsl(hk.primary), b = hsl(ak.primary);
      const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
      if (dh < 24 && Math.abs(a.s - b.s) < 0.25 && Math.abs(a.l - b.l) < 0.24) c2 = ak.secondary;
    }
    return { c1, c2 };
  };
  const teamLink = (name) => `<a class="team" href="/teams/${teams.get(name)?.slug}">${fchip(name)} ${esc(name)}</a>`;
  // v3.08.02 — every team leaf carries data-side (home|away) so app.js can rewrite a baked knockout
  // placeholder from /api/v1/live's resolved identity on the 60s tick. The parent (.s-match/.mc-teams)
  // carries data-match-teams=N; together they let the hydrator target exactly one side without a fresh
  // fetch target. A resolved leaf (no `tbd` class) is left untouched — self-heal replaces placeholders only.
  const sideHTML = (s, link = true, side = '') => {
    const ds = side ? ` data-side="${side}"` : '';
    return s.team
      ? (link ? `<a class="team"${ds} href="/teams/${teams.get(s.team)?.slug}">${fchip(s.team)} ${esc(s.team)}</a>`
              : `<span class="team"${ds}>${fchip(s.team)} ${esc(s.team)}</span>`)
      : `<span class="team tbd"${ds}>${esc(s.placeholder_text)}</span>`;
  };
  const matchURL = (m) => `/matches/${m.match_no}`;
  // mirrors app.js live-injection labels exactly (cert OM2: baked == injected)
  const scoreHTML = (m) => m.score && m.status !== 'scheduled'
    ? `<span class="score">${m.score.home}&nbsp;:&nbsp;${m.score.away}</span>${m.status === 'in_play' ? ` <span class="pill live"><span class="match-min" data-k="${m.kickoff_utc}">LIVE</span></span>` : (m.status === 'finished_provisional' || m.status === 'finished_confirmed') ? ' <span class="pill ft">FT ✓</span>' : ` <span class="pill warn">${esc(String(m.status).replace(/_/g, ' '))}</span>`}${m.so ? ` <span class="pens">${m.so.home}–${m.so.away}&nbsp;pens</span>` : (m.aet ? ' <span class="pens">aet</span>' : '')}`
    : `<span class="local-time" data-utc="${m.kickoff_utc}">${et(m.kickoff_utc)} ET</span>`;
  const bigTime = (m) => {
    if (m.score && m.status !== 'scheduled') return scoreHTML(m);
    const [tt, ap] = et(m.kickoff_utc).split(' ');
    return `<span class="local-time" data-utc="${m.kickoff_utc}">${tt}<small>${ap} ET</small></span>`;
  };
  const chip = (m) => {
    const b = bcast.get(m.match_no);
    if (!b) return '<span class="chip">Broadcast TBD</span>';
    const en = b.us_english, es = b.us_spanish;
    return `<span class="chip${en === 'FOX' ? ' ota' : ''}" title="US English TV — ${en === 'FOX' ? 'free over the air' : 'cable'}">${en === 'FOX' ? ANT + 'FREE · FOX' : en}</span>` +
           `<span class="chip${es === 'Telemundo' ? ' ota' : ''}" title="US Spanish TV — ${es === 'Telemundo' ? 'free over the air' : 'cable'}">${es === 'Telemundo' ? ANT + 'TELEMUNDO' : es}</span>`;
  };
  const cardKicker = (m) => {
    const bits = [m.stage === 'group' ? `GROUP ${m.group}` : STAGE[m.stage].toUpperCase(), `MATCH ${m.match_no}`];
    if (m.match_no === 1) bits.push('<b>OPENER</b>');
    else if (m.home.team === 'USA' || m.away.team === 'USA') bits.push('<b>USMNT</b>');
    return bits.join(' · ');
  };
  // AI prediction strip on a today card: each entrant model's predicted scoreline, in league order,
  // clearly labelled as a PREDICTION (never confusable with the live/final score in .mc-big). On a
  // concluded match an exact-correct scoreline is flagged `hit`. aiPicks (match_no -> {provider:{home,away}})
  // is injected once via makeRenderers; absent/empty picks render nothing (the card just stays compact).
  const AI_SHORT = { claude: 'Claude', gpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok' };
  const AI_ORD = ['claude', 'gpt', 'gemini', 'grok'];
  const aiPicksFor = (no) => aiPicks ? (typeof aiPicks.get === 'function' ? aiPicks.get(no) : aiPicks[no]) : null;
  const aiPredHTML = (m) => {
    const picks = aiPicksFor(m.match_no);
    if (!picks) return '';
    const items = AI_ORD.filter((p) => picks[p] && Number.isInteger(picks[p].home) && Number.isInteger(picks[p].away));
    if (!items.length) return '';
    const done = (m.status === 'finished_provisional' || m.status === 'finished_confirmed') && m.score;
    return `<div class="mc-ai"><span class="mc-ai-h">AI predicted ${done ? 'vs final' : 'scoreline'} <a class="mc-ai-more" href="/ai-league">league →</a></span><div class="mc-ai-row">${items.map((p) => {
      const pk = picks[p];
      const hit = done && pk.home === m.score.home && pk.away === m.score.away;
      return `<span class="mc-ai-pick${hit ? ' hit' : ''}"><span class="mc-ai-name">${aiLogo(p)} ${AI_SHORT[p]}</span><b class="mc-ai-sc">${pk.home}–${pk.away}</b></span>`;
    }).join('')}</div></div>`;
  };
  // composite match renderers (compose the leaves + venues): matchCard = home/today card;
  // srow = schedule day-rail row (s-time cell shows the score for concluded matches).
  const matchCard = (m) => {
    const v = venues.get(m.venue_id);
    const { c1, c2 } = edgeColors(m.home.team, m.away.team);
    // baked state skin: live (red) / ft (green) / scheduled (default white). app.js
    // keeps it in sync at runtime; baking it means it's right on first paint.
    const st = m.status === 'in_play' ? 'live'
      : (m.status === 'finished_provisional' || m.status === 'finished_confirmed') ? 'ft' : '';
    const names = `${esc(m.home.team ?? m.home.placeholder_text)} vs ${esc(m.away.team ?? m.away.placeholder_text)}`;
    return `<article class="mcard num"${st ? ` data-state="${st}"` : ''} style="--c1:${c1};--c2:${c2}">
  <div class="mc-top"><span class="kicker">${cardKicker(m)}</span></div>
  <div class="mc-big" data-match="${m.match_no}">${bigTime(m)}</div>
  <div class="mc-teams" data-match-teams="${m.match_no}">${sideHTML(m.home, true, 'home')} <span class="vs">vs</span> ${sideHTML(m.away, true, 'away')}</div>
  <div class="mc-meta">${esc(v.common_name)}, ${esc(v.city)} · ${localT(m.kickoff_utc, v.tz)} local</div>
  ${aiPredHTML(m)}
  <div class="chips mc-chips">${chip(m)} <a class="more" href="${matchURL(m)}" aria-label="Match page: ${names}">Match page →</a></div>
</article>`;
  };
  const STAGE_K = { group: (m) => `GRP ${m.group}`, r32: () => 'R32', r16: () => 'R16', qf: () => 'QF', sf: () => 'SF', third: () => '3RD', final: () => 'FINAL' };
  const srow = (m) => {
    const v = venues.get(m.venue_id);
    const b = bcast.get(m.match_no);
    const names = [m.home.team, m.away.team].filter(Boolean).join('|');
    const { c1, c2 } = edgeColors(m.home.team, m.away.team);
    const [tt, ap] = et(m.kickoff_utc).split(' ');
    return `<a class="srow num" href="${matchURL(m)}" data-srow data-stage="${m.stage}" data-group="${m.group ?? ''}" data-teams="${esc(names)}" data-net="${b?.us_english ?? ''}" style="--c1:${c1};--c2:${c2}">
<span class="s-time" data-match="${m.match_no}">${m.score && m.status !== 'scheduled' ? scoreHTML(m) : `<span class="local-time" data-utc="${m.kickoff_utc}">${tt}<small>${ap} ET</small></span>`}</span>
<span class="s-match" data-match-teams="${m.match_no}">${sideHTML(m.home, false, 'home')} <span class="vs">vs</span> ${sideHTML(m.away, false, 'away')}</span>
<span class="kicker s-kick">${STAGE_K[m.stage](m)}</span>
<span class="s-venue">${esc(v.common_name)}, ${esc(v.city)}</span>
<span class="s-tv">${b ? `${b.us_english === 'FOX' ? `<span class="chip ota">${ANT}FOX</span>` : `<span class="chip">${b.us_english}</span>`}${b.us_spanish === 'Telemundo' ? `<span class="chip ota">${ANT}TEL</span>` : `<span class="chip">${b.us_spanish}</span>`}` : '<span class="chip">TBD</span>'}</span>
<span class="s-go" aria-hidden="true">→</span>
</a>`;
  };
  // ---- group standings (ESPN's own tiebroken tables; never computed locally) ----
  // ESPN spells a few countries differently than our canon; map to canon so the row links to our
  // team page and picks up our colour dot. (A few football-data-era variants are kept too as a
  // harmless safety net — extra keys are simply never hit by the ESPN source.)
  const fdNorm = new Map([['South Korea', 'Korea Republic'], ['Czech Republic', 'Czechia'], ['Turkey', 'Türkiye'], ['Ivory Coast', "Côte d'Ivoire"], ['Iran', 'IR Iran'], ['Cape Verde', 'Cabo Verde'], ['DR Congo', 'Congo DR'], ['United States', 'USA'], ['Bosnia-Herzegovina', 'Bosnia and Herzegovina'], ['Curacao', 'Curaçao']]);
  // `table` is the group table array: [{team:{name}, playedGames, won, draw, lost, goalsFor, goalsAgainst, points}]
  // Same markup whether baked (build.mjs) or hydrated (site/groups.js) — one renderer, two runtimes.
  const standingsCard = (g, table, asOf) => `<div class="gcard" data-standings="${esc(g)}">
<div class="g-head"><span class="g-letter" aria-hidden="true">${esc(g)}</span><div>
<div class="kicker">STANDINGS · <b>FROM ESPN</b></div>
<p class="kicker" style="margin-top:.4rem">NEVER COMPUTED LOCALLY</p>
</div></div>
<div class="tablewrap2"><table class="standings num">
<thead><tr><th scope="col">Team</th><th scope="col">Pld</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">GF</th><th scope="col">GA</th><th scope="col">Pts</th></tr></thead><tbody>
${table.map((row, i) => {
    const name = fdNorm.get(row.team?.name) ?? row.team?.name;
    const ui = teams.has(name) ? teamColors[teams.get(name).slug]?.ui : null;
    const cls = i < 2 ? ' class="q"' : i === 2 ? ' class="q3"' : '';
    return `<tr${cls}><td>${ui ? `<span class="tdot" style="--tc:${ui.primary}"></span>` : ''}${teams.has(name) ? teamLink(name) : esc(name)}</td><td>${row.playedGames}</td><td>${row.won}</td><td>${row.draw}</td><td>${row.lost}</td><td>${row.goalsFor}</td><td>${row.goalsAgainst}</td><td class="pts">${row.points}</td></tr>`;
  }).join('\n')}
</tbody></table></div>
<p class="g-foot">Top two advance · <span style="color:var(--amber);font-weight:600">third place</span> may advance among the 8 best thirds${asOf ? ` · as of ${esc(asOf)}` : ''}</p>
</div>`;
  const normName = (name) => fdNorm.get(name) ?? name; // ESPN spelling → our canonical (shared with the third-place derivation)
  // Third-place race — DERIVED from the ESPN standings (the maintainer: never hand-entered). Shared by build.mjs
  // (bake first-paint) and site/groups.js (live overlay) — one renderer, two runtimes, like standingsCard.
  // `groups` = [{group, rows}] where rows is a group's standings array (index 2 = the 3rd-placed team).
  const rankThirds = (groups) => {
    const out = [];
    for (const { group, rows } of groups) {
      const r = Array.isArray(rows) && rows[2];
      if (!r || !(r.playedGames > 0)) continue;
      out.push({ g: group, name: normName(r.team?.name), pld: r.playedGames, pts: r.points, gd: r.goalsFor - r.goalsAgainst, gf: r.goalsFor });
    }
    return out.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf); // FIFA: points → goal difference → goals for
  };
  const thirdRaceTable = (ranked) => (ranked && ranked.length)
    ? `<div class="tablewrap2"><table class="standings num third-tbl"><thead><tr><th scope="col">#</th><th scope="col">Grp</th><th scope="col">Team</th><th scope="col">Pld</th><th scope="col">GD</th><th scope="col">GF</th><th scope="col">Pts</th></tr></thead><tbody>
${ranked.map((x, i) => `<tr class="${i < 8 ? 'q' : 'qout'}${i === 8 ? ' cut' : ''}"><td>${i + 1}</td><td>${esc(x.g)}</td><td>${teams.has(x.name) ? teamLink(x.name) : `${fchip(x.name)} ${esc(x.name)}`}</td><td>${x.pld}</td><td>${x.gd > 0 ? '+' : ''}${x.gd}</td><td>${x.gf}</td><td class="pts">${x.pts}</td></tr>`).join('\n')}
</tbody></table></div><p class="g-foot">Top 8 (green) advance; the dashed line is the qualification cut. From ESPN, never local math.</p>`
    : '<p class="muted">The 8 best third-placed teams advance — new to the 48-team format. This fills in from the official ESPN tables once group results arrive.</p>';
  return { slugOf, fifaOf, fchip, flagOf, kitOf, confettiColors, edgeColors, teamLink, sideHTML, matchURL, scoreHTML, bigTime, chip, cardKicker, aiPredHTML, matchCard, srow, standingsCard, normName, rankThirds, thirdRaceTable };
}
