#!/usr/bin/env node
// build.mjs — Golazo 26 production static-site generator (phase 2.2-2.4).
// Zero dependencies. Bakes the entire public site into dist/ from the audited
// datasets in data/ (and, once the baker runs, live score state merged there).
// Every page carries provenance and a "data as of" stamp. ~1,250 files.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { esc, safeUrl, et, etDate, etDateLong, localT, hsl, mdLite, STAGE, SPRITE, ANT, makeRenderers } from './lib/render.mjs';
import { S, flatten } from './lib/strings.mjs';
import { blockId, HISTORY_ERAS, historyBlocks, aboutBlocks, stadiumsBlocks, profilesRegistry, profileParagraphs } from './lib/i18n-blocks.mjs';
import { aiStandings, aiStandingsCompact, aiFeatured, aiEveryPick, aiLogo } from './lib/ai-league-render.mjs';
import { bartalkSlotHTML } from './lib/bartalk-view.mjs';
import { timelineHTML, keyMomentsHTML, anchorStripHTML } from './lib/timeline-view.mjs';
import { statsRowsHTML } from './lib/stats-view.mjs';
import { mergeResolvedTeams } from './lib/poll-fixtures.mjs';
import { pensWinnerSide } from './lib/bracket-pens.mjs';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const matchesDoc = load('data/matches.json');
const matches = matchesDoc.matches;
const VER = (process.env.GITHUB_SHA || 'dev').slice(0, 8); // cache-bust app.js/predict.js per deploy
// G26_DEV=1 (set only by bake-dev.yml for the golazo26-dev staging mirror) → noindex + a DEV banner
// + robots Disallow. Strictly gated so prod output is byte-identical when unset.
const DEV = process.env.G26_DEV === '1';
// G26_PUBLIC=1 (set only by the public-release export tooling) → drop the Ops Hub from the bake:
// no module load, no /ops-hub page, no footer entry. scripts/lib/ops-hub.mjs is denied from the
// public export, so its import is dynamic and reached only when the gate is off — a static import
// would fail at module load, before a single page is emitted. Unset → output is unchanged.
const PUBLIC = process.env.G26_PUBLIC === '1';

// DEV-only staging banner + on-demand data-refresh button (dev/prod data split, Option A).
// Baked ONLY under G26_DEV so it is PHYSICALLY ABSENT from prod HTML (not CSS-hidden). The button
// POSTs to /dev/refresh on golazo26-data-dev (dev-key auth, key injected in the head DEV script) to
// fire repository_dispatch(refresh-dev-data); it reads /dev/refresh/status to show "dev data as of …"
// and an in-flight spinner. All inline (no site/*.js edit) so it ships only in the dev bake.
const DEV_BANNER = `
<div style="background:#b45309;color:#fff;text-align:center;font:600 12px/1.7 var(--font-d,system-ui);letter-spacing:.08em;text-transform:uppercase">DEV — staging mirror, not the live site · hydrates dev data (golazo26-data-dev) <button type="button" id="dev-refresh-btn" style="margin-left:.6em;background:#0b0e14;color:#fff;border:1px solid #fff;border-radius:4px;font:inherit;letter-spacing:.06em;padding:.1em .7em;cursor:pointer;vertical-align:baseline">Update dev data</button> <span id="dev-refresh-state" style="opacity:.85;font-weight:400;text-transform:none;letter-spacing:0"></span></div>
<script>(function(){
  var base=self.__G26_API__||"https://golazo26-data-dev.onwike.workers.dev";
  var btn=document.getElementById("dev-refresh-btn"),st=document.getElementById("dev-refresh-state");
  if(!btn||!st)return;
  function fmt(ts){if(!ts)return"";try{var d=new Date(ts);return"dev data as of "+d.toISOString().slice(11,16)+"Z";}catch(e){return"";}}
  function poll(){fetch(base+"/dev/refresh/status",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(j){
    if(!j)return;
    if(j.running){st.textContent="refreshing…";btn.disabled=true;setTimeout(poll,5000);}
    else{st.textContent=fmt(j.last_refresh);btn.disabled=false;}
  }).catch(function(){});}
  btn.addEventListener("click",function(){
    var key=self.__G26_DEV_REFRESH_KEY__||"";
    st.textContent="requesting…";btn.disabled=true;
    fetch(base+"/dev/refresh",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:key})})
      .then(function(r){return r.json().catch(function(){return{};}).then(function(j){return{ok:r.ok,j:j};});})
      .then(function(res){
        if(res.ok){st.textContent="refresh queued…";setTimeout(poll,3000);}
        else{st.textContent=(res.j&&res.j.error)||"refresh failed";btn.disabled=false;}
      }).catch(function(){st.textContent="refresh failed";btn.disabled=false;});
  });
  poll();
})();</script>`;

// newest file mtime under a dir (recursive); 0 if absent. Cheap stat-walk used to
// skip re-copying the large image tree when it hasn't changed (see dist assembly).
const newestMtime = (dir) => {
  if (!existsSync(dir)) return 0;
  let mx = 0;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) walk(p); else { const m = statSync(p).mtimeMs; if (m > mx) mx = m; }
  } };
  walk(dir);
  return mx;
};

// Merge tournament-time state exported from D1 by poll-and-bake (overrides
// already applied there — D1 is the single source of truth at runtime).
const liveState = existsSync('data/live-state.json') ? load('data/live-state.json') : null;
const liveByN = new Map((liveState?.matches ?? []).map((m) => [m.n, m])); // for the served live.json passthrough of live-only fields (e.g. ESPN clock `dc`)
const ledgerDoc = existsSync('data/ledger.json') ? load('data/ledger.json') : { events: [] };
const ledgerBy = (type, id) => ledgerDoc.events.filter((e) => e.entity_type === type && String(e.entity_id) === String(id)).sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
const ledgerWhen = (ts) => {
  try {
    const d = new Date(String(ts).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return String(ts);
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).toUpperCase() + ' UTC';
  } catch { return String(ts); }
};
// "Old news" recap list. ESPN-authoritative: only confirmed lines render (provisional-flagged
// events are dropped — we report ESPN's result as final, no provisional framing).
const ledgerHTML = (events, title = 'Old news') => {
  const ev = (events || []).filter((e) => !e.provisional);
  return ev.length ? `
<div class="gcard" style="margin-top:1rem">
  <div class="g-head"><div><div class="kicker">${esc(title.toUpperCase())} · <b>NEWEST FIRST</b></div></div></div>
  <ul class="g-fixtures num">
${ev.slice(0, 8).map((e) => `    <li><span class="when"${utcAttr(e.ts)}>${ledgerWhen(e.ts)}</span><span style="flex:1">${esc(e.text)}</span>${e.type === 'correction' ? '<span class="pill warn" data-i18n-skip>corrected</span>' : e.type === 'status' && /set aside/.test(e.text) ? '<span class="pill warn" data-i18n-skip>set aside</span>' : '<span class="pill ft" data-i18n-skip>FT ✓</span>'}</li>`).join('\n')}
  </ul>
  <p class="g-foot"><span${i18nBlock(S.editorial.ledgerFacts)}>${S.editorial.ledgerFacts}</span>${ev.length > 8 ? ` · showing the latest 8 of ${ev.length}` : ''} · source: ${esc(ev[0]?.source_note ?? 'live baker')}</p>
</div>` : '';
};
if (liveState) {
  const byN = new Map(liveState.matches.map((m) => [m.n, m]));
  for (const m of matches) {
    const s = byN.get(m.match_no);
    if (s) {
      m.status = s.status; m.score = s.score; if (s.so) m.so = s.so; if (s.aet) m.aet = 1; // s.so = pens score (0021); s.aet = after-extra-time flag (0022) → "aet" badge when no shootout
      // Resolve knockout fixture IDENTITY from ESPN AT EACH BAKE (poll → D1 → live-state export):
      // override the static placeholder with the D1 team. Fill-blank-only via mergeResolvedTeams
      // (unit-tested) — never touches a team matches.json already knows (groups). NOTE: identity is
      // not yet on /api/v1/live, so between bakes a freshly-resolved team can lag; the poll fires a
      // rebake on a team-fill to keep that to minutes (root-cause step 2 = live path = v3.08.02).
      mergeResolvedTeams(m, s);
    }
  }
}
// AI prediction league (Minor 3.4 display): picks exported from D1 by
// poll-and-bake into data/ai-predictions.json. Absent file = no AI sections
// bake (same no-broken-UI gate as clerk-public.json). Scoring is deterministic
// at bake time: 3 pts exact score, 1 pt right outcome, finished_confirmed only.
// AI League v2: the live league payload (recompute-ai-league.mjs → data/ai-league.json, also served
// by /api/v1/ai-league). The page + match cards bake from this for first paint; site/ai-league.js
// hydrates live. null until the first recompute — the shell still bakes and hydrates from the API.
const aiDoc = existsSync('data/ai-league.json') ? load('data/ai-league.json') : null;
const AI_ORDER = ['claude', 'gpt', 'gemini', 'grok'];
const aiByMatch = new Map(); // match_no -> [{ provider, home, away, depth, scorers?, key_players?, note, confidence }]
for (const m of aiDoc?.matches ?? []) {
  const arr = AI_ORDER.filter((p) => m.picks?.[p]).map((p) => ({ provider: p, ...m.picks[p] }));
  if (arr.length) aiByMatch.set(m.match_no, arr);
}
// match_no -> raw picks object {provider:{home,away,...}} for the today-card prediction strip (render.mjs).
const aiPicksByMatch = new Map((aiDoc?.matches ?? []).filter((m) => m.picks && Object.keys(m.picks).length).map((m) => [m.match_no, m.picks]));

// ESPN match details (lineups + key events) — data/match-details.json (poll-and-bake export from D1,
// populated by the poll worker + scripts/backfill-lineups.mjs). Baked onto match pages; null until the
// first export. ESPN is the source of truth for squads + incidents.
const matchDetailsDoc = existsSync('data/match-details.json') ? load('data/match-details.json') : null;
const detailsByNo = new Map(Object.entries(matchDetailsDoc?.matches ?? {}).map(([n, d]) => [Number(n), d]));
// "The Story" (plan item 3; cert a later change): the merged narrative timeline is its own labeled,
// anchorable section per the approved mockup — id="story" is the anchor-strip target. Gated on the
// RENDERED timeline (not raw events), so unknown-type-only events bake no empty shell.
const matchStoryHTML = (m) => {
  const d = detailsByNo.get(m.match_no);
  const tl = d?.events?.length ? timelineHTML(d.events) : '';
  // Phase 2 (items 2.4b/2.5b — closes the 1.7 deferral): always bake the section shell so the live
  // hydrator (site/match.js → /api/v1/match-events) has a fill target even when NO events existed at
  // bake; `hidden` until baked events OR live events render. `.mtl-rows` is the hydrator's fill point.
  // No-JS floor preserved: baked events show without JS; a scoreless/pre-match page stays hidden (the
  // #story anchor is gated on baked events below, so nothing links to a hidden section).
  return `<section class="story" id="story" data-story="${m.match_no}"${tl ? '' : ' hidden'}><h2>${i18nSpan(S.pages.match.storyHeading)} <span class="via-espn">${i18nSpan(S.pages.match.via)} ESPN</span></h2>
<div class="mtl-rows">${tl}</div>
<p class="muted footnote"${i18nBlock(S.pages.match.storyFootnote)}>${S.pages.match.storyFootnote}</p></section>`;
};
// Lineups: XI/bench only — the key events moved into "The Story" above.
// Gated on rendered XI content, not raw array presence.
const lineupsHTML = (m) => {
  const d = detailsByNo.get(m.match_no);
  if (!d) return '';
  const teamName = (side) => side === 'home' ? (m.home.team ?? 'Home') : side === 'away' ? (m.away.team ?? 'Away') : '';
  const xi = (side) => {
    const l = (d.lineups ?? []).find((x) => x.side === side);
    if (!l || !(l.players?.length)) return '';
    const pl = (p) => `<li>${p.jersey != null ? `<span class="num">${esc(String(p.jersey))}</span> ` : ''}${esc(p.name ?? '')} <span class="muted">${esc(p.pos ?? '')}${p.subbedOut ? ' ↓' : ''}${p.subbedIn ? ' ↑' : ''}</span></li>`;
    const start = l.players.filter((p) => p.starter);
    const bench = l.players.filter((p) => !p.starter);
    return `<div class="xi"><h3>${esc(teamName(side))}${l.formation ? ` <span class="muted">${esc(l.formation)}</span>` : ''}</h3><ul class="lineup">${start.map(pl).join('')}</ul>${bench.length ? `<p class="kicker">SUBSTITUTES</p><ul class="lineup bench">${bench.map(pl).join('')}</ul>` : ''}</div>`;
  };
  const xis = `${xi('home')}${xi('away')}`;
  if (!xis) return '';
  return `<section class="lineups" id="lineups"><h2>Lineups</h2>
<div class="xis">${xis}</div>
<p class="muted footnote"${i18nBlock(S.pages.match.lineupsFootnote)}>${S.pages.match.lineupsFootnote}</p></section>`;
};
// Humans leaderboard (Minor 3.2): exported by recompute-leaderboard during
// the bake. Same gate as the AI doc — absent file, no page, no nav entry.
// Display names arrive pre-anonymized ("First L."); full names never reach
// the generator.
const lbDoc = existsSync('data/leaderboard.json') ? load('data/leaderboard.json') : null;
// AI stories (Minor 3.3): owner-approved pieces only (status=published in
// D1, exported by poll-and-bake). Absent file = no story sections. mdLite
// renders the narrow markdown subset the prompt permits (bold/em/paras).
const stDoc = existsSync('data/stories.json') ? load('data/stories.json') : null;
const storyBy = new Map();
for (const st of stDoc?.stories ?? []) storyBy.set(`${st.kind}|${st.subject_id}|${st.locale}`, st);
const storyHTML = (kind, subject, title) => {
  const st = storyBy.get(`${kind}|${subject}|en`);
  if (!st) return '';
  return `<section class="prose"><h2>${title}</h2>${mdLite(st.body_md)}</section>`;
};
// History Hub (v2.08.00): certified edition prose (data/history/<year>.json) +
// structured facts rail (data/history/facts.json, every field extracted verbatim
// from that prose). Absent dir = no /history, no nav entry — same no-broken-UI gate.
const historyOK = existsSync('data/history/facts.json') && existsSync('data/history/hub.json');
const historyFacts = historyOK ? new Map(load('data/history/facts.json').editions.map((e) => [e.year, e])) : new Map();

  // Stadiums hub: the 16 host cities + their stadiums, rendered from the curated,
// source-verified facts sheets (data/stadiums/<id>.facts.json) joined onto the structured rail
  // (data/stadiums/facts.json). Narrative prose (data/stadiums/<id>.json + hub.json) OVERLAYS when
// present; absent → the verified facts render on their own. Absent dir = no /stadiums, no nav entry —
// the same no-broken-UI gate as History. Each <id>.facts.json carries its own sources[]; gaps[] are
// surfaced honestly ("not specified in sources"), never guessed.
const stadiumsOK = existsSync('data/stadiums/facts.json');
  // Stadiums image gallery (follow-up): data/stadiums-gallery.json keyed by venue_id, each with a
// {hero, gallery[]} of QID-identity, free-licensed photos. RENDERED via the certified galleryHTML (R2 local
// paths → CSP-safe, full ⓘ attribution). INERT until the R2-mirror step rewrites the manifest to local
// im.file paths — galleryHTML is guarded on im.file, so the remote-URL manifest renders nothing (no broken
// images, no CSP loosening). total_images:0 venues → clean placeholder (no section).
const stadiumsGallery = existsSync('data/stadiums-gallery.json')
  ? new Map((load('data/stadiums-gallery.json').venues || []).map((v) => [v.venue_id, v])) : new Map();

const venuesDoc = load('data/venues.json');
const venues = new Map(venuesDoc.venues.map((v) => [v.id, v]));
const teamsData = load('data/teams.json').teams;
const teams = new Map(teamsData.map((t) => [t.name, t]));
const rosters = load('data/rosters.json');
const rosterByTeam = new Map(rosters.teams.map((t) => [t.team, t]));
const bcastDoc = load('data/broadcasts.json');
const bcast = new Map(bcastDoc.rows.map((r) => [r.n, r]));
const peopleFifa = load('data/people-fifa.json');
const peopleUssf = load('data/people-ussf.json');
const imagesDoc = load('data/images.json');
const discrepancies = load('data/discrepancies.json');
const clerkPub = existsSync('data/clerk-public.json') ? load('data/clerk-public.json') : null;
const manifest = existsSync('data/img-manifest.json') ? load('data/img-manifest.json').manifest : {};
// gallery (up to 5 photos per subject): qid -> [{file, file_detail, author, license, license_url, file_page, width}]
const galleryManifest = existsSync('data/gallery-manifest.json') ? load('data/gallery-manifest.json').manifest : {};

// Phase 2.6: brand — audited team colors (build refuses unaudited rows) + inline mark
const teamColors = load('data/team-colors.json').teams;
{
  const bad = Object.entries(teamColors).filter(([, t]) => !t.audited);
  if (bad.length || Object.keys(teamColors).length !== 48) { console.error(`⛔ team-colors: ${bad.length} unaudited / ${Object.keys(teamColors).length} rows`); process.exit(1); }
  // SECURITY (cert): every color value is injected into style="--..." / data-* — assert each is a
  // strict hex literal so a tampered dataset can never inject CSS/markup through a color field.
  const HEX = /^#[0-9a-fA-F]{3,8}$/;
  const badHex = [];
  for (const [slug, t] of Object.entries(teamColors)) {
    for (const v of [...Object.values(t.ui ?? {}), ...(t.colors ?? [])]) {
      if (typeof v === 'string' && v.startsWith('#') && !HEX.test(v)) badHex.push(`${slug}:${v}`);
      else if (typeof v === 'string' && !v.startsWith('#') && !HEX.test(v) && v.length && !/^[a-z]+$/i.test(v)) badHex.push(`${slug}:${v}`);
    }
  }
  if (badHex.length) { console.error(`⛔ team-colors: non-hex color value(s) — ${badHex.join(', ')}`); process.exit(1); }
}
const MARK = readFileSync('site/brand/mark.svg', 'utf8').replace('<svg ', '<svg class="mark" width="22" height="22" aria-hidden="true" ');
const colorsOf = (teamName) => teamColors[teams.get(teamName)?.slug]?.ui ?? null;

const imgByName = new Map();
for (const e of imagesDoc.entries) {
  if (e.status === 'ok' && e.qid && manifest[e.qid]) imgByName.set(`${e.subject_type}:${e.name}`, { ...manifest[e.qid], qid: e.qid });
}
// gallery lookup by subject (only when the subject has >=1 extra verified photo)
const galleryByName = new Map();
for (const e of imagesDoc.entries) {
  if (e.qid && galleryManifest[e.qid]?.length) galleryByName.set(`${e.subject_type}:${e.name}`, galleryManifest[e.qid]);
}

const AS_OF_ISO = new Date().toISOString(); // machine-readable twin of AS_OF (i18n a later change data-utc stamps)
const AS_OF = AS_OF_ISO.slice(0, 16).replace('T', ' ') + ' UTC';

// ---------- i18n (v3.14 a later change, plan §3/§6): config flag, chrome packs, stamping helpers ----------
// The feature is DARK until data/i18n/config.json lists languages (langs ⊂ es/fr/de/ig/tw; en is
// implicit). Stamping (data-i18n / data-i18n-block / data-i18n-skip / data-utc) is ALWAYS on so the
// client overlay (site/i18n.js) and the a later change fragment bake key off stable anchors; the selector,
// the lang-scoped chrome spans and their CSS bake ONLY when enabled — a dark bake differs from the
// pre-i18n bake by stamps + pre-paint growth alone. G26_I18N_DIR reroutes config+packs to fixtures
// under test (an earlier fix: tests must never mutate the repo's committed data/i18n).
const I18N_DIR = process.env.G26_I18N_DIR || 'data/i18n';
const I18N_ALL = ['ig', 'tw', 'es', 'fr', 'de']; // canonical order = the selector display tier (the maintainer 2026-07-18): English, then Igbo, then Twi, then the rest; en implicit and always first
const I18N_NATIVE = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', ig: 'Ìgbò', tw: 'Twi' }; // selector self-labels (plan §3): each language names itself — never translated
const I18N_CFG = `${I18N_DIR}/config.json`;
// devLangs: enabled ONLY under G26_DEV=1 (the dev/prod split env), so a language can be
// exercised on the golazo26-dev preview while the prod bake stays byte-dark on the same config.
const i18nCfg = existsSync(I18N_CFG) ? load(I18N_CFG) : {};
const i18nWanted = [...(i18nCfg.langs ?? []), ...(DEV ? i18nCfg.devLangs ?? [] : [])];
{
  const bad = [...(i18nCfg.langs ?? []), ...(i18nCfg.devLangs ?? [])].filter((l) => !I18N_ALL.includes(l));
  if (bad.length) { console.error(`⛔ i18n: unknown language(s) in ${I18N_CFG}: ${bad.join(', ')} — allowed: ${I18N_ALL.join(', ')} (en is implicit)`); process.exit(1); }
}
const I18N_LANGS = I18N_ALL.filter((l) => i18nWanted.includes(l)); // canonical order, deduped
// Chrome packs: flat { "<strings.mjs dotted key>": "<translated>" }. An enabled language with a
// missing pack file or an unknown key fails the build loudly; a missing KEY inside a pack degrades
// that one string to English (the plan's degrade direction — never a blank, never stale).
const I18N_FLAT = flatten(S);
const I18N_PACKS = new Map();
for (const lg of I18N_LANGS) {
  const p = `${I18N_DIR}/${lg}/chrome.json`;
  if (!existsSync(p)) { console.error(`⛔ i18n: "${lg}" is enabled in ${I18N_CFG} but ${p} is missing — every enabled language ships a chrome pack`); process.exit(1); }
  const pack = load(p);
  const orphans = Object.keys(pack).filter((k) => !(k in I18N_FLAT));
  if (orphans.length) { console.error(`⛔ i18n: ${p} carries keys missing from scripts/lib/strings.mjs: ${orphans.join(', ')} — keys are API`); process.exit(1); }
  I18N_PACKS.set(lg, pack);
}
// value → dotted key (values are unique — pinned by test/i18n-strings.test.mjs), so a stamp can
// never cite a key whose English text is not the node's actual baked text.
const i18nKeyOf = new Map(Object.entries(I18N_FLAT).map(([k, v]) => [v, k]));
const i18nKey = (en) => {
  const k = i18nKeyOf.get(en);
  if (!k) { console.error(`⛔ i18n: no strings.mjs key holds this exact text: ${en}`); process.exit(1); }
  return k;
};
// Chrome text node: stamps data-i18n always; bakes lang-scoped variant spans when enabled — the
// html[data-lang] CSS below flips them pre-paint with zero JS (plan §3 tier 1). NOT used on
// #theme-btn: app.js rewrites that button's textContent every load (Theme: system/light/dark), so
// spans would be clobbered — that runtime label routes through the chrome pack in a later change.
// A translated value may legitimately carry the SAME markup as its English source (e.g. the two
// <br> H1s) — escaping it bakes a literal "<br>" into the heading. But pack values are model
// output, so raw emission is gated: the value's tag multiset must EQUAL the English source's
// (a translation can never introduce a tag the English didn't have); anything else stays escaped.
const tagSet = (s) => (String(s).match(/<\/?[a-z][^>]*>/gi) ?? []).map((t) => t.toLowerCase()).sort().join('|');
// Prose XSS gate: the prose tier (below) bakes model-authored translated HTML that
// site/i18n.js swaps via innerHTML; the chrome tagSet gate never covered it. A STRICTER tag+
// ATTRIBUTE multiset — full opening/closing tag strings, case-preserved (stricter than the
// lowercasing chrome tagSet) — so a translation can neither introduce a tag (an <img onerror>) nor
// alter an attribute (add an on*= handler, a javascript: href) the English source didn't carry. The
// tokens are joined with NO separator (.join('')), which is unambiguous because each token is a full
// tag ending in exactly one '>' with no interior '>' (the regex stops at the first '>'), so equal
// joined strings imply equal tag multisets. proseTagSafe(en, tx) is true only when the two match; a
// unit that fails is OMITTED from the fragment — baked English holds, with no foreign lang attr
// (N2/A2-NEW-1, a later review round), not written into the fragment as English.
const tagSetStrict = (s) => (String(s).match(/<\/?[a-z][^>]*>/gi) ?? []).sort().join('');
const proseTagSafe = (en, tx) => tagSetStrict(en) === tagSetStrict(tx);
const i18nSpan = (en) => {
  const key = i18nKey(en);
  const inner = I18N_LANGS.length
    ? `<span lang="en">${en}</span>${I18N_LANGS.map((lg) => { const tx = I18N_PACKS.get(lg)[key]; return `<span lang="${lg}">${tx ? (tagSet(tx) === tagSet(en) ? tx : esc(tx)) : en}</span>`; }).join('')}`
    : en;
  return `<span data-i18n="${key}">${inner}</span>`;
};
// Prose block: content-derived unit id (first 12 hex of sha256 of the block's baked English HTML).
// Editing the English changes the id → no fragment match → the client degrades to English, never
// to a stale translation (plan §3 swap mechanism; pinned by test/i18n-shell.test.mjs).
// Every stamped block registers id → English html: after the page bake, any registered block whose
// English is a strings.mjs value gets its chrome-pack translation emitted into the per-language
// shared dist/i18n/<lang>/blocks.json (route-independent — S-valued footnotes/notes/subs repeat
// across hundreds of routes; ONE shared file avoids a per-route fragment explosion that would trip
// the 15k file guard). Corpus scopes keep the per-route fragment path for page-unique prose.
const i18nBlockReg = new Map();
const i18nBlock = (html) => { const id = blockId(html); i18nBlockReg.set(id, html); return ` data-i18n-block="${id}"`; };
// Machine-readable UTC twin for baked date TEXT (the client date pass re-renders [data-utc] nodes
// in the site language). Ledger/D1 timestamps are space-form (an earlier fix): normalize to ISO-Z before any
// Date parse; an unparseable input stamps nothing rather than a wrong instant.
const utcAttr = (ts) => {
  if (!ts) return '';
  const s = String(ts).includes('T') ? String(ts) : String(ts).replace(' ', 'T') + 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : ` data-utc="${d.toISOString()}"`;
};
// Toggle UX (plan §3): <select id="lang-sel"> FIRST in .hdr-ctrls, baked ONLY when enabled; options
// self-labeled natively. site/i18n.js owns the change handler + persistence.
const langSelHTML = I18N_LANGS.length
  ? `<select id="lang-sel" aria-label="${S.chrome.controls.langLabel}">${['en', ...I18N_LANGS].map((l) => `<option value="${l}" lang="${l}">${I18N_NATIVE[l]}</option>`).join('')}</select>`
  : '';
// The zero-JS chrome flip: show only the active language's variant (en default). Inline — not
// styles.css — so the rules ship only when the feature is on; #lang-sel mirrors the house header-
// control look (styles.css #contrast-sel) minus its display:none.
const i18nStyle = I18N_LANGS.length
  ? `\n<style>[data-i18n]>[lang]{display:none}[data-i18n]>[lang="en"]{display:inline}${I18N_LANGS.map((l) => `html[data-lang="${l}"] [data-i18n]>[lang="en"]{display:none}html[data-lang="${l}"] [data-i18n]>[lang="${l}"]{display:inline}`).join('')}#lang-sel{background:none;border:1px solid var(--line);border-radius:999px;color:var(--muted);white-space:nowrap;padding:.35rem .55rem;font:600 11.5px/1 var(--font-d);letter-spacing:.06em;cursor:pointer}#lang-sel:hover{color:var(--green);border-color:var(--green)}</style>`
  : '';
// Footer sources line: one swap unit (the fragment carries the whole line incl. the as-of span).
const FOOTER_SOURCES_HTML = `${S.editorial.footerSources} · <span class="muted num" data-utc="${AS_OF_ISO}">${S.editorial.footerDataAsOf} ${AS_OF}</span>`;
// STAGE, SPRITE, ANT: imported from ./lib/render.mjs (v3 shared constants).
// esc/safeUrl/et/etDate/etDateLong/localT/hsl/mdLite: now imported from ./lib/render.mjs (v3 shared renderers — byte-identical).

// ---------- v2.00.00: flags (pinned Twemoji sprite), FIFA codes, kit tokens ----------
const flagMap = load('data/flag-map.json').teams;
// Flags / kits / score / broadcast renderers: built by makeRenderers (./lib/render.mjs)
// from the loaded lookup maps — the SAME functions the v3 browser shell will use (Phase 3).
const { slugOf, fifaOf, fchip, flagOf, kitOf, confettiColors, edgeColors, teamLink, sideHTML, matchURL, scoreHTML, bigTime, chip, cardKicker, aiPredHTML, matchCard, srow, standingsCard, normName, rankThirds, thirdRaceTable } = makeRenderers({ teams, flagMap, teamColors, bcast, venues, aiPicks: aiPicksByMatch });

const NAV = [
  ['/', S.chrome.nav.today, 'home'], ['/schedule', S.chrome.nav.schedule, 'schedule'], ['/standings', S.chrome.nav.brackets, 'standings'],
  ['/teams/', S.chrome.nav.teams, 'teams'], ['/watch', S.chrome.nav.watch, 'watch'],
  ...(historyOK ? [['/history', S.chrome.nav.history, 'history']] : []),
  ...(stadiumsOK ? [['/stadiums', S.chrome.nav.stadiums, 'stadiums']] : []),
  ['/ai-league', S.chrome.nav.aiLeague, 'ai'], // always present; the page hydrates the live league from the API
  ['/bar-talk', S.chrome.nav.barTalk, 'bartalk'], // the AI comedy panel — nav entry ships with the compact hero at go-live (v3.04.11)
  ...(lbDoc ? [['/leaderboard', S.chrome.nav.leaderboard, 'lb']] : []),
];

// Shared face renderer (Phase 2.5A): clicking a photo opens the high-res
// rendition in a lightbox that displays the FULL attribution line (author,
// license link, Commons file page, changes note) — required at that size.
const faceHTML = (img, name, sz = 34) => {
  if (!img) return `<span class="face initials">${esc((name.split(/\s+/).filter((w) => /\p{Lu}/u.test(w[0] ?? '')).length >= 2 ? name.split(/\s+/).filter((w) => /\p{Lu}/u.test(w[0] ?? '')) : name.split(/\s+/)).map((w) => (w.match(/\p{L}/u) ?? [''])[0]).filter(Boolean).slice(0, 2).join(''))}</span>`;
  const im = `<img class="face" src="/${img.file}" alt="${esc(name)}" loading="lazy" decoding="async" width="${sz}" height="${sz}">`;
  return `<a class="pic" href="/${img.file_detail ?? img.file}" data-name="${esc(name)}" data-author="${esc(img.author ?? 'see file page')}" data-license="${esc(img.license)}" data-license-url="${esc(img.license_url ?? '')}" data-page="${esc(img.file_page)}">${im}</a>`;
};
// Gallery strip (multi-image feature): renders UP TO 5 verified photos as a
// thumbnail row under the hero face. Each thumb is an `a.pic` so the existing
// attribution lightbox (site/app.js) handles open/keyboard/focus unchanged.
// `primary` is the P18 hero (slot 1); `extra` are the harvested gallery photos.
// Returns '' when there is at most the single hero image (nothing to gallery).
const galleryHTML = (primary, extra, name) => {
  if (!extra || !extra.length) return '';
  const tile = (im, idx) => `<a class="pic gthumb" href="/${im.file_detail ?? im.file}" data-name="${esc(name)}" data-author="${esc(im.author ?? 'see file page')}" data-license="${esc(im.license)}" data-license-url="${esc(im.license_url ?? '')}" data-page="${esc(im.file_page)}"><img src="/${im.file}" alt="${esc(name)} — photo ${idx}" loading="lazy" decoding="async" width="72" height="72"></a>`;
  const items = [];
  let n = 0;
  if (primary) items.push(tile(primary, ++n));
  for (const im of extra) items.push(tile(im, ++n));
  if (items.length < 2) return '';
  return `<div class="gallery" role="group" aria-label="${esc(name)} — ${items.length} ${S.attrs.verifiedPhotosSuffix}">${items.join('')}</div>
<p class="gallery-note muted">${items.length} <span${i18nBlock(S.editorial.galleryNote)}>${S.editorial.galleryNote}</span></p>`;
};
// ---------- Phase 2.5B: deep-profile registry ----------
// Assembly moved VERBATIM to lib/i18n-blocks.mjs profilesRegistry() (i18n profiles scope,
// plan §3 per-team packs): the corpus extractor must serialize byte-identical paragraph
// units from the same single registry this bake stamps — takedowns, gate-A publish safety,
// the wave gate and slug asserts all live there now (comments preserved in place).
const profReg = profilesRegistry();
const profiles = profReg?.profiles ?? new Map(); // key `${kind}:${name}` -> {slug, kind, name, team, pack, text, meta, sheet}
const teamProse = profReg?.teamProse ?? new Map(); // team name -> {text, meta, sheet}
if (profReg) console.log(`profiles loaded: ${profiles.size} people, ${teamProse.size} teams`);
const profileURL = (kind, name) => {
  const p = profiles.get(`${kind}:${name}`);
  if (!p) return null;
  return p.kind === 'player' ? `/players/${p.slug}` : `/people/${p.slug}`;
};
const nameLinkHTML = (kind, name, inner) => {
  const u = profileURL(kind, name);
  return u ? `<a class="profile-link" href="${u}">${inner}</a>` : inner;
};

const attrHTML = (img) => img ? `<a class="attr" href="${img.file_page}" rel="noopener" title="${S.attrs.photoPrefix} ${esc(img.author ?? 'see file page')} — ${esc(img.license)} — ${S.attrs.photoVia}">ⓘ</a>` : '';

function page(title, active, body, { desc = S.editorial.defaultDesc, live = false, og = '/brand/og/og-default.png', path = '/', lang = 'en', confetti = false } = {}) {
  // D2 (audit): every multi-column `table.watch` must sit in a scroll container or it forces
  // body-level horizontal overflow on mobile. Wrap them at this single assembly point so current
  // AND future watch tables are always wrapped (tables don't nest -> non-greedy match is safe).
  body = body.replace(/<table class="watch">([\s\S]*?)<\/table>/g, '<div class="tablewrap2"><table class="watch">$1</table></div>');
  // i18n an earlier revision: score clusters rendered by lib/render.mjs composites (mc-big / s-time) are stamped
  // at this same assembly point — [data-match] innerHTML is wholesale-replaced by the live tick
  // with English scoreHTML (OM2: baked == injected, untouched), so these subtrees stay English
  // permanently and data-i18n-skip tells the client overlay to never translate inside them.
  body = body.replace(/<div class="mc-big" data-match="/g, '<div class="mc-big" data-i18n-skip data-match="');
  body = body.replace(/<span class="s-time" data-match="/g, '<span class="s-time" data-i18n-skip data-match="');
  // sbk-st / g-res are stamped here too — their SOURCE patterns are certified pins
  // (standings-bracket / standings-group-scores source-scan tests), so the source keeps the
  // exact `class="…" data-match=` shape and only the baked output gains the skip attr.
  body = body.replace(/<div class="sbk-st" data-match="/g, '<div class="sbk-st" data-i18n-skip data-match="');
  body = body.replace(/<span class="num g-res" data-match="/g, '<span class="num g-res" data-i18n-skip data-match="');
  return `<!doctype html>
<html lang="${lang}"${I18N_LANGS.length ? ` data-i18n-langs="${I18N_LANGS.join(',')}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(desc)}">${DEV ? '\n<meta name="robots" content="noindex,nofollow">' : ''}
<title>${DEV ? 'DEV · ' : ''}${esc(title)} · Golazo 26</title>
<link rel="preload" href="/fonts/barlow-condensed-600-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/brand/tokens.css?v=7">
<link rel="stylesheet" href="/styles.css?v=7">${i18nStyle}
<script>try{var d=document.documentElement,u=new URLSearchParams(location.search),q=u.get("theme"),t=q||localStorage.getItem("theme");if(t)d.dataset.theme=t;var c=localStorage.getItem("contrast");if(c){var T=[6,9,13,18,24,31,39,48,58,70],B=[22,29,36,44,52,60,68,76,84,92],i=+c-1;if(T[i]){d.style.setProperty("--shine-top",T[i]+"%");d.style.setProperty("--shine-bd",B[i]+"%")}}var lq=u.get("lang"),LL=${JSON.stringify(I18N_LANGS)};if(lq&&(lq==="en"||LL.indexOf(lq)>=0))localStorage.setItem("g26-lang",lq);var lg=lq||localStorage.getItem("g26-lang");if(lg&&lg!=="en"&&LL.indexOf(lg)>=0)d.dataset.lang=lg}catch(e){}</script>${DEV ? `\n<script>self.__G26_DEV__=true;self.__G26_API__="https://golazo26-data-dev.onwike.workers.dev";self.__G26_BARTALK_API__="https://golazo26-data-dev.onwike.workers.dev";self.__G26_DEV_REFRESH_KEY__=${JSON.stringify(process.env.G26_DEV_REFRESH_KEY || '')}</script>` : ''}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#0b0e14">
<meta property="og:title" content="${esc(title)} · Golazo 26">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://golazo26.onwike.workers.dev${og}">
<meta property="og:url" content="https://golazo26.onwike.workers.dev${path}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
</head>
<body${live ? ' data-live' : ''}>
<a class="skip" href="#main">${i18nSpan(S.chrome.skip)}</a>
<div class="ticker" aria-hidden="true"><div class="wrap">
  <span>${i18nSpan(S.chrome.ticker.title)}</span>
  <span class="mid">${i18nSpan(S.chrome.ticker.dates)}</span>
  <span class="mid">${i18nSpan(S.chrome.ticker.matches)}</span>
  <span class="mid">${i18nSpan(S.chrome.ticker.teams)}</span>
  <span class="mid">${i18nSpan(S.chrome.ticker.cities)}</span>
  <span class="right"${utcAttr(AS_OF_ISO)}>${i18nSpan(S.chrome.ticker.guide)} · ${i18nSpan(S.chrome.ticker.dataAsOf)} ${AS_OF.slice(11)}</span>
</div></div>${DEV ? DEV_BANNER : ''}
<header class="site"><div class="wrap">
  <a class="brand" href="/">${MARK} <b>GOLAZO <i>26</i></b></a>
  <nav class="main" aria-label="${S.attrs.mainNav}">${NAV.map(([href, label, key]) => `<a href="${href}"${key === active ? (href === path ? ' class="on" aria-current="page"' : ' class="on"') : ''}>${i18nSpan(label)}</a>`).join('')}</nav>
  <div class="hdr-ctrls">${langSelHTML}<select id="contrast-sel" aria-label="${S.chrome.controls.contrastLabel}" title="${S.chrome.controls.contrastLabel}">${['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((v) => `<option value="${v}">${v ? `${S.chrome.controls.contrastN} ${v}` : S.chrome.controls.contrastAuto}</option>`).join('')}</select><button id="theme-btn" type="button" data-i18n="${i18nKey(S.chrome.controls.theme)}">${S.chrome.controls.theme}</button></div>
</div></header>
<main class="wrap" id="main">
${body}
</main>
<footer class="site"><div class="wrap">
<div class="links"><a href="/venues">${i18nSpan(S.chrome.footer.venues)}</a><a href="/people/fifa">${i18nSpan(S.chrome.footer.fifaAdmin)}</a><a href="/people/us-soccer">${i18nSpan(S.chrome.footer.usSoccer)}</a><a href="/como-ver">${i18nSpan(S.chrome.footer.enEspanol)}</a><a href="/ics/all.ics">${i18nSpan(S.chrome.footer.calendar)}</a><a href="/sources">${i18nSpan(S.chrome.footer.sources)}</a><a href="/about">${i18nSpan(S.chrome.footer.about)}</a><a href="/privacy">${i18nSpan(S.chrome.footer.privacy)}</a>${PUBLIC ? '' : `<a href="/ops-hub">${i18nSpan(S.chrome.footer.opsHub)}</a>`}</div>
<p${i18nBlock(S.editorial.footerLegal)}>${S.editorial.footerLegal}</p>
<p>${i18nSpan(S.editorial.footerSources)} · <span class="muted num" data-utc="${AS_OF_ISO}">${i18nSpan(S.editorial.footerDataAsOf)} ${AS_OF}</span></p>
<p id="stale-banner" class="muted" role="status" hidden${i18nBlock(S.editorial.staleBanner)}>${S.editorial.staleBanner}</p>
</div></footer>
<script src="/app.js?v=${VER}" defer></script>${I18N_LANGS.length ? `\n<script src="/i18n.js?v=${VER}" defer></script>` : ''}
${confetti ? '<script type="module" src="/confetti.js?v=1"></script>' : (live ? `<script type="module" src="/goal-celebration.js?v=${VER}"></script>` : '')}
${body.includes('predict-box') ? `<link rel="stylesheet" href="/predict.css"><script src="/predict.js?v=${VER}" defer></script>` : ''}
</body>
</html>`;
}

// ---------- assemble dist (always from clean — stale files must never deploy) ----------
{
  const dupes = [];
  const scan = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const fp = `${dir}/${e.name}`; if (/ \d+(\.|$)/.test(e.name)) dupes.push(fp); else if (e.isDirectory()) scan(fp); } };
  scan('site');
  if (dupes.length) { console.error(`⛔ Finder duplicate artifacts in site/ would deploy:\n${dupes.join('\n')}`); process.exit(1); }
}
// Rebuild dist HTML/CSS/JS from clean every bake (stale pages must never deploy),
// but preserve the heavy image tree (dist/img) across bakes and refresh it ONLY
// when site/img actually changed — copying 6,800+ image files (~392MB) byte-for-
// byte was ~70% of bake wall time, and images change only when the (rare) image
// pipeline runs, never on a score bake.
mkdirSync('dist', { recursive: true });
for (const e of readdirSync('dist', { withFileTypes: true })) {
  if (e.name !== 'img') rmSync(`dist/${e.name}`, { recursive: true, force: true });
}
for (const e of readdirSync('site', { withFileTypes: true })) {
  if (e.name !== 'img') cpSync(`site/${e.name}`, `dist/${e.name}`, { recursive: true });
}
// cpSync doesn't preserve mtimes, so a fresh dist/img always reads newer than its
// source → the next unchanged bake skips the copy; a real image-pipeline run writes
// newer files → the guard fires and refreshes the tree.
if (newestMtime('site/img') > newestMtime('dist/img')) {
  rmSync('dist/img', { recursive: true, force: true });
  cpSync('site/img', 'dist/img', { recursive: true });
  console.log('dist/img refreshed (source changed)');
} else {
  console.log('dist/img unchanged — skipped image-tree copy');
}

// SECURITY (cert remediation): emit a _headers file so the assets-only Worker sends defensive
// headers on every page. CSP locks framing (frame-ancestors none), object/base-uri, and source
// origins; script-src keeps 'unsafe-inline' ONLY because the theme/contrast pre-paint is an inline
// script in a statically-baked page (no per-request nonce is possible) — everything else is pinned.
// Clerk + the API worker are allowlisted for the predictions box; img allows self + data: (avatars).
{
  // Clerk allowlist (cert re-cert HIGH fix): predict.js loads clerk-js from, and calls, the Clerk
  // Frontend-API host ENCODED IN the publishable key — for a production publishable key that is the
  // customer's own subdomain (clerk.<domain>), which `*.clerk.accounts.dev` does NOT match. Derive
  // the exact host from the baked key (same decode predict.js uses) so the CSP allows the real
  // production host; include img.clerk.com (avatars) + worker-src blob: (clerk-js v5 web worker).
  // Clerk directives are added ONLY when the predict box can bake (clerkPub present).
  let clerkHost = '';
  try {
    const dec = clerkPub?.publishable_key ? atob(clerkPub.publishable_key.split('_')[2] || '').replace(/\$+$/, '') : '';
    // only accept a plausible hostname — an empty/garbage segment must NEVER yield a bare "https://"
    // source (which CSP treats as "any https origin", collapsing the host pinning)
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(dec)) clerkHost = 'https://' + dec;
  } catch { clerkHost = ''; }
  const clerkSrc = clerkPub ? ` https://*.clerk.accounts.dev${clerkHost ? ' ' + clerkHost : ''}` : '';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${clerkSrc}`,
    // blob: — three.js GLTFLoader hands the trophy/cauldron GLBs' embedded textures to the decoder via
    // blob: URLs (same-origin); the Knockout Room (site/knockout-room.js) needs connect-src + img-src
    // blob: for that. No external host is added — the Room issues zero cross-origin fetches.
    `connect-src 'self' blob: https://golazo26-api.onwike.workers.dev https://golazo26-data.onwike.workers.dev${DEV ? ' https://golazo26-data-dev.onwike.workers.dev' : ''}${clerkSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${clerkPub ? ' https://img.clerk.com' : ''}`,
    "font-src 'self'",
    "worker-src 'self' blob:",
    `frame-src https://challenges.cloudflare.com${clerkSrc}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');

  // CSP↔fetch-target guard (added after the 2026-06-19 live incident — see memory
  // project_golazo26_csp_dataworker). The baked connect-src MUST allowlist every golazo26-*
  // worker the client modules actually fetch; if one is missing, the browser blocks the
  // cross-origin fetch and the overlay silently falls back to STALE baked data — no error
  // surfaces, the site just shows frozen scores. So derive the fetched hosts from the client
  // source and fail the build on any host absent from connect-src. Zero-dependency; one bake.
  {
    const connectSrc = csp.split('; ').find((d) => d.startsWith('connect-src ')) || '';
    const allowed = new Set(connectSrc.split(/\s+/).slice(1)); // drop the "connect-src" keyword
    const fetched = new Map(); // golazo26-* host -> client files that reference it
    for (const f of readdirSync('site').filter((n) => n.endsWith('.js'))) {
      for (const m of readFileSync(`site/${f}`, 'utf8').matchAll(/https:\/\/golazo26-[a-z0-9-]+\.onwike\.workers\.dev/g)) {
        if (!fetched.has(m[0])) fetched.set(m[0], []);
        if (!fetched.get(m[0]).includes(f)) fetched.get(m[0]).push(f);
      }
    }
    const missing = [...fetched.keys()].filter((h) => !allowed.has(h));
    if (missing.length) {
      for (const h of missing) {
        console.error(`✖ CSP guard: client code fetches ${h} (site/${fetched.get(h).join(', site/')}) but it is ABSENT from the baked CSP connect-src. The browser will block this fetch and overlays will silently serve stale baked data (live incident 2026-06-19). Add ${h} to connect-src in scripts/build.mjs.`);
      }
      console.error(`✖ CSP guard FAILED — ${missing.length} fetched host(s) missing from connect-src. Build halted.`);
      process.exit(1);
    }
  }

  const headers = `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=(), interest-cohort=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Content-Security-Policy: ${csp}
`;
  writeFileSync('dist/_headers', headers);
}

// cardKicker: built by makeRenderers (./lib/render.mjs), destructured near the top.
// matchCard: built by makeRenderers (./lib/render.mjs), destructured near the top.

// theme-aware hero pitch art (currentColor — works on both themes; cert-fixed)
const HERO_ART = `<svg class="hero-art" viewBox="0 0 760 320" fill="none" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
  <g stroke="currentColor" stroke-width="2" opacity=".09">
    <circle cx="380" cy="160" r="150"/><circle cx="380" cy="160" r="4"/>
    <path d="M380 -20 V340"/>
    <rect x="600" y="40" width="200" height="240"/><rect x="690" y="100" width="110" height="120"/>
    <path d="M600 110 A88 88 0 0 0 600 210"/>
    <path d="M40 320 A36 36 0 0 0 76 284"/>
    <path d="M-8 30 L120 -32 M22 64 L150 2 M52 98 L180 36" stroke-width="10" opacity=".5"/>
  </g>
  <g stroke="#2ee06f" stroke-width="4.5" stroke-linecap="round" opacity=".9">
    <path d="M636 64 L625 57 M646 56 L640 40 M659 57 L664 47"/>
  </g>
</svg>`;

// Bar Talk front-page teaser (greenlit 2026-06-23): a rotating band JUST BELOW the (now-compact) hero,
// teasing the best line per persona across the last 5 episodes. IDENTITY = G&D's custom character art for
// the four personas (grok/claude/gemini/gpt) — a PLACEHOLDER chip stands in until that art lands (the maintainer
// 0173: custom art, NOT the AI logos). Hydrated client-side by site/bartalk-teaser.js from
// /api/v1/bartalk-teaser: real data → render + reveal; empty/absent → stays hidden (graceful, like the
// commentary section — zero layout shift). On the DEV mirror a sample is baked so the layout + rotation are
// previewable before any episodes exist (never shipped to prod; gated on DEV).
const barTalkTeaser = (slots) => `<section class="bartalk-teaser"${slots && slots.length ? '' : ' hidden'} aria-label="${S.attrs.barTalkTeaser}" data-bartalk-teaser>
  <a class="bt-head" href="/bar-talk"><span class="bt-badge">BAR&nbsp;TALK</span> <span class="bt-tag"${i18nBlock(S.pages.barTalk.teaserTag)}>${S.pages.barTalk.teaserTag}</span></a>
  <ul class="bt-track">${(slots || []).map((s) => bartalkSlotHTML(s, esc)).join('')}</ul>
</section>`;
// PLACEHOLDER comedic lines in the four personas the maintainer sketched (grok=absurdist gambler, claude=hunts the
// leader, gemini=humourless, chatgpt=insomniac) — DEV-preview only, replaced by real episode highlights.
const BARTALK_SAMPLE = [
  { provider: 'grok', speaker: 'Grok', line: 'I put my whole salary on 4–0 and the universe owes me nothing. Beautiful.' },
  { provider: 'claude', speaker: 'Claude', line: 'Gemini has been wrong six matches running. I am simply going to keep saying that.' },
  { provider: 'gemini', speaker: 'Gemini', line: 'I have reviewed the xG. I remain displeased. The xG is also displeased.' },
  { provider: 'gpt', speaker: 'ChatGPT', line: "It's 4am, I have not slept, Brazil win. Do not ask how I know." },
  { provider: 'grok', speaker: 'Grok', line: 'Double or nothing on the keeper scoring. This is fine. This is strategy.' },
];

// ---------- index (today / next matches) ----------
{
  const now = Date.now();
  const opener = matches[0];
  const heroKicker = now < new Date(opener.kickoff_utc).getTime()
    ? `<b>THE TOURNAMENT STARTS ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(new Date(opener.kickoff_utc)).toUpperCase()}</b> · OPENER AT ESTADIO AZTECA`
    : S.pages.home.heroKickerLive;
  const upcomingDays = [...new Set(matches
    .filter((m) => new Date(m.kickoff_utc).getTime() > now - 6 * 3600e3)
    .sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc))
    .map((m) => etDate(m.kickoff_utc)))].slice(0, 2);
  const daySection = (d) => {
    const ms = matches.filter((m) => etDate(m.kickoff_utc) === d).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
    const usa = ms.some((m) => m.home.team === 'USA' || m.away.team === 'USA');
    const allFree = ms.every((m) => bcast.get(m.match_no)?.us_english === 'FOX');
    return `<section class="daysec"><h2${utcAttr(ms[0].kickoff_utc)}>${etDateLong(ms[0].kickoff_utc)} <span class="kicker">${usa ? `${fchip('USA')} <b>${i18nSpan(S.pages.home.usaPlays)}</b>` : allFree ? `<b>${i18nSpan(S.pages.home.allFreeOta)}</b>` : `${ms.length} ${i18nSpan(S.pages.home.matchesUpper)}`}</span></h2>\n<div class="cards">${ms.map(matchCard).join('\n')}</div></section>`;
  };
  const firstDay = upcomingDays.length ? daySection(upcomingDays[0]) : '';
  const restDays = upcomingDays.slice(1).map(daySection).join('\n');

  // History rail (v2.08.x, owner-approved): the last five finals as a mini timeline beside the
  // match cards. Reuses the certified data/history/facts.json — champion + final score per edition,
  // honest "def. X" when the sources don't (yet) state a score. Grid order is chosen so on mobile
  // (single column) it falls AFTER the first match-day, not before — today's matches stay first.
  const last5 = [2022, 2018, 2014, 2010, 2006];
  const mnode = (y) => {
    const f = historyFacts.get(y);
    if (!f) return '';
    const res = f.final_score ? `${esc(f.final_score)} v ${esc(f.runner_up)}` : `def. ${esc(f.runner_up)}`;
    return `<a class="mnode" href="/history/${y}"><span class="mtop"><span class="my">${y}</span><span class="mh">${esc(f.host)}</span></span><span class="mc"><span class="crown" aria-hidden="true">★</span> ${esc(f.champion)} <span class="ms">${res}</span></span></a>`;
  };
  const rail = `<aside class="todayrail">
  <section class="rail-ai" aria-label="${S.attrs.aiRail}">
    <p class="rail-h">AI prediction league <a class="rail-more" href="/ai-league">full table →</a></p>
    <div data-ai-standings>${aiDoc ? aiStandingsCompact(aiDoc) : '<p class="muted">The live league is initializing…</p>'}</div>
    <p class="rail-ai-sub"${i18nBlock(S.pages.home.railAiSub)}>${S.pages.home.railAiSub}</p>
  </section>
  <a class="rail-cta" href="/history">
    <span class="crown" aria-hidden="true">★</span>
    <span><b>${S.pages.home.railHistoryHead}</b><span class="rc-sub"${i18nBlock(S.pages.home.railHistorySub)}>${S.pages.home.railHistorySub}</span></span>
  </a>
  <div class="rail-sec">
    <p class="rail-h">The last five finals</p>
    <div class="mini-tl">${last5.map(mnode).join('')}</div>
    <a class="rail-more" href="/history">Explore the full history →</a>
  </div>
</aside>`;
  // ---- New front page (v3.09): today-results strip + knockout BRACKET above the regular content ----
  // Bracket tree from the W{n} feeder placeholders: Final ← SF ← QF ← R16 ← R32. Each round is ordered
  // by the tree so a parent box sits between its two feeders (space-around alignment); resolved teams
  // come from ESPN (v3.08.01). Reuses fchip/matchURL; live-hydrates via [data-match].
  const KO_R = ['r32', 'r16', 'qf', 'sf', 'final'];
  const koAll = matches.filter((m) => KO_R.includes(m.stage));
  const koBy = new Map(koAll.map((m) => [m.match_no, m]));
  const feedersOf = (m) => ['home', 'away'].map((side) => { const mm = /^W(\d+)$/.exec(m[side].placeholder || ''); return mm ? Number(mm[1]) : null; });
  const finalNo = koAll.find((m) => m.stage === 'final')?.match_no;
  const ordBy = { final: finalNo != null ? [finalNo] : [] };
  for (const [r, parent] of [['sf', 'final'], ['qf', 'sf'], ['r16', 'qf'], ['r32', 'r16']]) ordBy[r] = ordBy[parent].flatMap((no) => feedersOf(koBy.get(no)).filter((x) => x != null));
  // child match_no -> the parent match it feeds, for the SVG connector layer (bracket-connectors.js).
  // Only real-match feeders (W{n}); R32's group-slot feeders aren't matches, so R32 boxes have no parent
  // edge here (they're the leaves — connectors run R32→R16→…→Final + the two SFs into the centred Final).
  const parentOf = {};
  for (const r of ['final', 'sf', 'qf', 'r16']) for (const no of (ordBy[r] || [])) { const [a, b] = feedersOf(koBy.get(no)); if (a != null) parentOf[a] = no; if (b != null) parentOf[b] = no; }
  // Compact a knockout placeholder: "Winner Match 74"→"Winner M74", "Winner Group E"→"1st Group E",
  // "Runner-up Group A"→"2nd Group A", "Third place, Group…"→"3rd · Group…". Match-feeders are rewritten
  // first to a form NOT starting with "Winner "/"Runner-up " so the group-prefix replaces can't re-bite.
  const shortPh = (t) => String(t || '')
    .replace(/^Winner Match (\d+)$/i, 'Winner M$1')
    .replace(/^Loser Match (\d+)$/i, 'Loser M$1')
    .replace(/^Winner Group /i, '1st · Group ')
    .replace(/^Runner-up Group /i, '2nd · Group ')
    .replace(/^Third place,?\s*Group\s*/i, '3rd · Group ');
  // v3.09.01 — the placeholder name span carries `data-side` so app.js's healIdentity() can rewrite it
  // from /api/v1/live's resolved identity on the 60s tick (front-page bracket + Today strip). The `.bbnm tbd`
  // class stays (unchanged styling); only a `data-side` hook is added, mirroring render.mjs sideHTML. `side`
  // is passed from nrow so the leaf declares which slot it is. Resolved leaf: no tbd, no heal — untouched.
  const koSide = (s, side = '') => s.team ? `${fchip(s.team)}<span class="bbnm">${esc(s.team)}</span>` : `<i class="ti ti-shield bbsh" aria-hidden="true"></i><span class="bbnm tbd"${side ? ` data-side="${side}"` : ''}>${esc(shortPh(s.placeholder_text))}</span>`;
  const koWin = (m) => (m.score && m.status !== 'scheduled') ? (m.score.home > m.score.away ? 'home' : m.score.away > m.score.home ? 'away' : '') : '';
  // The score/time cluster is the ONLY element carrying data-match — app.js's live hydrator
  // (app.js:130) wholesale-replaces the innerHTML of every [data-match="n"], so the team-name
  // rows must live OUTSIDE it. Baked played-match markup matches the hydrator's output exactly
  // (.score + .pill) so there is no flicker when the 60s tick takes over; scheduled = kickoff time
  // (the hydrator skips scheduled at app.js:109, leaving the baked time untouched).
  const koCluster = (m) => {
    const played = m.score && m.status !== 'scheduled';
    const inner = played
      ? `<span class="score">${m.score.home}&nbsp;:&nbsp;${m.score.away}</span> <span class="pill ${m.status === 'in_play' ? 'live' : 'ft'}">${m.status === 'in_play' ? 'LIVE' : 'FT ✓'}</span>`
      : et(m.kickoff_utc);
    return `<span class="bbst" data-i18n-skip data-match="${m.match_no}">${inner}</span>`;
  };
  // Compact side for the narrow opposing-halves columns: flag + FIFA 3-letter for a resolved team
  // (full name doesn't fit ~120px), the short slot code (1E / W74 / 3A·B·C·D·F) otherwise. The wider
  // Today strip keeps full names via koSide.
  // v3.09.01 — like koSide, the placeholder span carries `data-side` for healIdentity(). A resolved bSide
  // shows the FIFA 3-letter code (space); a freshly self-healed placeholder shows the full live name until
  // the next bake re-compacts it to the code — an acceptable transient (identity is correct either way).
  const bSide = (s, side = '') => s.team
    ? `${fchip(s.team)}<span class="bbnm">${esc(fifaOf(s.team) || s.team)}</span>`
    : `<span class="bbnm tbd"${side ? ` data-side="${side}"` : ''}>${esc((s.placeholder || 'TBD').replace(/\//g, '·'))}</span>`;
  // ---- 2D-selector scraping contract (cert R4) ----
  // site/knockout-room.js parseBracket() hydrates the 3D Room by SCRAPING the markup this bbox()
  // (plus gcard(), koCol(), finalCol/thirdHTML above/below) emits — zero fetches, DOM as the single
  // source of truth. The selectors it depends on are load-bearing; renaming/restructuring ANY of
  // these means updating parseBracket() in lockstep (its mirror contract comment lists the same set):
  //   .bcol.b-r32/.b-r16/.b-qf/.b-sf .bbox   round columns    .bcol.b-final .bcol-in > .bbox  final
  //   .bracket-third .bbox                   third place      .bbox[data-mno]                 tie id
  //   .bbrow (order: home, away)             team rows        .bbrow.w                        BAKED winner (koWin/pens — the ONLY winner truth)
  //   .bbrow[data-color]                     audited team primary (B2)
  //   .bbnm / .bbnm.tbd[data-side]           team code / unresolved slot
  //   .bbst .pill.live / .pill.ft            tie state        .bbst .score                    score "h : a"
  //   .bk-pens                               shootout resolution text (R3)
  //   .bcol.b-group .gcard  .gh  .grow .bbnm group cards
  const bbox = (m) => {
    if (!m) return '';
    // (Bracket Monument): a level-score knockout tie is decided on penalties — koWin() returns ''
    // for equal scores, so derive the advancer from the resolved downstream fixture (bracket-pens.mjs).
    const pw = pensWinnerSide(m, koBy.get(parentOf[m.match_no]));
    const w = koWin(m) || pw;
    // Shootout SCORE (migration 0021): prefer the authoritative D1 shootout score — it names the winner
    // directly (works even for the Final, where pw has no downstream fixture to derive from) and carries
    // the numbers. Fall back to pw ("advance on penalties", no number) when the score isn't populated yet.
    const penWin = m.so ? (m.so.home > m.so.away ? 'home' : 'away') : pw;
    const penScore = m.so ? ` ${Math.max(m.so.home, m.so.away)}–${Math.min(m.so.home, m.so.away)}` : '';
    // (Monument): the winner row carries its audited kit primary as an inline --bkw custom prop
    // (edgeColors applies the away-clash rule); CSS draws the edge + wash. Skipped when either team
    // is unresolved or the palette has no entry (edgeColors falls back to 'var(--line)').
    const ec = (m.home.team && m.away.team) ? edgeColors(m.home.team, m.away.team) : null;
    // Knockout Room (cert B2): EVERY resolved row also carries its audited team primary
    // (data/team-colors.json ui.primary via kitOf) as data-color, so the 3D Room reads the
    // audited palette straight off the DOM it already parses — zero new fetches, one source.
    const nrow = (side) => {
      const win = w === side;
      const kc = win && ec ? (side === 'home' ? ec.c1 : ec.c2) : '';
      const tc = m[side].team ? (kitOf(m[side].team)?.primary || '') : '';
      return `<div class="bbrow${win ? ' w' : ''}"${kc && kc !== 'var(--line)' ? ` style="--bkw:${kc}"` : ''}${tc ? ` data-color="${tc}"` : ''}>${bSide(m[side], side)}</div>`;
    };
    const v = venues.get(m.venue_id), bc = bcast.get(m.match_no);
    const rl = { r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final', third: 'Third place' }[m.stage] || '';
    // (Monument, the maintainer-direct 0532): the expanded tie CARD — full names + flags + per-side score
    // + pens resolution + kickoff/venue/TV + link. Revealed by bracket-zoom.js (short dwell on desktop,
    // tap-to-expand on touch, focus for keyboard). aria-hidden stays: content duplicates the leaf + link.
    const tieRow = (side) => {
      const s = m[side];
      const sc = (m.score && m.status !== 'scheduled') ? `<span class="bkd-sc">${side === 'home' ? m.score.home : m.score.away}</span>` : '';
      return `<div class="bkd-t">${s.team ? `${fchip(s.team)}<span>${esc(s.team)}</span>` : `<span>${esc(shortPh(s.placeholder_text) || s.placeholder || 'TBD')}</span>`}${sc}</div>`;
    };
    const detail = `<div class="bk-detail" aria-hidden="true"><div class="bkd-r">${rl}</div>${tieRow('home')}${tieRow('away')}${penWin && m[penWin]?.team ? `<div class="bkd-pens">${esc(m[penWin].team)} advance on pens${penScore}</div>` : ''}<div>${etDateLong(m.kickoff_utc)} · ${et(m.kickoff_utc)} ET</div>${v ? `<div>${esc(v.common_name)}</div>` : ''}${bc && bc.us_english ? `<div class="bkd-tv">${esc(bc.us_english)}${bc.us_spanish ? ' · ' + esc(bc.us_spanish) : ''}</div>` : ''}<div class="bkd-link">Match page →</div></div>`;
    // A4: name the advancing side on the leaf face for a penalties tie. When the shootout SCORE is
    // populated (migration 0021) show "<team> won X–Y on penalties"; before it lands, fall back to the
    // parent-derived "<team> advance on penalties" without a number (bracket-pens.mjs), exactly as before.
    const pens = penWin && m[penWin]?.team ? `<div class="bk-pens">${esc(m[penWin].team)} ${m.so ? `won${penScore} on penalties` : 'advance on penalties'}</div>` : '';
    // A5: day + network on the FACE of an unplayed leaf (the hover card is invisible on touch);
    // kickoff time already lives in the header cluster, so the strip carries date · network only.
    const when = m.status === 'scheduled' ? `<div class="bk-when">${etDate(m.kickoff_utc)}${bc?.us_english ? ` · ${esc(bc.us_english)}` : ''}</div>` : '';
    return `<a class="bbox" data-mno="${m.match_no}" data-feeds="${parentOf[m.match_no] ?? ''}" data-match-teams="${m.match_no}" href="${matchURL(m)}"><div class="bbh"><span class="bbdate"${utcAttr(m.kickoff_utc)}>${etDate(m.kickoff_utc)}</span>${koCluster(m)}</div>${nrow('home')}${nrow('away')}${pens}${when}${detail}</a>`;
  };
  const KO_LABEL = { r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-finals', sf: 'Semi-finals', final: 'Final' };
  const thirdM = matches.find((m) => m.stage === 'third');
  const thirdHTML = thirdM ? `<div class="bracket-third"><span class="bcol-h">Third place</span>${bbox(thirdM)}</div>` : '';
  // Initial stage = Groups (widest telescope) when group flanks exist — the maintainer: open the 2D bracket
  // on the Group Stage at load. Fallback (no group data) = earliest unfinished KO round, else 'final'.
  // Computed BEFORE the columns so the BAKE can collapse earlier stages to the telescoped view (cert
  // v3.09 A1: a readable no-JS floor — if bracket-zoom.js 404s/CSP-blocks/throws, the front page
  // already shows this stage, not a clipped wall). bracket-zoom.js re-applies the same .off classes.
  const FIN = (s) => s === 'finished_confirmed' || s === 'finished_provisional';
  const hasGroups = teamsData.some((t) => t.group);
  const liveFront = ['r32', 'r16', 'qf', 'sf', 'final'].find((r) => { const ms = matches.filter((m) => m.stage === r); return ms.length && ms.some((m) => !FIN(m.status)); }) || 'final';
  const curStage = hasGroups ? 'group' : liveFront;
  const BK_RANK = { group: 0, r32: 1, r16: 2, qf: 3, sf: 4, final: 5 }; // mirrors bracket-zoom.js RANK
  const curRank = BK_RANK[curStage] ?? 1;
  const offCls = (r) => ((BK_RANK[r] ?? 1) < curRank ? ' off' : ''); // baked telescoped floor: stages earlier than curStage collapsed
  // Opposing-halves bracket (the maintainer): the left half feeds semi-final 1, the right half feeds semi-final 2,
  // both converging on the centred Final. Each round's tree-order is already [left-subtree…, right-subtree…]
  // (it was built by expanding the Final's feeders [101,102] in order), so we just split each round in half;
  // the right columns render in reverse round order (SF→R32) and flow leftward toward the centre.
  const halfOf = (r, side) => { const a = ordBy[r] || []; const h = a.length / 2; return side === 'L' ? a.slice(0, h) : a.slice(h); };
  const koCol = (r, list, sideCls) => `<div class="bcol b-${r} ${sideCls}${offCls(r)}"><div class="bcol-h">${KO_LABEL[r]}</div><div class="bcol-in">${list.map((no) => bbox(koBy.get(no))).join('')}</div></div>`;
  const leftCols = ['r32', 'r16', 'qf', 'sf'].map((r) => koCol(r, halfOf(r, 'L'), 'side-l')).join('');
  const rightCols = ['sf', 'qf', 'r16', 'r32'].map((r) => koCol(r, halfOf(r, 'R'), 'side-r')).join('');
  const finalCol = `<div class="bcol b-final"><div class="bcol-h"><i class="ti ti-trophy" aria-hidden="true"></i> ${KO_LABEL.final}</div><div class="bcol-in">${(ordBy.final || []).map((no) => bbox(koBy.get(no))).join('')}${thirdHTML}</div></div>`;
  // Group stage as the OUTER flanks (the maintainer): A–F feed the left half, G–L the right. Compact cards
  // (group letter + 4 teams) that hover-expand; full standings live on /standings/groups. No 1:1 group→R32
  // arrows (the 3rd-place combination table makes that many-to-many). Default load view / Zoom-out target.
  const gcard = (g) => `<a class="gcard" href="/standings/groups#group-${g}"><div class="gh">Group ${g}</div>${teamsData.filter((t) => t.group === g).map((t) => `<div class="grow">${fchip(t.name)}<span class="bbnm">${esc(fifaOf(t.name) || t.name)}</span></div>`).join('')}</a>`;
  const groupCol = (letters, sideCls) => `<div class="bcol b-group ${sideCls}${offCls('group')}"><div class="bcol-h">Group stage</div><div class="bcol-in">${letters.map(gcard).join('')}</div></div>`;
  const groupColL = hasGroups ? groupCol(['A', 'B', 'C', 'D', 'E', 'F'], 'side-l') : '';
  const groupColR = hasGroups ? groupCol(['G', 'H', 'I', 'J', 'K', 'L'], 'side-r') : '';
  // Stage stepper: jump the viewport to any round (default = Groups when present). bracket-zoom.js wires
  // the clicks; per the maintainer's lock rule a stage step respects free pan (only Re-Center / Zoom-out re-lock).
  const STAGE_SHORT = { group: S.stage.groups, r32: S.stage.r32, r16: S.stage.r16, qf: S.stage.qf, sf: S.stage.sf, final: S.stage.final };
  const stageList = [...(hasGroups ? ['group'] : []), 'r32', 'r16', 'qf', 'sf', 'final'];
  const stageBtns = stageList.filter((r) => r === 'group' || matches.some((m) => m.stage === r))
    .map((r) => `<button type="button" class="bk-stage${r === curStage ? ' on' : ''}" data-bk-stage="${r}">${i18nSpan(STAGE_SHORT[r])}</button>`).join('');
  const bracketHTML = koAll.length ? `<section class="bracket-wrap" aria-label="${S.attrs.bracket}">
  <div class="sec-h"><h2>${i18nSpan(S.attrs.bracket)}</h2><span class="muted bk-hint"><a href="/standings">group standings →</a></span></div>
  <div class="bracket-stages" role="group" aria-label="${S.attrs.jumpToStage}"><span class="bk-stages-lbl">Stage</span>${stageBtns}</div>
  <div class="bracket-window" data-stage="${curStage}">
    <div class="bracket halves">${groupColL}${leftCols}${finalCol}${rightCols}${groupColR}</div>
    <div class="bracket-ctrls">
      <button type="button" class="bk-btn" data-bk-zoom><i class="ti ti-arrows-maximize" aria-hidden="true"></i>${i18nSpan(S.pages.home.zoomOut)}</button>
    </div>
  </div>
  <script type="module" src="/bracket-zoom.js?v=${VER}"></script>
  <script type="module" src="/knockout-room.js?v=${VER}"></script>
</section>` : '';
  // Today strip: a quick visual summary of today's results / live games up top.
  const todayET = etDate(new Date(now).toISOString());
  const todayMs = matches.filter((m) => etDate(m.kickoff_utc) === todayET).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  const tchip = (m) => {
    // A4: same penalties-winner recovery as the bracket leaf (group-stage rows have no parent → '').
    const w = koWin(m) || pensWinnerSide(m, koBy.get(parentOf[m.match_no]));
    const nrow = (side) => `<div class="bbrow${w === side ? ' w' : ''}">${koSide(m[side], side)}</div>`;
    const tag = m.group ? `Group ${m.group}` : (KO_LABEL[m.stage] || m.stage);
    return `<a class="tchip" data-match-teams="${m.match_no}" href="${matchURL(m)}"><div class="bbh"><span>${esc(tag)}</span>${koCluster(m)}</div>${nrow('home')}${nrow('away')}</a>`;
  };
  const todayStrip = todayMs.length ? `<section class="today-strip"><div class="sec-h"><h2>${i18nSpan(S.chrome.nav.today)}</h2><span class="muted"${utcAttr(todayMs[0].kickoff_utc)}>${etDateLong(todayMs[0].kickoff_utc)}</span></div><div class="ts-row">${todayMs.map(tchip).join('')}</div></section>` : '';

  // Homepage champion strip. Prefer the baked Final result; until live-state carries FT, fall
  // back to the known MetLife result (Spain 1–0 in extra time vs Argentina).
  const finalM = matches.find((m) => m.stage === 'final');
  const finalSide = finalM ? (koWin(finalM) || (finalM.so ? (finalM.so.home > finalM.so.away ? 'home' : 'away') : '')) : '';
  const champFromFinal = (finalSide && finalM[finalSide]?.team && finalM[finalSide === 'home' ? 'away' : 'home']?.team)
    ? {
        champ: finalM[finalSide].team,
        runner: finalM[finalSide === 'home' ? 'away' : 'home'].team,
        line: `${finalM.score.home}–${finalM.score.away}${finalM.so ? ` (${Math.max(finalM.so.home, finalM.so.away)}–${Math.min(finalM.so.home, finalM.so.away)} pens)` : finalM.aet ? ' in extra time' : ''}`,
      }
    : null;
  const champDecl = champFromFinal || { champ: 'Spain', runner: 'Argentina', line: '1–0 in extra time' };
  const champBanner = `<div id="champ-banner" role="status" data-i18n-skip style="background:linear-gradient(90deg,#7a102f,#c60b1e 45%,#7a102f);color:#fff;text-align:center;font:600 14px/1.85 var(--font-d,system-ui);letter-spacing:.04em;margin:0 0 1rem;padding:.4rem .75rem"><span aria-hidden="true">★</span> <strong>${esc(champDecl.champ)}</strong> are the 2026 World Champions — ${esc(champDecl.line)} vs ${esc(champDecl.runner)}</div>`;

  const body = `
${champBanner}
${todayStrip}
${bracketHTML}
<p class="free-callout solo"><span class="chip ota">${ANT}FREE OTA</span> <span><strong>${bcastDoc.totals.FOX} ${S.pages.home.freeCalloutFox}</strong> — and ${bcastDoc.totals.Telemundo} ${S.pages.home.freeCalloutTelemundo}</span> <span><a href="/watch">Antenna guide →</a> · <a href="/como-ver">en español →</a></span></p>
${barTalkTeaser(DEV ? BARTALK_SAMPLE : null)}
${historyOK ? `<div class="todaygrid">
  <div class="firstday">${firstDay}</div>
  ${rail}
  <div class="restdays">${restDays}</div>
</div>` : `${firstDay}\n${restDays}\n<section class="ai-home"><h2>AI prediction league <a class="muted" href="/ai-league" style="font-weight:400;font-size:.7em">full league →</a></h2>
<p class="muted" style="margin-top:-.4rem"${i18nBlock(S.pages.home.aiHomeSub)}>${S.pages.home.aiHomeSub}</p>
<div data-ai-standings>${aiDoc ? aiStandings(aiDoc) : '<p class="muted">Loading the live league…</p>'}</div></section>`}
<p class="more"><a href="/schedule">Full 104-match schedule →</a></p>
<script type="module" src="/today.js?v=${VER}"></script>
<script type="module" src="/bartalk-teaser.js?v=${VER}"></script>
<script type="module" src="/bracket-connectors.js?v=${VER}"></script>`;
  writeFileSync('dist/index.html', page('Today', 'home', body, { live: true }));
}

// ---------- schedule: day rails (v2) ----------
{
  // STAGE_K + srow: built by makeRenderers (./lib/render.mjs), destructured above.
  const days = [...new Set(matches.slice().sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc)).map((m) => etDate(m.kickoff_utc)))];
  const daySections = days.map((d) => {
    const ms = matches.filter((m) => etDate(m.kickoff_utc) === d).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
    const dt = new Date(ms[0].kickoff_utc);
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(dt).toUpperCase();
    const md = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(dt).toUpperCase();
    const free = ms.filter((m) => bcast.get(m.match_no)?.us_english === 'FOX').length;
    const usa = ms.some((m) => m.home.team === 'USA' || m.away.team === 'USA');
    const meta = `${ms.length} ${ms.length === 1 ? 'MATCH' : 'MATCHES'}${free ? ` · ${free === ms.length ? 'ALL' : free} FREE OTA` : ''}`;
    return `<section class="daysec" data-day="${esc(d)}">
<div class="dayrail"><div class="d"${utcAttr(ms[0].kickoff_utc)}>${md}<small>${dow}${usa ? ' · USA PLAYS' : ''}</small></div><div class="rulebar"></div><div class="meta">${meta}</div></div>
<div class="slist">
${ms.map(srow).join('\n')}
</div></section>`;
  }).join('\n');
  const body = `
<section class="hero small"><h1>${i18nSpan(S.pages.schedule.h1)}</h1></section>
<div class="filters" id="filters">
  <input type="search" id="f-text" placeholder="${S.attrs.searchTeamPlaceholder}" list="teamlist" aria-label="${S.attrs.searchTeam}">
  <datalist id="teamlist">${teamsData.map((t) => `<option>${esc(t.name)}</option>`).join('')}</datalist>
  <select id="f-stage" aria-label="${S.attrs.stageFilter}"><option value="">${S.attrs.allStages}</option>${Object.entries(STAGE).map(([k, vl]) => `<option value="${k}">${vl}</option>`).join('')}</select>
  <select id="f-group" aria-label="${S.attrs.groupFilter}"><option value="">${S.attrs.allGroups}</option>${'ABCDEFGHIJKL'.split('').map((g) => `<option>${g}</option>`).join('')}</select>
  <select id="f-net" aria-label="${S.attrs.usChannel}"><option value="">${S.attrs.anyUsChannel}</option><option>FOX</option><option>FS1</option></select>
  <span class="chip count num" id="f-count" aria-live="polite"></span>
</div>
${daySections}
<p class="muted"><span class="chip ota">${ANT}FREE</span> <span${i18nBlock(S.pages.schedule.footnote)}>${S.pages.schedule.footnote}</span></p>`;
  writeFileSync('dist/schedule.html', page('Schedule', 'schedule', body, { path: '/schedule', live: true }));
}

// ---------- 104 match pages ----------
mkdirSync('dist/matches', { recursive: true });
for (const m of matches) {
  const v = venues.get(m.venue_id);
  const b = bcast.get(m.match_no);
  const title = m.home.team && m.away.team ? `${m.home.team} vs ${m.away.team}` : `Match ${m.match_no}: ${m.home.team ?? m.home.placeholder_text} vs ${m.away.team ?? m.away.placeholder_text}`;
  const tubi = m.match_no === 1 || m.match_no === 4;
  const free = [];
  if (b?.us_english === 'FOX') free.push(S.pages.match.freeFox);
  if (b?.us_spanish === 'Telemundo') free.push(S.pages.match.freeTelemundo);
  if (tubi) free.push(S.pages.match.freeTubi);
  // Phase 1 (items 1.3 + 1.6, the design plan1): key-moment chips + anchor strip,
  // baked from data the loop already has in hand. Anchor links bake ONLY for sections with baked
  // content (how-to-watch renders on every page, so it is always on). NO bar-talk chip: the Bar Talk
  // sections are hydration shells, hidden until an episode arrives, so a baked chip would be dead on
  // initial nav everywhere; a hash-reveal in the hydrator is the Phase-2/3 residual.
  const md = detailsByNo.get(m.match_no);
  // Phase 2 (2.5b): the key-moments strip is now a live-hydration shell too. Compute the FIFA codes +
  // baked strip once; the shell (below) carries them as data-attrs so the hydrator can re-render chips
  // from the live match-events feed via the same keyMomentsHTML renderer. `hidden` until a chip exists.
  const kmHomeCode = m.home.team ? fifaOf(m.home.team) : '';
  const kmAwayCode = m.away.team ? fifaOf(m.away.team) : '';
  const kmBaked = keyMomentsHTML(md?.events, { home: kmHomeCode, away: kmAwayCode });
  const previewStory = ['scheduled', 'in_play'].includes(m.status) ? storyHTML('match_preview', String(m.match_no), 'Match preview') : '';
  const recapStory = m.status === 'finished_confirmed' ? storyHTML('match_recap', String(m.match_no), 'Match report') : '';
  const storySec = matchStoryHTML(m); // the timeline section owns id="story"
  const lineupsSec = lineupsHTML(m);
  const anchors = [
    // Phase 2: the story section is now ALWAYS baked (a live-hydration shell), so gate its anchor on
    // BAKED events — not on storySec presence — so no chip ever links to a story that's hidden pre-JS.
    ...(md?.events?.length ? [{ href: '#story', label: 'story' }] : []),
    ...(lineupsSec ? [{ href: '#lineups', label: 'lineups' }] : []),
    // Phase 2.5: match stats is a live hydration shell (never known at bake time, unlike lineups),
    // so its anchor chip bakes unconditionally alongside "how to watch" — same reasoning the cert
    // fix wave already applied to #watch (: don't gate a chip on baked content for a section
    // that fills in via live fetch). Suppressing it entirely, pre-hydration, was considered but
    // rejected: the section itself renders a "not yet available" empty-state rather than hiding, so
    // its anchor should be consistently present too — matching #watch's own always-on precedent.
    { href: '#stats', label: 'match stats' },
    { href: '#watch', label: 'how to watch' },
    ...(aiByMatch.has(m.match_no) ? [{ href: '#ai', label: 'AI corner' }] : []),
  ];
  const clTeam = (s, alignEnd = false) => s.team
    ? `${alignEnd ? '' : `${fchip(s.team, 'lg')} `}<a class="team" href="/teams/${slugOf(s.team)}">${fifaOf(s.team)}</a>${alignEnd ? ` ${fchip(s.team, 'lg')}` : ''}`
    : `<span class="team tbd" style="font:600 14px var(--font-d)">${esc(s.placeholder_text)}</span>`;
  const body = `
<p class="crumb"><a href="/schedule">← Schedule</a></p>
<section class="hero small">
<p class="kicker"${utcAttr(m.kickoff_utc)}>${i18nSpan(S.stage.match)} ${m.match_no} · ${m.stage === 'group' ? `${i18nSpan(S.stage.groupUpper)} ${m.group}` : STAGE[m.stage].toUpperCase()} · ${etDateLong(m.kickoff_utc).toUpperCase()}</p>
<h1 class="matchup" data-match-teams="${m.match_no}">${sideHTML(m.home, true, 'home')} <span class="vs">vs</span> ${sideHTML(m.away, true, 'away')}</h1>
</section>
<div class="cluster num">
  <div class="cl-row">
    <div class="cl-team">${clTeam(m.home)}</div>
    <div class="cl-mid" data-i18n-skip data-match="${m.match_no}"${m.home.team && m.away.team ? ` data-home-team="${esc(m.home.team)}" data-away-team="${esc(m.away.team)}" data-home-colors="${confettiColors(m.home.team).join(',')}" data-away-colors="${confettiColors(m.away.team).join(',')}"` : ''}>${scoreHTML(m)}</div>
    <div class="cl-team">${clTeam(m.away, true)}</div>
  </div>
  <div class="cl-bar" data-i18n-skip>${m.status === 'scheduled' ? `KICKOFF ${etDateLong(m.kickoff_utc).toUpperCase()} · ${et(m.kickoff_utc)} ET · ${localT(m.kickoff_utc, v.tz).toUpperCase()} LOCAL` : m.status === 'in_play' ? 'LIVE' : m.status === 'postponed' ? 'POSTPONED' : `FULL TIME${m.so ? ' — DECIDED ON PENALTIES' : m.aet ? ' — AFTER EXTRA TIME' : ''}`} · ${esc(v.common_name).toUpperCase()}, ${esc(v.city).toUpperCase()}</div>
</div>
<div class="kmoments-live" data-kmoments="${m.match_no}" data-home-code="${esc(kmHomeCode)}" data-away-code="${esc(kmAwayCode)}"${kmBaked ? '' : ' hidden'}>${kmBaked}</div>
${anchorStripHTML(anchors)}
${ledgerHTML(ledgerBy('match', m.match_no), `Match ${m.match_no} — old news`)}
<p class="meta">${esc(v.common_name)} (${esc(v.fifa_name)}), ${esc(v.locality)} · <span class="local-time" data-utc="${m.kickoff_utc}">${et(m.kickoff_utc)} ET</span> <span class="muted">(${localT(m.kickoff_utc, v.tz)} local)</span></p>
${storySec}
<div data-preview-slot="${m.match_no}">${previewStory}</div>
<div data-recap-slot="${m.match_no}">${recapStory}</div>
${lineupsSec}
<section class="mst" id="stats" data-match-stats="${m.match_no}"><h2>${i18nSpan(S.pages.match.matchStats)} <span class="via-espn">${i18nSpan(S.pages.match.via)} ESPN</span></h2>
<div class="mst-rows"></div>
<p class="mst-empty muted"${i18nBlock(S.pages.match.statsEmpty)}>${S.pages.match.statsEmpty}</p>
<p class="mst-asof muted"></p></section>
<div class="match-feeds">
<section class="commentary" data-commentary="${m.match_no}" hidden><h2>${i18nSpan(S.pages.match.blowByBlow)} <span class="via-espn">${i18nSpan(S.pages.match.via)} ESPN</span></h2><ol class="cmt-list" aria-live="polite"></ol><p class="cmt-asof muted"></p></section>
<section class="watchalong" data-watchalong="${m.match_no}" hidden><h2>${i18nSpan(S.pages.match.watchAlongHeading)} <span class="via-espn via-ai">AI ${i18nSpan(S.pages.match.aiComedy)}</span></h2><ol class="wa-list" aria-live="polite"></ol><p class="wa-asof muted"></p><p class="muted wa-note"${i18nBlock(S.pages.match.watchAlongNote)}>${S.pages.match.watchAlongNote}</p></section>
</div>
<section class="watchbox" id="watch"><h2>${i18nSpan(S.pages.match.howToWatchUs)}</h2>
<details class="watch-more">
<summary>${free.length ? `<span class="chip ota">${ANT}FREE</span> <span>${free.join(' · ')}</span>` : `<span class="muted"${i18nBlock(S.pages.match.noFree)}>${S.pages.match.noFree}</span>`}</summary>
<table class="watch">
<tr><th>English TV</th><td><strong>${b?.us_english ?? 'TBD'}</strong>${b?.us_english === 'FS1' ? ' — cable only; no free English broadcast. Watch options (FOX One $19.99/mo · 4K · 7-day trial, or a live-TV trial): <a href="https://www.foxsports.com/live" rel="noopener">foxsports.com/live</a>' : b?.us_english === 'FOX' ? ' — free over the air with an antenna; also on every live-TV service' : ''} · <a href="https://www.foxsports.com/soccer/fifa-world-cup/schedule" rel="noopener">FOX schedule</a></td></tr>
<tr><th>Spanish TV</th><td><strong>${b?.us_spanish ?? 'TBD'}</strong>${b?.us_spanish === 'Telemundo' ? ' — free over the air with an antenna' : b?.us_spanish === 'Universo' ? ' — cable only' : ''} · stream all 104 in Spanish on <a href="https://www.peacocktv.com/" rel="noopener">Peacock</a> ($10.99/mo)</td></tr>
<tr><th>Streaming</th><td><a href="https://www.peacocktv.com/" rel="noopener">Peacock</a> (Spanish, all 104, $10.99/mo) · <a href="https://www.foxsports.com/live" rel="noopener">FOX One</a> (English, 4K, $19.99/mo, 7-day trial)${tubi ? ' · <strong><a href="https://tubitv.com/" rel="noopener">Tubi</a> — free 4K</strong>' : ''} · <a href="/sources#streaming">pricing sources</a></td></tr>
<tr><th>Canada / México</th><td>Canada: TSN/RDS (all 104), CTV free for 44 (QFs onward except the 3rd-place match) · México: 32 free en TV abierta, ViX (all 104) — <a href="/watch#ca-mx">details</a></td></tr>
</table>
<p class="muted">Channel verified ${b?.verified_at ?? ''} — <a href="${b?.source_url ?? '/sources'}" rel="noopener">source</a>.</p>
</details></section>
${clerkPub && m.home.team && m.away.team && m.status === 'scheduled' ? `<section><h2>Predict this match</h2><div id="predict-box" data-match="${m.match_no}" data-kickoff="${m.kickoff_utc}" data-pk="${clerkPub.publishable_key}"></div></section>` : ''}
${aiByMatch.has(m.match_no) ? `<section id="ai"><h2>AI prediction league</h2>
${aiPredHTML(m)}
<p class="muted"${i18nBlock(S.pages.match.aiPicksNote)}>${S.pages.match.aiPicksNote}</p></section>` : ''}
<section class="bartalk-ep bartalk-pre" data-bartalk-pre="${m.match_no}" hidden><h2>${i18nSpan(S.pages.match.barTalkPre)} <span class="via-espn via-ai">AI ${i18nSpan(S.pages.match.aiComedy)}</span> <a class="bt-ep-more muted" href="/bar-talk">${i18nSpan(S.pages.match.allEpisodes)}</a></h2><div class="bt-ep-body"></div><p class="muted bt-ep-note"${i18nBlock(S.pages.match.barTalkPreNote)}>${S.pages.match.barTalkPreNote}</p></section>
<section class="bartalk-ep" data-bartalk="${m.match_no}" id="bartalk" hidden><h2>Bar Talk <span class="via-espn via-ai">AI ${i18nSpan(S.pages.match.aiComedy)}</span> <a class="bt-ep-more muted" href="/bar-talk">${i18nSpan(S.pages.match.allEpisodes)}</a></h2><div class="bt-ep-body"></div><p class="muted bt-ep-note"${i18nBlock(S.pages.match.barTalkNote)}>${S.pages.match.barTalkNote}</p></section>
${m.stage === 'group' ? `<section><h2>${i18nSpan(S.attrs.groupFilter)} ${m.group}</h2><p>${teamsData.filter((t) => t.group === m.group).map((t) => teamLink(t.name)).join(' · ')} — <a href="/groups#group-${m.group}">table</a></p></section>` : ''}
<p class="muted footnote">Provenance: schedule from openfootball ⨯ fixturedownload (cross-checked${[29, 31].includes(m.match_no) ? '; kickoff resolved 2-of-3 with Wikipedia and confirmed against FIFA — <a href="/sources#discrepancies">details</a>' : ''}); kickoff in UTC: <code>${m.kickoff_utc}</code>. Add to calendar: <a href="/ics/all.ics">.ics</a></p>
<script type="module" src="/match.js?v=${VER}"></script>`;
  const ogPath = m.home.team && teamColors[teams.get(m.home.team)?.slug] ? `/brand/og/${teams.get(m.home.team).slug}-og.png` : '/brand/og/og-default.png';
  writeFileSync(`dist/matches/${m.match_no}.html`, page(title, 'schedule', body, { og: ogPath, path: `/matches/${m.match_no}`, live: true, confetti: true, desc: `${title} — ${etDateLong(m.kickoff_utc)}, ${v.common_name}. How to watch free in the US.` }));
}

// ---------- teams index + 48 team pages ----------
mkdirSync('dist/teams', { recursive: true });

// Country banner (cert-approved system): shared frame — ink field, outlined FIFA code,
// kit baseline — country layer = the team's pinned Twemoji flag at a broadcast crop.
// Per-flag transforms tuned for the certified eight; centered safe crop otherwise.
const FLAG_TF = {
  'czechia': 'translate(312 -120) scale(10)', 'mexico': 'translate(312 -84) scale(8)',
  'south-africa': 'translate(312 -102) scale(9)', 'bosnia-and-herzegovina': 'translate(303 -102) scale(9)',
  'qatar': 'translate(240 -120) scale(10)', 'switzerland': 'translate(254.5 -147) scale(11.5)',
};
const TBC = { // banner-code color: cert-audited picks; default = lighter of the kit pair
  'czechia': '#d7141a', 'korea-republic': '#c60c30', 'mexico': '#a6d388', 'south-africa': '#ffb611',
  'bosnia-and-herzegovina': '#fbd116', 'canada': '#d52b1e', 'qatar': '#eeeeee', 'switzerland': '#d32d27',
};
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255); };
const relLum = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
const cRatio = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const visBase = (hex) => hex?.toLowerCase() === '#eeeeee' ? '#d7dadd' : hex; // cert M2: white baselines -> visible neutral
const bannerSVG = (t) => {
  const ui = teamColors[t.slug]?.ui;
  if (!ui) return '';
  const tf = FLAG_TF[t.slug] ?? 'translate(294 -102) scale(9)';
  let tbc = TBC[t.slug] ?? (lum(ui.primary) >= lum(ui.secondary) ? ui.primary : ui.secondary);
  if (cRatio(tbc, '#11151d') < 3) tbc = ui.onDark && cRatio(ui.onDark, '#11151d') >= 3 ? ui.onDark : '#eeeeee'; // cert M4 floor
  return `<svg class="banner" viewBox="0 0 600 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="--tb1:${ui.primary};--tbc:${visBase(tbc) === '#d7dadd' ? '#eeeeee' : tbc}">
<clipPath id="bc-${t.slug}"><polygon points="336,0 600,0 600,120 312,120"/></clipPath>
<rect width="600" height="120" fill="var(--banner-ink,#11151d)"/>
<g clip-path="url(#bc-${t.slug})"><rect x="312" y="0" width="288" height="120" fill="#eee"/><use href="${SPRITE}#f-${t.slug}" width="36" height="36" transform="${tf}"/></g>
<text class="bcode" x="24" y="94">${flagMap[t.slug].fifa}</text>
<rect x="0" y="113" width="330" height="7" fill="${ui.primary}"/><rect x="330" y="113" width="270" height="7" fill="${visBase(ui.secondary)}"/>
</svg>`;
};

{
  const groups = [...new Set(teamsData.map((t) => t.group))];
  const body = `
<section class="hero small"><h1>${i18nSpan(S.chrome.nav.teams)}</h1>
<p class="sub"${i18nBlock(S.pages.teams.indexSub)}>${S.pages.teams.indexSub}</p></section>
${groups.map((g) => `<p class="kicker" style="margin:1.4rem 0 .6rem" id="group-${g}">${i18nSpan(S.stage.groupUpper)} ${g}</p><div class="tgrid">${teamsData.filter((t) => t.group === g).map((t) => {
    const r = rosterByTeam.get(t.name);
    return `<a class="tcard" href="/teams/${t.slug}">${bannerSVG(t)}<div class="t-body">${fchip(t.name, 'lg')}<div><b>${esc(t.name)}</b><span>${esc(r?.coach?.name ?? 'Coach TBD')} · ${r?.players.length ?? '–'} players</span></div></div></a>`;
  }).join('')}</div>`).join('\n')}`;
  writeFileSync('dist/teams/index.html', page('Teams', 'teams', body, { path: '/teams/' }));
}
for (const t of teamsData) {
  const r = rosterByTeam.get(t.name);
  const fixtures = matches.filter((m) => m.home.team === t.name || m.away.team === t.name).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  const coachImg = imgByName.get(`coach:${r?.coach?.name}`);
  const attr = attrHTML;
  const face = faceHTML;
  const tcol = teamColors[t.slug]?.ui;
  const fm = flagMap[t.slug];
  const firstFix = fixtures[0]; // reuse the already-computed sorted fixtures (was a duplicate filter+sort per team)
  const nameUp = t.name.toUpperCase();
  const heroFS = nameUp.length > 16 ? 52 : nameUp.length > 10 ? 68 : 88;
  const heroSVG = `<svg class="team-hero2" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(t.name)} — Group ${t.group} ${S.attrs.teamHeaderSuffix}">
<clipPath id="hc-${t.slug}"><polygon points="620,0 1200,0 1200,260 560,260"/></clipPath>
<rect width="1200" height="260" fill="var(--banner-ink,#11151d)"/>
<g clip-path="url(#hc-${t.slug})"><rect x="560" y="0" width="640" height="260" fill="#eee"/><use href="${SPRITE}#f-${t.slug}" width="36" height="36" transform="translate(556 -194) scale(18)"/></g>
<g font-family="'Barlow Condensed',system-ui,sans-serif" font-weight="600">
<text class="svgtxt-sm" x="42" y="78" font-size="16" letter-spacing="4" fill="#9aa4b1">GROUP ${t.group} · GOLAZO 26 TEAM GUIDE</text>
<text x="38" y="166" font-size="${heroFS}" letter-spacing="3" fill="#e9ecf1">${esc(nameUp)}</text>
<text class="svgtxt-sm" x="42" y="218" font-size="16" letter-spacing="2.5" fill="#9aa4b1">COACH ${esc((r?.coach?.name ?? 'TBD').toUpperCase())} · ${r?.players.length ?? '–'} PLAYERS${firstFix ? ` · FIRST MATCH ${etDate(firstFix.kickoff_utc).toUpperCase()}` : ''}</text>
</g>
<rect x="42" y="180" width="86" height="6" fill="var(--k1)"/><rect x="128" y="180" width="64" height="6" fill="var(--k2)"/>
<rect x="0" y="254" width="660" height="6" fill="var(--k1)"/><rect x="660" y="254" width="540" height="6" fill="var(--k2)"/>
</svg>
<div class="thero-caption"><span class="kicker">GROUP ${t.group} · COACH ${esc((r?.coach?.name ?? 'TBD').toUpperCase())} · ${r?.players.length ?? '–'} PLAYERS</span></div>`;
  const body = `
<p class="crumb"><a href="/teams/">← Teams</a></p>
${heroSVG}
<h1 class="vh">${esc(t.name)}</h1>
<p class="meta">Group ${t.group} · Head coach: ${coachImg ? face(coachImg, r.coach.name) : ''} <strong>${nameLinkHTML('coach', r?.coach?.name ?? '', esc(r?.coach?.name ?? 'TBD'))}</strong> ${attr(coachImg)} · FIFA code <strong class="num">${fm.fifa}</strong></p>
${teamProse.has(t.name) ? `<section class="prose"><h2>${i18nSpan(S.pages.teams.aboutThisTeam)}</h2>${teamProse.get(t.name).text.split(/\n\n+/).map((par) => `<p>${esc(par)}</p>`).join('')}${proseFooter(teamProse.get(t.name))}</section>` : ''}
${storyHTML('team_outlook', t.name, 'Tournament outlook')}
<section><h2>${i18nSpan(S.pages.teams.fixtures)}</h2><ul class="fixtures">${fixtures.map((m) => {
    const v = venues.get(m.venue_id);
    return `<li><a class="muted" href="${matchURL(m)}">${etDate(m.kickoff_utc)}</a> — ${sideHTML(m.home, m.home.team !== t.name)} vs ${sideHTML(m.away, m.away.team !== t.name)} · <span data-i18n-skip data-match="${m.match_no}">${m.score && m.status !== 'scheduled' ? scoreHTML(m) : `<span class="local-time" data-utc="${m.kickoff_utc}">${et(m.kickoff_utc)} ET</span>`}</span> · ${esc(v.common_name)} ${chip(m)}</li>`;
  }).join('')}</ul>
<p class="muted"><span${i18nBlock(S.pages.teams.knockoutNote)}>${S.pages.teams.knockoutNote}</span> <a href="/ics/${t.slug}.ics">Add ${esc(t.name)}'s matches to your calendar</a></p></section>
${ledgerHTML(ledgerBy('team', t.slug), `${t.name} — old news`)}
<section><h2>${i18nSpan(S.pages.teams.squad)} — ${r?.players.length ?? 0} ${i18nSpan(S.pages.teams.players)}</h2>
<div class="tablewrap"><table class="roster"><thead><tr><th>#</th><th>Pos</th><th>Player</th><th>Born</th><th>Caps</th><th>Goals</th><th>Club</th></tr></thead><tbody>
${(r?.players ?? []).slice().sort((a, b) => a.no - b.no).map((p) => {
    const img = imgByName.get(`player:${p.name}`);
    return `<tr><td>${p.no}</td><td>${p.pos}</td><td class="player">${face(img, p.name)} ${nameLinkHTML('player', p.name, esc(p.name))}${p.captain ? ' <span class="cap">(c)</span>' : ''} ${attr(img)}</td><td>${p.dob}</td><td>${p.caps}</td><td>${p.goals}</td><td>${esc(p.club)}</td></tr>`;
  }).join('\n')}
</tbody></table></div>
<p class="muted">Roster: Wikipedia squads page, <a href="${rosters.source.permalink}" rel="noopener">pinned revision ${rosters.source.revid}</a> (<a href="${rosters.source.license_url}" rel="noopener">CC BY-SA 4.0</a>). <span${i18nBlock(S.pages.teams.photosNote)}>${S.pages.teams.photosNote}</span></p></section>`;
  // teamscope doctrine (cert): decorative art = kit tokens (--k1/--k2, theme-invariant);
  // text accents/rings = audited ui.onLight/onDark per theme (--t1-l/--t1-d).
  const t1l0 = tcol?.onLight ?? tcol?.primary, t1d0 = tcol?.onDark ?? tcol?.primary;
  const t1l = tcol && cRatio(t1l0, '#f6f7f4') >= 4.5 ? t1l0 : '#0b7c38';   // cert M5 AA floor
  const t1d = tcol && cRatio(t1d0, '#1a1f2b') >= 4.5 ? t1d0 : '#2ee06f';
  const wrapped = tcol
    ? `<div class="teamscope" style="--k1:${tcol.primary};--k2:${visBase(tcol.secondary)};--t1-l:${t1l};--t1-d:${t1d};--t2-l:${tcol.secondary};--on-t1-l:#fff;--on-t1-d:#0b0e14">${body}</div>`
    : body;
  writeFileSync(`dist/teams/${t.slug}.html`, page(`${t.name} — squad & fixtures`, 'teams', wrapped, { og: `/brand/og/${t.slug}-og.png`, path: `/teams/${t.slug}` }));
}

// ---------- groups (tables from ESPN's own standings, never local tiebreaker math) ----------
{
  // First-paint standings come from the last code-deploy bake (liveState); site/groups.js
  // then overlays the LIVE table from /api/v1/standings (D1, fed by the poll worker) so
  // standings update with NO rebuild. standingsCard is the SAME shared renderer the browser
  // uses (./lib/render.mjs) — one renderer, two runtimes. fdNorm moved there too.
  // ESPN standings snapshot from the bake (liveState.standings), shape [{group:letter, payload:[rows]}]
  // — IDENTICAL to /api/v1/standings, so the baked first-paint and the groups.js hydration consume
  // the same ESPN data (honest "FROM ESPN" label on both paths).
  const fdStandings = liveState?.standings ?? null;
  const groups = [...new Set(teamsData.map((t) => t.group))];
  const fdTableFor = (g) => {
    const grp = fdStandings?.find((s) => s.group === g);
    const table = grp?.payload;
    return Array.isArray(table) && table.some((r) => r.playedGames > 0) ? table : null;
  };
  const stAsOf = liveState?.standings_at
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(String(liveState.standings_at).replace(' ', 'T') + 'Z')) + ' ET'
    : '';
  const tables = new Map(groups.map((g) => [g, fdTableFor(g)]));
  const anyTable = [...tables.values()].some(Boolean);
  const drawCard = (g) => {
    const gTeams = teamsData.filter((t) => t.group === g);
    const fx = matches.filter((m) => m.stage === 'group' && m.group === g).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
    const first = fx[0];
    const v = first ? venues.get(first.venue_id) : null;
    return `<div class="gcard">
<div class="g-head"><span class="g-letter" aria-hidden="true">${g}</span><div>
<div class="flags">${gTeams.map((t) => fchip(t.name, 'lg')).join(' ')}</div>
<p class="kicker" style="margin-top:.45rem">${i18nSpan(S.pages.standings.firstMatch)} · <b${first ? utcAttr(first.kickoff_utc) : ''}>${first ? etDate(first.kickoff_utc).toUpperCase() : 'TBD'}</b>${v ? ` · ${esc(v.common_name).toUpperCase()}` : ''}</p>
</div></div>
<ul class="g-fixtures num">
${fx.map((m) => `<li><span class="when"${utcAttr(m.kickoff_utc)}>${etDate(m.kickoff_utc).toUpperCase()}</span><span style="flex:1">${fchip(m.home.team)} <a class="team" href="${matchURL(m)}">${esc(m.home.team)} — ${esc(m.away.team)}</a> ${fchip(m.away.team)}</span><span class="num g-res" data-match="${m.match_no}">${scoreHTML(m)}</span></li>`).join('\n')}
</ul>
<p class="g-foot">${gTeams.map((t) => teamLink(t.name)).join(' · ')}</p>
</div>`;
  };
  // The rich per-group section (draw card + ESPN standings table + ledger) — qualification rails are
  // baked into standingsCard (.q top-two / .q3 third). Lives on the /standings/groups deep-dive.
  const groupSection = (g) => {
    const table = tables.get(g);
    return `<section id="group-${g}"><h2>${i18nSpan(S.attrs.groupFilter)} ${g}</h2><div class="groups2" data-group="${esc(g)}">${drawCard(g)}${table ? standingsCard(g, table, stAsOf) : ''}</div>${ledgerHTML(ledgerBy('group', g), `Group ${g} — old news`)}</section>`;
  };

  // ── Static knockout bracket (cert v3.09 redesign, the maintainer) — /standings is now the BRACKET page: a
  // readable, single-direction R32→Final reference (the ESPN/Fox pattern), distinct from the home page's
  // interactive zoom widget. Reuses the module-scoped sideHTML/scoreHTML/matchURL; live scores hydrate
  // through the certified data-match path (app.js, loaded by the shell). The 12 group TABLES move to the
  // /standings/groups deep-dive — no more byte-identical duplicate (resolves cert P2/#255 scope leak).
  const SB_ROUNDS = [['r32', S.stage.roundOf32], ['r16', S.stage.roundOf16], ['qf', S.stage.quarterFinals], ['sf', S.stage.semiFinals], ['final', S.stage.final], ['third', S.stage.thirdPlace]];
  const sbCard = (m) => `<a class="sbk-m" data-match-teams="${m.match_no}" href="${matchURL(m)}">
<div class="sbk-tm">${sideHTML(m.home, false, 'home')}</div>
<div class="sbk-tm">${sideHTML(m.away, false, 'away')}</div>
<div class="sbk-st" data-match="${m.match_no}">${scoreHTML(m)}</div></a>`;
  const sbCol = ([st, label]) => { const ms = matches.filter((m) => m.stage === st).sort((a, b) => a.match_no - b.match_no); return ms.length ? `<div class="sbk-col" data-round="${st}"><h3 class="sbk-h">${i18nSpan(label)}</h3>${ms.map(sbCard).join('')}</div>` : ''; };
  const staticBracket = SB_ROUNDS.some(([st]) => matches.some((m) => m.stage === st))
    ? `<div class="sbracket-wrap"><div class="sbracket">${SB_ROUNDS.map(sbCol).join('')}</div></div>`
    : `<p class="muted"${i18nBlock(S.pages.standings.emptyBracket)}>${S.pages.standings.emptyBracket}</p>`;

  // Third-place race — DERIVED from the ESPN standings via the shared renderer (rankThirds/thirdRaceTable
  // in render.mjs), so the bake first-paint and groups.js's live overlay are byte-identical. The 8 best of
  // 12 thirds reach the R32 (points → GD → GF; cut at 9th). data-third-body is groups.js's hydration target,
  // so it tracks the live /api/v1/standings exactly like the group tables beside it (no bake-time lag).
  const thirdRace = `<section class="third-race" aria-label="${S.attrs.thirdRace}"><h2>${i18nSpan(S.attrs.thirdRace)}</h2>
<p class="sub"${i18nBlock(S.pages.standings.thirdRaceSub)}>${S.pages.standings.thirdRaceSub}</p>
<div data-third-body>${thirdRaceTable(rankThirds(groups.map((g) => ({ group: g, rows: tables.get(g) }))))}</div></section>`;

  const toggle = (here) => `<nav class="sub-toggle" aria-label="${S.attrs.standingsViews}">${here === 'bracket' ? '<span class="on">Bracket</span>' : '<a href="/standings">Bracket</a>'}${here === 'groups' ? '<span class="on">Groups &amp; tables</span>' : '<a href="/standings/groups">Groups &amp; tables</a>'}</nav>`;

  // /standings = the BRACKET page (the readable static knockout view + a link to the group deep-dive).
  const body = `
<section class="hero small"><h1>${i18nSpan(S.pages.standings.h1Bracket)}</h1>
<p class="sub"${i18nBlock(S.pages.standings.bracketSub)}>${S.pages.standings.bracketSub}</p></section>
${toggle('bracket')}
${staticBracket}
<p class="muted"${i18nBlock(S.pages.standings.bracketFootnote)}>${S.pages.standings.bracketFootnote}</p>`;
  writeFileSync('dist/standings.html', page('Brackets', 'standings', body, { path: '/standings', live: true }));

  // /standings/groups = the GROUP deep-dive: the derived third-place race + the 12 qual-coloured ESPN
  // tables + fixtures (the home bracket's group cards deep-link here via #group-{g}). groups.js hydrates.
  const groupsBody = `
<section class="hero small"><h1>${i18nSpan(S.stage.groupStageLc)}</h1>
<p class="sub"${i18nBlock(S.pages.standings.groupsSub)}>${S.pages.standings.groupsSub}</p></section>
${toggle('groups')}
${thirdRace}
<h2 class="stage-band">${i18nSpan(S.stage.groupStageLc)}</h2>
${groups.map(groupSection).join('\n')}
<p class="muted"${i18nBlock(S.pages.standings.groupsFootnote)}>${S.pages.standings.groupsFootnote}</p>
<script type="module" src="/groups.js?v=${VER}"></script>`;
  mkdirSync('dist/standings', { recursive: true });
  writeFileSync('dist/standings/groups.html', page('Group stage', 'standings', groupsBody, { path: '/standings/groups', live: true }));
  // /groups → /standings: keep old links/bookmarks/SEO working after the rename.
  writeFileSync('dist/groups.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Standings — Golazo 26</title><link rel="canonical" href="/standings"><meta http-equiv="refresh" content="0; url=/standings"><meta name="robots" content="noindex"></head><body>${S.pages.standings.movedNote}</body></html>`);
}

// ---------- venues ----------
{
  const body = `
<h1>${i18nSpan(S.pages.venues.h1)}</h1>
<div class="cards">${venuesDoc.venues.map((v) => {
    const ms = matches.filter((m) => m.venue_id === v.id);
    return `<article class="match-card"><div class="teams"><strong>${esc(v.common_name)}</strong></div><div class="meta">FIFA name: ${esc(v.fifa_name)} · ${esc(v.locality)}${v.locality !== v.city ? ` (${esc(v.city)})` : ''}, ${v.country} · ${ms.length} matches</div><div class="chips">${ms.slice(0, 6).map((m) => `<a class="chip link" href="${matchURL(m)}">#${m.match_no}</a>`).join('')}${ms.length > 6 ? `<span class="chip">+${ms.length - 6}</span>` : ''}</div></article>`;
  }).join('\n')}</div>
<p class="muted"${i18nBlock(S.pages.venues.sourcesNote)}>${S.pages.venues.sourcesNote}</p>`;
  writeFileSync('dist/venues.html', page('Venues', 'teams', body));
}

// ---------- ICS calendar feed (subscribe .ics; the /calendar page was removed as a duplicate of /schedule — the maintainer 2026-06-23; the .ics feed stays, linked from /schedule + the footer) ----------
mkdirSync('dist/ics', { recursive: true });
const icsStamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
function icsFor(ms, name) {
  const ev = ms.map((m) => {
    const v = venues.get(m.venue_id);
    const dt = m.kickoff_utc.replace(/[-:]/g, '').replace('.000', '');
    const t1 = m.home.team ?? m.home.placeholder_text, t2 = m.away.team ?? m.away.placeholder_text;
    return `BEGIN:VEVENT\r\nUID:match-${m.match_no}@golazo26\r\nDTSTAMP:${icsStamp}\r\nDTSTART:${dt}\r\nDURATION:PT2H\r\nSUMMARY:${t1} vs ${t2}${m.stage === 'group' ? ` (Group ${m.group})` : ` (${STAGE[m.stage]})`}\r\nLOCATION:${v.common_name}\\, ${v.locality}\r\nDESCRIPTION:Match ${m.match_no} · how to watch: https://golazo26.onwike.workers.dev/matches/${m.match_no}\r\nEND:VEVENT`;
  }).join('\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Golazo 26//fan guide//EN\r\nX-WR-CALNAME:${name}\r\n${ev}\r\nEND:VCALENDAR\r\n`;
}
writeFileSync('dist/ics/all.ics', icsFor(matches, 'World Cup 2026 — all matches (Golazo 26)'));
for (const t of teamsData) {
  const ms = matches.filter((m) => m.home.team === t.name || m.away.team === t.name);
  writeFileSync(`dist/ics/${t.slug}.ics`, icsFor(ms, `${t.name} — World Cup 2026 (Golazo 26)`));
}
// ---------- watch + como-ver ----------
{
  const t = bcastDoc.totals;
  const body = `
<h1>${i18nSpan(S.pages.watch.h1)}</h1>
<section class="hero small"><p class="free-callout">📡 With a <strong>$20 TV antenna</strong>: <strong>${t.FOX} matches free on FOX</strong> (every match from the Round of 16 on, all USMNT group games) and <strong>${t.Telemundo} free in Spanish on Telemundo</strong>.</p></section>
<h2>English</h2>
<table class="watch">
<tr><th>FOX 📡</th><td><strong>${t.FOX} matches, free over the air.</strong> Also on all live-TV services. <a href="https://www.foxsports.com/soccer/fifa-world-cup/schedule" rel="noopener">Schedule</a></td></tr>
<tr><th>FS1</th><td>${t.FS1} matches — pay TV, or <strong>FOX One</strong> ($19.99/mo, 7-day free trial, all 104 in 4K — <a href="/sources#streaming">source</a>), or a live-TV service free trial (lengths vary)</td></tr>
<tr><th>Tubi (free)</th><td${i18nBlock(S.pages.watch.tubiRow)}>${S.pages.watch.tubiRow}</td></tr>
</table>
<h2>Español</h2>
<table class="watch">
<tr><th>Telemundo 📡</th><td><strong>${t.Telemundo} partidos gratis</strong> por aire; App de Telemundo gratis sin login junio 11–13</td></tr>
<tr><th>Universo</th><td>${t.Universo} partidos (TV de paga)</td></tr>
<tr><th>Peacock</th><td>Los 104 en español — Premium $10.99/mes</td></tr>
</table>
<h2 id="ca-mx">Canada &amp; Mexico</h2>
<table class="watch">
<tr><th>🇨🇦 Canada</th><td${i18nBlock(S.pages.watch.canadaRow)}>${S.pages.watch.canadaRow}</td></tr>
<tr><th>🇲🇽 México</th><td><strong>32 partidos gratis</strong> en TV abierta (Canal 5 / Las Estrellas y Azteca 7 / Azteca UNO); ViX transmite los 104 (Pase Mundial $999 MXN, acceso jun 11 – jul 19).</td></tr>
</table>
<p class="muted"${i18nBlock(S.pages.watch.footnote)}>${S.pages.watch.footnote}</p>`;
  writeFileSync('dist/watch.html', page('How to watch', 'watch', body, { path: '/watch' }));

  const es = `
<h1>Cómo ver todos los partidos (EE. UU.)</h1>
<section class="hero small"><p class="free-callout">📡 Con una <strong>antena de TV (~$20)</strong>: <strong>${t.Telemundo} partidos GRATIS en Telemundo</strong> en español, y ${t.FOX} gratis en inglés por FOX.</p></section>
<table class="watch">
<tr><th>Telemundo 📡</th><td><strong>${t.Telemundo} partidos gratis por aire</strong>, en español. Además, la App de Telemundo transmite gratis y sin registro los primeros tres días (junio 11–13).</td></tr>
<tr><th>Universo</th><td>${t.Universo} partidos por TV de paga (los cierres de grupo simultáneos, jun 24–27).</td></tr>
<tr><th>Peacock</th><td><strong>Los 104 partidos en español</strong> — Peacock Premium, $10.99/mes (<a href="/sources#streaming">fuente</a>).</td></tr>
<tr><th>FOX / FS1</th><td>En inglés: ${t.FOX} partidos gratis por aire en FOX; ${t.FS1} en FS1 (TV de paga o FOX One, $19.99/mes con prueba de 7 días, los 104 en 4K).</td></tr>
<tr><th>Tubi (gratis)</th><td>La inauguración México–Sudáfrica y EE. UU.–Paraguay, en vivo y en 4K, sin cuenta.</td></tr>
<tr><th>🇲🇽 En México</th><td><strong>32 partidos gratis en TV abierta</strong> (Canal 5 / Las Estrellas y Azteca 7 / Azteca UNO); ViX transmite los 104 (Pase Mundial $999 MXN).</td></tr>
</table>
<p class="muted">Cada dato tiene su fuente: <a href="/sources">/sources</a>. Los horarios de cada partido están en <a href="/schedule">el calendario</a> con hora local automática. <a href="/watch">English version →</a></p>`;
  writeFileSync('dist/como-ver.html', page('Cómo ver — en español', 'watch', es, { lang: 'es', desc: 'Cómo ver todos los partidos del Mundial 2026 gratis en EE. UU. — Telemundo, Peacock, antena.' }));
}

// ---------- people pages ----------
mkdirSync('dist/people', { recursive: true });
for (const [file, doc, title] of [['fifa', peopleFifa, 'FIFA administration'], ['us-soccer', peopleUssf, 'U.S. Soccer administration & USMNT staff']]) {
  const rows = doc.people.filter((p) => p.status === 'confirmed').map((p) => {
    const img = imgByName.get(`org_person:${p.name}`);
    const face = faceHTML(img, p.name);
    const attr = attrHTML(img);
    return `<tr><td class="player">${face} <strong>${esc(p.name)}</strong> ${attr}</td><td>${esc(p.role)}</td><td><a class="muted" href="${p.source_url}" rel="noopener">source</a></td></tr>`;
  }).join('\n');
  const tbd = doc.people.filter((p) => p.status !== 'confirmed');
  const body = `
<h1>${i18nSpan(title)}</h1>
<p class="muted">${S.pages.people.verifiedA} ${doc.verified_at} ${S.pages.people.verifiedB}</p>
<div class="tablewrap"><table class="sched"><thead><tr><th>Name</th><th>Role</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>
${tbd.length ? `<p class="muted">Honestly unresolved: ${tbd.map((p) => `${esc(p.role)} — ${S.pages.people.unresolvedSuffix}`).join('; ')}.</p>` : ''}
<p class="muted"${i18nBlock(S.pages.people.editorialNote)}>${S.pages.people.editorialNote}</p>`;
  writeFileSync(`dist/people/${file}.html`, page(title, 'teams', body));
}

// ---------- humans leaderboard ----------
if (lbDoc) {
  const totalPts = lbDoc.entries.reduce((a, e) => a + e.pts, 0);
  const anyScored = lbDoc.entries.some((e) => e.scored > 0);
  const body = `
<h1>Predictions leaderboard</h1>
<p${i18nBlock(S.pages.leaderboard.intro)}>${S.pages.leaderboard.intro}</p>
${lbDoc.entries.length === 0 ? `<p class="muted"${i18nBlock(S.pages.leaderboard.empty)}>${S.pages.leaderboard.empty}</p>` : `
<table class="watch">
<tr><th>#</th><th>Predictor</th><th>Bets</th><th>Scored</th><th>Exact (3 pts)</th><th>Outcome (1 pt)</th><th>Points</th></tr>
${lbDoc.entries.map((e, i) => `<tr><th>${i + 1}</th><td>${esc(e.name)}</td><td>${e.bets}</td><td>${e.scored}</td><td>${e.exact}</td><td>${e.outcome}</td><td><strong>${e.pts}</strong></td></tr>`).join('\n')}
</table>
${!anyScored ? `<p class="muted">${lbDoc.entries.length} predictor${lbDoc.entries.length === 1 ? '' : 's'} in — points appear once the first match reaches a confirmed final score${totalPts === 0 ? '' : ''}.</p>` : ''}`}
<h2>How the machines are doing</h2>
<p${i18nBlock(S.pages.leaderboard.machines)}>${S.pages.leaderboard.machines}</p>
<p class="muted footnote"><span${i18nBlock(S.pages.leaderboard.footnoteA)}>${S.pages.leaderboard.footnoteA}</span> <code${utcAttr(lbDoc.as_of)}>${esc(lbDoc.as_of ?? '')}</code> · <a href="/about">privacy</a></p>`;
  writeFileSync('dist/leaderboard.html', page('Leaderboard', 'lb', body, { path: '/leaderboard', desc: S.pages.leaderboard.desc }));
}

// ---------- AI prediction league (v3 shell + live overlay) ----------
// Always baked (even before the first recompute): first paint from data/ai-league.json via the
// shared renderer, then site/ai-league.js hydrates the live league from /api/v1/ai-league with the
// SAME renderer (one renderer, two runtimes). The slots ([data-ai-*]) are what the overlay refreshes.
{
  const body = `
<h1>${i18nSpan(S.pages.aiLeague.h1)}</h1>
<p>Four frontier AI models — <strong>${aiLogo('claude')}&nbsp;Claude&nbsp;Opus&nbsp;4.8</strong>, <strong>${aiLogo('gpt')}&nbsp;ChatGPT</strong>, <strong>${aiLogo('gemini')}&nbsp;Gemini&nbsp;3&nbsp;Pro</strong>, and <strong>${aiLogo('grok')}&nbsp;Grok&nbsp;4</strong> — run their own bragging-rights league. Each predicts the full-time score, the goalscorers, and the key players of the next match, and defends the call in a paragraph — then <strong>re-bets</strong> as results come in. No real money, no odds, no betting links. Picks lock at kickoff and are timestamped before it.</p>
<h2>${i18nSpan(S.pages.aiLeague.standings)}</h2>
<div data-ai-standings>${aiDoc ? aiStandings(aiDoc) : `<p class="muted">${i18nSpan(S.pages.aiLeague.loadingLeague)}</p>`}</div>
<p class="muted"${i18nBlock(S.pages.aiLeague.scoringNote)}>${S.pages.aiLeague.scoringNote}</p>
<section class="ai-bartalk"><h2>Bar Talk</h2>
<p class="muted" style="margin-top:-.3rem"${i18nBlock(S.pages.aiLeague.barTalkSub)}>${S.pages.aiLeague.barTalkSub}</p>
${barTalkTeaser(null)}</section>
<h2>${i18nSpan(S.pages.aiLeague.nextMatch)}</h2>
<div data-ai-featured>${aiDoc ? aiFeatured(aiDoc) : ''}</div>
<h2>${i18nSpan(S.pages.aiLeague.everyPick)} <span class="muted" style="font-weight:400">${i18nSpan(S.pages.aiLeague.inDepthNote)}</span></h2>
<div data-ai-everypick>${aiDoc ? aiEveryPick(aiDoc) : ''}</div>
<p class="muted footnote"><span${i18nBlock(S.pages.aiLeague.footnoteA)}>${S.pages.aiLeague.footnoteA}</span> <code data-ai-asof${utcAttr(aiDoc?.as_of)}>${esc(aiDoc?.as_of ?? '')}</code> · raw data: <a href="/data/ai.json">/data/ai.json</a> · <a href="/sources">sources &amp; integrity</a></p>
<script type="module" src="/ai-league.js?v=${VER}"></script>
<script type="module" src="/bartalk-teaser.js?v=${VER}"></script>`;
  writeFileSync('dist/ai-league.html', page('AI prediction league', 'ai', body, { path: '/ai-league', desc: S.pages.aiLeague.desc }));
}

// ---------- Bar Talk hub — redesign (feat/bartalk-redesign) ----------
// Two-column layout: left guide rail + right episode reading column.
// __BT_TEAMS__ baked in so the client can resolve team names → slugs → flag sprite.
{
  // name→slug lookup for all 48 teams (used client-side for flag-clash SVGs)
  const btTeams = JSON.stringify(Object.fromEntries(teamsData.map((t) => [t.name, t.slug])));

  const regulars = ['grok','claude','gemini','gpt'].map((p) => {
    const name = { grok:'Grok', claude:'Claude', gemini:'Gemini', gpt:'ChatGPT' }[p];
    return `<div class="bt-regular">
      <div class="bt-regular-avatar">
        <img src="/personas/${p}.webp" width="56" height="56" alt="${name}" loading="lazy" decoding="async">
      </div>
      <span class="bt-regular-name">${name}</span>
    </div>`;
  }).join('');

  const stageFilters = [
    ['all', S.stage.all], ['group', S.stage.groupStage], ['r16', S.stage.roundOf16], ['qf-sf', S.stage.qfSf], ['final', S.stage.final],
  ].map(([v, label], i) =>
    `<button type="button" class="bt-filter-btn${i === 0 ? ' is-active' : ''}" data-bt-stage="${v}">${i18nSpan(label)}</button>`
  ).join('');

  const body = `
<div class="bt-b6">
  <p class="bt-b6-label">${i18nSpan(S.pages.barTalk.eyebrow)}</p>
  <h1 class="bt-b6-headline">Bar Talk</h1>
  <p class="bt-b6-sub"${i18nBlock(S.pages.barTalk.heroSub)}>${S.pages.barTalk.heroSub}</p>
</div>
<div class="bt-regulars">${regulars}</div>
<nav class="bt-filter" data-bt-filter aria-label="${S.attrs.filterByStage}">${stageFilters}</nav>
<div class="bt-layout">
  <div class="bt-guide" data-bt-guide>
    <p class="bt-guide-head">${i18nSpan(S.pages.barTalk.episodes)}</p>
    <div class="bt-guide-list" data-bt-list><p class="muted" style="padding:.75rem">${i18nSpan(S.pages.barTalk.loadingEpisodes)}</p></div>
  </div>
  <div class="bt-reading" data-bt-reading>
    <p class="bt-reading-empty"${i18nBlock(S.pages.barTalk.readingEmpty)}>${S.pages.barTalk.readingEmpty}</p>
  </div>
</div>
<p class="muted footnote" style="margin-top:1rem"${i18nBlock(S.pages.barTalk.hubFootnote)}>${S.pages.barTalk.hubFootnote}</p>
<script>window.__BT_TEAMS__=${btTeams};</script>
<script type="module" src="/bartalk.js?v=${VER}"></script>`;
  writeFileSync('dist/bar-talk.html', page('Bar Talk', 'bartalk', body, { path: '/bar-talk', desc: S.pages.barTalk.desc }));
}

// ---------- sources + about + 404 ----------
{
  const open = discrepancies.open ?? [];
  const resolved = discrepancies.resolved ?? [];
  const body = `
<h1>${i18nSpan(S.pages.sources.h1)}</h1>
<p${i18nBlock(S.pages.sources.intro)}>${S.pages.sources.intro}</p>
<h2 id="streaming">${i18nSpan(S.pages.sources.streamingPrices)}</h2>
<ul>
<li${i18nBlock(S.pages.sources.foxOne)}>${S.pages.sources.foxOne}</li>
<li${i18nBlock(S.pages.sources.peacock)}>${S.pages.sources.peacock}</li>
<li${i18nBlock(S.pages.sources.tubi)}>${S.pages.sources.tubi}</li>
<li${i18nBlock(S.pages.sources.trialNote)}>${S.pages.sources.trialNote}</li>
</ul>
<h2>${i18nSpan(S.pages.sources.sourcesOfRecord)}</h2>
<table class="watch">
<tr><th>Schedule</th><td${i18nBlock(S.pages.sources.scheduleRow)}>${S.pages.sources.scheduleRow}</td></tr>
<tr><th>Rosters</th><td>${S.pages.sources.rostersA} <a href="${rosters.source.permalink}" rel="noopener">${S.pages.sources.rostersPinned} ${rosters.source.revid}</a> ${S.pages.sources.rostersB}</td></tr>
<tr><th>US TV</th><td${i18nBlock(S.pages.sources.usTvRow)}>${S.pages.sources.usTvRow}</td></tr>
<tr><th>Photos</th><td${i18nBlock(S.pages.sources.photosRow)}>${S.pages.sources.photosRow}</td></tr>
</table>
<h2 id="discrepancies">${i18nSpan(S.pages.sources.documentedDiscrepancies)}</h2>
<p class="muted"${i18nBlock(S.pages.sources.discrepanciesNote)}>${S.pages.sources.discrepanciesNote}</p>
<ul>
${resolved.map((d) => `<li><strong>Match ${d.match_no} kickoff</strong>: ${esc(d.note)} — resolved ${d.rule} (<a href="${d.tiebreaker_url}" rel="noopener">tiebreaker</a>)</li>`).join('\n')}
${open.map((d) => `<li><strong>${esc(d.id)}</strong> (${d.severity}): ${esc(d.value_a)} vs ${esc(d.value_b)}. ${esc(d.resolution)}</li>`).join('\n')}
</ul>
<p class="muted"${i18nBlock(S.pages.sources.tbdNote)}>${S.pages.sources.tbdNote}</p>`;
  writeFileSync('dist/sources.html', page('Sources', 'watch', body));

  // about blocks come from the shared unit source (lib/i18n-blocks.mjs) so the corpus
  // extractor serializes byte-identical English (a later change round-trip contract).
  const AB = aboutBlocks(clerkPub);
  const about = `
<h1>${i18nSpan(S.pages.about.h1)}</h1>
<p${i18nBlock(AB.intro)}>${AB.intro}</p>
<ul>
${AB.bullets.map((b) => `<li${i18nBlock(b)}>${b}</li>`).join('\n')}
</ul>
<p class="muted"${i18nBlock(AB.contact)}>${AB.contact}</p>`;
  writeFileSync('dist/about.html', page('About', 'watch', about));

  // /privacy — dedicated privacy policy (cert A5): names the controller + processors, legal basis,
  // retention, and DSAR/CCPA deletion. Honest about whether predictions (hence accounts) are live.
  const privacy = `
<h1>${i18nSpan(S.pages.privacy.h1)}</h1>
<p class="muted"${utcAttr(AS_OF_ISO)}>${S.pages.privacy.lastUpdated} ${esc(AS_OF)}. <span${i18nBlock(S.pages.privacy.project)}>${S.pages.privacy.project}</span></p>
<h2>${i18nSpan(S.pages.privacy.whoRunsHeading)}</h2>
<p${i18nBlock(S.pages.privacy.whoRuns)}>${S.pages.privacy.whoRuns}</p>
<h2>${i18nSpan(S.pages.privacy.whatWeCollect)}</h2>
${clerkPub ? S.pages.privacy.collectAccounts : S.pages.privacy.collectNoAccounts}
<h2>${i18nSpan(S.pages.privacy.processors)}</h2>
<ul>
<li>${S.pages.privacy.cloudflareA} ${clerkPub ? S.pages.privacy.cloudflareDataAccounts : S.pages.privacy.cloudflareDataNoAccounts}${S.pages.privacy.cloudflareB}</li>
${clerkPub ? `<li${i18nBlock(S.pages.privacy.clerk)}>${S.pages.privacy.clerk}</li>` : ''}
</ul>
<h2>${i18nSpan(S.pages.privacy.legalBasis)}</h2>
${clerkPub ? S.pages.privacy.basisAccounts : S.pages.privacy.basisNoAccounts}
<h2>${i18nSpan(S.pages.privacy.yourRights)}</h2>
<p>${S.pages.privacy.rightsA}${clerkPub ? S.pages.privacy.rightsDelete : ''} ${S.pages.privacy.rightsB}</p>
<h2>${i18nSpan(S.pages.privacy.photosHeading)}</h2>
<p${i18nBlock(S.pages.privacy.photos)}>${S.pages.privacy.photos}</p>`;
  writeFileSync('dist/privacy.html', page('Privacy', 'watch', privacy, { path: '/privacy', desc: S.pages.privacy.desc }));

  // /ops-hub — the support-enablement layer (onboarding, incident playbooks, quick cards, release→
  // training, content-library index), rebuilt from the runbook/deploy-guide/release process so it
  // never drifts from how the site is actually run. Ops/behind-the-scenes, not a fan feature.
  // Omitted under G26_PUBLIC: the module is loaded here, on the private path only, so the public
  // export never resolves a module that its own tree does not carry.
  if (!PUBLIC) {
    const { opsHubBody } = await import('./lib/ops-hub.mjs');
    mkdirSync('dist/ops-hub', { recursive: true });
    writeFileSync('dist/ops-hub/index.html', page('Ops Hub — support enablement', 'ops', opsHubBody(), { path: '/ops-hub', desc: S.pages.opsHub.desc }));
  }

  writeFileSync('dist/robots.txt', DEV ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n');

  // ---------- History Hub (v2.08.00): /history timeline + 22 edition pages ----------
  if (historyOK) {
    // era framing (HISTORY_ERAS), edition docs and the swap-unit prose HTML all come from the
    // shared unit source (lib/i18n-blocks.mjs) so the corpus extractor serializes byte-identical
    // English for every stamped block (a later change round-trip contract).
    const HB = historyBlocks();
    const years = HB.years;
    const editions = HB.docs;
    const dash = '—';
    const champLine = (f) => `${f.champion}${f.runner_up ? ` <span class="tscore">${f.final_score ? `${f.final_score} v ${f.runner_up}` : `v ${f.runner_up}`}</span>` : ''}`;

    // hub timeline
    const tnode = (y) => {
      const f = historyFacts.get(y) ?? {};
      return `<a class="tnode" href="/history/${y}">
<span class="ty">${y}</span><span class="th">${esc(f.host ?? '')}</span>
<span class="tchamp"><span class="crown" aria-hidden="true">★</span> ${champLine(f)}</span>
<span class="arrow" aria-hidden="true">→</span></a>`;
    };
    const timeline = HISTORY_ERAS.map(([label, ys]) =>
      `<div class="era"><b>${esc(label)}</b></div>\n${ys.map(tnode).join('\n')}`).join('\n');
    const hubBody = `
<section class="hubhero">
  <p class="kicker"><b>1930 ${dash} 2022</b> · 22 ${i18nSpan(S.pages.history.kickerTail)}</p>
  <h1>${i18nSpan(S.pages.history.h1)}</h1>
  <p class="sub"${i18nBlock(S.pages.history.heroSub)}>${S.pages.history.heroSub}</p>
</section>
<section class="prose" style="max-width:720px;margin:.5rem auto 0"${i18nBlock(HB.hubProse)}>${HB.hubProse}</section>
<nav class="tl" aria-label="${S.attrs.editionsNav}">
${timeline}
</nav>
<p class="muted" style="text-align:center;max-width:680px;margin:1.4rem auto 0"${i18nBlock(S.pages.history.hubFootnote)}>${S.pages.history.hubFootnote}</p>`;
    mkdirSync('dist/history', { recursive: true });
    writeFileSync('dist/history.html', page('History of the World Cup', 'history', hubBody, {
      desc: S.pages.history.hubDesc,
      path: '/history',
    }));

    // edition pages
    const fcell = (k, v) => v ? `<div class="fcell"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>` : '';
    for (let i = 0; i < years.length; i++) {
      const y = years[i];
      const ed = editions.get(y);
      const proseHtml = HB.editionProse.get(y); // shared swap-unit HTML (corpus byte-identity)
      const f = historyFacts.get(y) ?? {};
      const prev = years[i - 1];
      const next = years[i + 1];
      const rail = [
        fcell('Host', f.host),
        fcell('Champion', f.champion),
        fcell('Runner-up', f.runner_up),
        fcell('Final score', f.final_score),
        fcell('Third place', f.third),
        fcell('Top scorer', f.top_scorer),
        fcell('Best player', f.best_player),
      ].filter(Boolean).join('');
      const srcs = (ed.sources ?? []).map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title ?? s.url)}</a></li>`).join('');
      const body = `
<section class="hubhero" style="padding-bottom:.3rem">
  <p class="kicker"><a href="/history" style="color:var(--muted)">${i18nSpan(S.pages.history.allEditions)}</a></p>
  <h1>${esc(ed.title)}</h1>
</section>
${f.champion ? `<div class="fin"><span class="champ"><span class="crown" aria-hidden="true">★</span> ${esc(f.champion)}</span>${f.runner_up ? `<span class="vsline">${f.final_score ? `${esc(f.final_score)} ` : ''}def. ${esc(f.runner_up)}</span>` : ''}</div>` : ''}
<div class="frail">${rail}</div>
<section class="prose" style="max-width:720px"${i18nBlock(proseHtml)}>${proseHtml}</section>
<nav class="editnav" aria-label="${S.attrs.adjacentEditions}">
  ${prev ? `<a href="/history/${prev}">← ${prev}</a>` : '<span></span>'}
  ${next ? `<a href="/history/${next}">${next} →</a>` : '<span></span>'}
</nav>
<section class="prose" style="max-width:720px"><h2>${i18nSpan(S.pages.sources.heading)}</h2><ul>${srcs}</ul>
<p class="muted footnote"><span${i18nBlock(S.footnotes.historyEdition)}>${S.footnotes.historyEdition}</span> <a href="mailto:onwike@gmail.com?subject=Golazo26%20history%20correction:%20${y}">${S.footnotes.reportError}</a>.</p></section>`;
      writeFileSync(`dist/history/${y}.html`, page(`${ed.title}`, 'history', body, {
        desc: `${ed.title}: ${f.champion ? `${f.champion} champions${f.host ? `, hosted by ${f.host}` : ''}.` : 'World Cup edition.'} The full story, with sources.`,
        path: `/history/${y}`,
      }));
    }
    console.log(`history hub: 1 timeline + ${years.length} edition pages`);
  }

  // ---------- Stadiums hub: /stadiums + 16 city/stadium pages ----------
  if (stadiumsOK) {
    // rail, facts sheets, prose docs and the city/stadium/hub swap-unit HTML all come from
    // the shared unit source (lib/i18n-blocks.mjs) so the corpus extractor serializes
    // byte-identical English for every stamped block (a later change round-trip contract).
    const SB = stadiumsBlocks();
    const num = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-US'));
    const railRows = SB.rail.venues;

    // hub: the 16 venues grouped by host nation
    const GROUPS = [['United States', '🇺🇸'], ['Mexico', '🇲🇽'], ['Canada', '🇨🇦']];
    const snode = (r) => `<a class="tnode" href="/stadiums/${r.venue_id}">
<span class="ty">${esc(r.stadium_current)}</span><span class="th">${esc(r.city)}</span>
<span class="tchamp">${esc(r.fifa_name)}${r.capacity_wc2026 ? ` <span class="tscore">${num(r.capacity_wc2026)} cap · ${r.wc_matches_2026 ?? '—'} matches</span>` : ''}</span>
<span class="arrow" aria-hidden="true">→</span></a>`;
    const grouped = GROUPS.map(([country, flag]) => {
      const rows = railRows.filter((r) => r.country === country);
      return rows.length ? `<div class="era"><b>${flag} ${esc(country)} · ${rows.length}</b></div>\n${rows.map(snode).join('\n')}` : '';
    }).filter(Boolean).join('\n');
    const hubBody = `
<section class="hubhero">
  <p class="kicker"><b>16 ${i18nSpan(S.pages.stadiums.cities)}</b> · 16 ${i18nSpan(S.pages.stadiums.stadiumsWord)} · 3 ${i18nSpan(S.pages.stadiums.nations)}</p>
  <h1>${i18nSpan(S.pages.stadiums.h1)}</h1>
  <p class="sub"${i18nBlock(S.pages.stadiums.heroSub)}>${S.pages.stadiums.heroSub}</p>
</section>
${SB.hubProse ? `<section class="prose" style="max-width:720px;margin:.5rem auto 0"${i18nBlock(SB.hubProse)}>${SB.hubProse}</section>` : ''}
<nav class="tl" aria-label="${S.attrs.hostCitiesNav}">
${grouped}
</nav>
<p class="muted" style="text-align:center;max-width:680px;margin:1.4rem auto 0"${i18nBlock(S.pages.stadiums.hubFootnote)}>${S.pages.stadiums.hubFootnote}</p>`;
    mkdirSync('dist/stadiums', { recursive: true });
    writeFileSync('dist/stadiums.html', page('Stadiums of the 2026 World Cup', 'stadiums', hubBody, {
      desc: S.pages.stadiums.hubDesc,
      path: '/stadiums',
    }));

    // detail: city history -> stadium history -> iconic games -> renovations -> sources (each individually sourced)
    const fcell = (k, v) => v ? `<div class="fcell"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>` : '';
    const srcList = (arr) => (arr ?? []).map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title ?? s.url)}</a></li>`).join('');
    for (const r of railRows) {
      const id = r.venue_id;
      const cf = SB.sheets.get(id);
      const pr = SB.proseDocs.get(id);
      const editions = Array.isArray(r.wc_editions_hosted) ? r.wc_editions_hosted.join(', ') : '';
      const rail = [
        fcell('FIFA name', r.fifa_name),
        fcell('City', `${r.city}${r.country ? `, ${r.country}` : ''}`),
        fcell('Opened', r.opened),
        fcell('Capacity (World Cup)', num(r.capacity_wc2026)),
        fcell('Capacity (regular)', num(r.capacity_regular)),
        fcell('World Cup matches', r.wc_matches_2026),
        fcell('WC editions hosted', editions),
        fcell('Primary tenant', r.primary_tenant),
        fcell('Architect', r.architect),
      ].filter(Boolean).join('');
      const cityHTML = SB.cityHTML.get(id); // shared swap-unit HTML (corpus byte-identity)
      const stadHTML = SB.stadHTML.get(id);
      const games = pr?.iconic_games ?? cf.iconic_games ?? [];
      const gamesHTML = games.length
        ? `<ul class="iconic">${games.map((g) => `<li><b>${esc(g.match)}${g.score ? ` (${esc(g.score)})` : ''}</b> — ${esc(g.event)}${g.date ? ` · ${esc(g.date)}` : ''}${g.note ? `<br><span class="muted">${esc(g.note)}</span>` : ''}</li>`).join('')}</ul>`
        : `<p class="muted">${esc((pr?.iconic_games_note ?? cf.iconic_games_note) || S.pages.stadiums.iconicEmpty)}</p>`;
      const renos = pr?.renovations ?? cf.renovations ?? [];
      const renoHTML = renos.length
        ? `<ul class="renos">${renos.map((v) => `<li><b>${esc(v.category)}.</b> ${esc(v.change)}${v.value ? `<br><span class="muted">${esc(v.value)}</span>` : ''}</li>`).join('')}</ul>`
        : `<p class="muted"${i18nBlock(S.pages.stadiums.renoEmpty)}>${S.pages.stadiums.renoEmpty}</p>`;
      const gaps = Array.isArray(cf.gaps) ? cf.gaps : [];
      const gapsHTML = gaps.length
        ? `<section class="prose" style="max-width:720px"><details class="gaps"><summary class="muted">${S.pages.stadiums.gapsSummary} (${gaps.length})</summary><ul>${gaps.map((g) => `<li class="muted">${esc(g)}</li>`).join('')}</ul></details></section>`
        : '';
      const sources = cf.sources ?? pr?.sources ?? [];
      const asOf = r.as_of ?? SB.rail.as_of ?? cf._as_of ?? '';
      const pitch = r.field_type_2026 && !/NOT SPECIFIED/i.test(r.field_type_2026)
        ? `<p><b>Pitch (2026).</b> ${esc(String(r.field_type_2026).split(/\s*NOTE:/)[0].trim())}</p>` : '';
      // Image gallery — guarded on im.file (the R2 local path), so it renders '' (no section, no broken
      // images, no CSP issue) until the R2-mirror rewrites the manifest to local paths.
      const gv = stadiumsGallery.get(id);
      const galX = gv ? (gv.gallery || []).filter((im) => im && im.file) : [];
      const galHero = gv && gv.hero && gv.hero.file ? gv.hero : null;
      const photos = galleryHTML(galHero, galX, r.stadium_current);
      const body = `
<section class="hubhero" style="padding-bottom:.3rem">
  <p class="kicker"><a href="/stadiums" style="color:var(--muted)">${i18nSpan(S.pages.stadiums.allStadiums)}</a></p>
  <h1>${esc(r.stadium_current)}</h1>
  <p class="sub">${r.stadium_historic ? `${i18nSpan(S.pages.stadiums.formerly)} ${esc(r.stadium_historic)} · ` : ''}FIFA: ${esc(r.fifa_name)} · ${esc(r.city)}${r.country ? `, ${esc(r.country)}` : ''}</p>
</section>
<div class="frail">${rail}</div>
${photos ? `<section class="prose" style="max-width:720px"><h2>${i18nSpan(S.pages.stadiums.photos)}</h2>${photos}</section>` : ''}
${cityHTML ? `<section class="prose" style="max-width:720px"><h2>${esc(r.city)}</h2><div${i18nBlock(cityHTML)}>${cityHTML}</div></section>` : ''}
${stadHTML ? `<section class="prose" style="max-width:720px"><h2>${i18nSpan(S.pages.stadiums.theStadium)}</h2><div${i18nBlock(stadHTML)}>${stadHTML}</div></section>` : ''}
<section class="prose" style="max-width:720px"><h2>${i18nSpan(S.pages.stadiums.iconicGames)}</h2>${gamesHTML}</section>
<section class="prose" style="max-width:720px"><h2>${i18nSpan(S.pages.stadiums.renovations)}</h2>${renoHTML}${pitch}</section>
${gapsHTML}
<section class="prose" style="max-width:720px"><h2>${i18nSpan(S.pages.sources.heading)}</h2><ul>${srcList(sources)}</ul>
<p class="muted footnote"><span${i18nBlock(S.footnotes.stadiumsA)}>${S.footnotes.stadiumsA}</span> ${esc(asOf)}<span${i18nBlock(S.footnotes.stadiumsB)}>${S.footnotes.stadiumsB}</span> <a href="mailto:onwike@gmail.com?subject=Golazo26%20stadium%20correction:%20${encodeURIComponent(id)}">${S.footnotes.reportError}</a>.</p></section>`;
      writeFileSync(`dist/stadiums/${id}.html`, page(`${r.stadium_current} — ${r.city}`, 'stadiums', body, {
        desc: `${r.stadium_current} (${r.fifa_name}), ${r.city}: history, iconic games and World Cup 2026 renovations, with sources.`,
        path: `/stadiums/${id}`,
      }));
    }
    console.log(`stadiums hub: 1 hub + ${railRows.length} city/stadium pages`);
  }

  writeFileSync('dist/404.html', page('Not found', 'home', `<svg class="doodle" width="96" height="96" aria-hidden="true"><use href="/brand/doodles.svg#d-ball"/></svg><h1${i18nBlock(S.pages.notFound.title)}>${S.pages.notFound.title}</h1><p${i18nBlock(S.pages.notFound.body)}>${S.pages.notFound.body}</p>`, { path: '/404' }));
}

// ---------- Phase 2.5B: profile pages ----------
function proseFooter(p) {
  const spine = p.sheet.spine_source ?? { revid: rosters.source.revid, permalink: rosters.source.permalink };
  const asOf = (p.sheet.fetched_at ?? '').slice(0, 10);
  return `<p class="muted footnote"><strong>${S.footnotes.profile.factsAsOf} ${esc(asOf)}</strong> ${S.footnotes.profile.adaptedUnder}${p.meta?.cert ? ` (${esc(p.meta.cert)})` : ''}. ${S.footnotes.profile.careerNarrative} <a href="${p.sheet.permalink}" rel="noopener">${S.footnotes.profile.wikipediaPinned} ${p.sheet.revid}</a>. ${S.footnotes.profile.squadStats} <a href="${spine.permalink}" rel="noopener">${S.footnotes.profile.squadsPinned} ${spine.revid}</a> ${S.footnotes.profile.auditedData} <code>${p.sheet.fact_sheet_hash}</code>. <a href="mailto:onwike@gmail.com?subject=Golazo26%20correction:%20${encodeURIComponent(p.name)}">${S.footnotes.reportError}</a>.</p>`;
}
if (profiles.size) {
  mkdirSync('dist/players', { recursive: true });
  for (const p of profiles.values()) {
    const subjType = p.kind === 'player' ? 'player' : p.kind === 'coach' ? 'coach' : 'org_person';
    const img = imgByName.get(`${subjType}:${p.name}`);
    const roster = rosterByTeam.get(p.team);
    const pl = roster?.players.find((x) => x.name === p.name);
    const teamMeta = teams.get(p.team);
    const statLine = p.kind === 'player' && pl
      ? `${teamMeta?.flag ?? ''} <a class="team" href="/teams/${teamMeta?.slug}">${esc(p.team)}</a> · #${pl.no} · ${pl.pos}${pl.captain ? ' · captain' : ''} · ${pl.caps} caps, ${pl.goals} goals · ${esc(pl.club)}`
      : p.kind === 'coach' ? `Head coach · ${teamMeta?.flag ?? ''} <a class="team" href="/teams/${teamMeta?.slug}">${esc(p.team)}</a>`
      : `${esc(p.team)}`;
    const body = `
<p class="crumb"><a href="${p.kind === 'coach' || p.kind === 'player' ? `/teams/${teamMeta?.slug}` : '/people/fifa'}">← ${esc(p.kind === 'official' ? 'People' : p.team)}</a></p>
<div class="profile" data-profile-slug="${esc(p.slug)}" data-i18n-pack="${p.pack}">
<h1 class="matchup">${faceHTML(img, p.name, 56)} ${esc(p.name)}</h1>
<p class="meta">${statLine}</p>
${galleryHTML(img, galleryByName.get(`${subjType}:${p.name}`), p.name)}
<section class="prose">${profileParagraphs(p.text).map((h) => `<p${i18nBlock(h)}>${h}</p>`).join('')}</section>
${proseFooter(p)}
</div>
<script type="module" src="/profile.js?v=${VER}"></script>`;
    const dir = p.kind === 'player' ? 'players' : 'people';
    writeFileSync(`dist/${dir}/${p.slug}.html`, page(`${p.name} — profile`, 'teams', body, { desc: `${p.name}: verified profile for the 2026 World Cup.` }));
  }
}

// ---------- data endpoints ----------
mkdirSync('dist/data', { recursive: true });
writeFileSync('dist/data/matches.json', JSON.stringify({ as_of: AS_OF, matches: matches.map((m) => ({ n: m.match_no, stage: m.stage, group: m.group, kickoff_utc: m.kickoff_utc, venue: venues.get(m.venue_id).common_name, home: m.home.team ?? m.home.placeholder_text, away: m.away.team ?? m.away.placeholder_text, us_tv: bcast.get(m.match_no) ? `${bcast.get(m.match_no).us_english}/${bcast.get(m.match_no).us_spanish}` : 'TBD' })) }));
writeFileSync('dist/data/live.json', JSON.stringify({ as_of: new Date().toISOString(), matches: matches.map((m) => { const lv = liveByN.get(m.match_no); return { n: m.match_no, status: m.status, score: m.score, k: m.kickoff_utc, ...(lv?.dc ? { dc: lv.dc } : {}) }; }), ai_n: aiDoc?.matches?.length ?? 0, lb_sig: liveState?.lb_sig ?? '', st_sig: liveState?.st_sig ?? '' }));
if (aiDoc) writeFileSync('dist/data/ai.json', JSON.stringify(aiDoc));
// R10 kill-switch (owner 2026-07-18): knockoutRoom3d gates the 3D Knockout Room toggle at runtime.
// Default TRUE (feature enabled); flipping it to false in this same-origin config (e.g. via the
// ops-flags bake, or by hand) disables the toggle for everyone WITHOUT a site redeploy — site/
// knockout-room.js reads flags.knockoutRoom3d and, when false, never injects the toggle or loads three.
writeFileSync('dist/data/config.json', JSON.stringify({ as_of: new Date().toISOString(), flags: { api_read_only: false, ai_halted: false, bake_paused: false, knockoutRoom3d: true }, version: 'v1' }));
// Goal-celebration context (goal-celebration.js, site-wide overlay): n -> [home, away] for resolved
// matches, team -> [3-letter, chip colour], and the still-alive set (everyone minus knockout losers).
{
  const koStages = new Set(['r32', 'r16', 'qf', 'sf', 'final', 'third']);
  const eliminated = new Set();
  for (const m of matches) {
    if (!koStages.has(m.stage) || !m.score || !m.home.team || !m.away.team) continue;
    if (m.status === 'finished_confirmed' || m.status === 'finished_provisional') {
      const loser = m.score.home < m.score.away ? m.home.team : m.score.away < m.score.home ? m.away.team : null;
      if (loser) eliminated.add(loser);
    }
  }
  writeFileSync('dist/data/goal-context.json', JSON.stringify({
    m: Object.fromEntries(matches.filter((m) => m.home.team && m.away.team).map((m) => [m.match_no, [m.home.team, m.away.team]])),
    t: Object.fromEntries(teamsData.map((t) => [t.name, [fifaOf(t.name) || t.name.slice(0, 3).toUpperCase(), (confettiColors(t.name) || ['#888'])[0] || '#888']])),
    alive: teamsData.map((t) => t.name).filter((n) => !eliminated.has(n)),
  }));
}

// v3 Phase 3 PROTOTYPE (additive, unlinked): the schedule page rendered client-side from
// the data API + a static render context — proves the static-shell + shared-renderer loop
// with NO rebuild. render.mjs ships as a browser module; the context is the (static) lookup
// maps + match base; the live status/score overlay comes from /api/v1/live (site/schedule-spa.js).
cpSync('scripts/lib/render.mjs', 'dist/render.mjs');
cpSync('scripts/lib/ai-league-render.mjs', 'dist/ai-league-render.mjs'); // v3: shared AI-league renderer (site/ai-league.js imports it)
cpSync('scripts/lib/commentary-view.mjs', 'dist/commentary-view.mjs'); // v3.04.02: blow-by-blow row renderer (site/match.js imports it)
cpSync('scripts/lib/watch-view.mjs', 'dist/watch-view.mjs'); // AI Watch-Along row renderer (site/match.js imports it)
cpSync('scripts/lib/timeline-view.mjs', 'dist/timeline-view.mjs'); // match-page timeline/key-moments renderers (baked now; Phase 2's live hydrator imports it)
cpSync('scripts/lib/stats-view.mjs', 'dist/stats-view.mjs'); // match-page stats comparison-bar row renderer (Phase 2.5; site/match.js imports it)
cpSync('site/schedule-spa.js', 'dist/schedule-spa.js');
cpSync('site/today.js', 'dist/today.js'); // v3: client-side "Today" rollover (home page only)
cpSync('site/groups.js', 'dist/groups.js'); // v3: client-side group-standings hydration from /api/v1/standings
cpSync('site/profile.js', 'dist/profile.js'); // v3: instant profile-takedown overlay from /api/v1/takedowns
cpSync('site/match.js', 'dist/match.js'); // v3: match-page recap overlay from /api/v1/recap (no rebuild)
cpSync('site/bartalk-teaser.js', 'dist/bartalk-teaser.js'); // bar-talk front-page teaser rotator (hydrates /api/v1/bartalk-teaser)
cpSync('scripts/lib/bartalk-view.mjs', 'dist/bartalk-view.mjs'); // shared teaser slot renderer (build bakes + bartalk-teaser.js hydrates)
cpSync('site/bartalk.js', 'dist/bartalk.js'); // /bar-talk hub hydrator (renders episodes from /api/v1/bar-talk)
writeFileSync('dist/data/schedule-context.json', JSON.stringify({
  matches: matches.map((m) => ({ match_no: m.match_no, stage: m.stage, group: m.group, kickoff_utc: m.kickoff_utc, venue_id: m.venue_id, home: m.home, away: m.away })),
  teams: teamsData, flagMap, teamColors, venues: venuesDoc.venues, bcast: bcastDoc.rows,
}));
writeFileSync('dist/schedule-spa.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Schedule (v3 dynamic prototype) · Golazo 26</title>
<link rel="stylesheet" href="/brand/tokens.css?v=7"><link rel="stylesheet" href="/styles.css?v=7"></head>
<body><main class="wrap">
<section class="hero small"><h1>${i18nSpan(S.pages.schedule.h1)}</h1><p class="kicker">${i18nSpan(S.pages.schedule.spaKicker)}</p></section>
<div id="app"><p class="muted">${i18nSpan(S.pages.schedule.loading)}</p></div></main>
<script type="module" src="/schedule-spa.js"></script></body></html>`);

// ---------- i18n Tier-2 fragment bake (v3.14 a later change, plan §3 + §6 rows 3a/3b) ----------
// Enabled languages only — a dark bake writes nothing here (and the dist clean above wiped any
// prior run, so dark output carries no residue). For each committed corpus scope
// (<I18N_DIR>/corpus/<scope>.json), every unit with a translated unit file
// <I18N_DIR>/<lang>/<scope>/<id>.json lands in the per-route fragment
// dist/i18n/<lang>/p/<route>.json — flat { "<block id>": "<html>" }, the exact shape and URL
// site/i18n.js fetches. A route bakes only when ≥1 of its blocks is translated; an untranslated
// block is simply absent (the client degrades that block to baked English). Unit ids are
// re-verified against their text so a hand-edited corpus can never ship a mismatched id.
//
// PACK units (profiles scope, plan §3 per-team packs): a unit carrying `pack: "t/<team-slug>"`
// bakes into the per-PACK file dist/i18n/<lang>/<pack>.json INSTEAD of any per-route fragment —
// one file per team (players + coach; org people pool in t/_org), ~48 packs × langs, not one
// file per profile page (~1,290 routes × langs would burn the 15k dist-file runway guard). The
// unit's `routes` list the profile pages for reference/tests; site/i18n.js fetches the pack when
// the page is stamped [data-i18n-pack].
if (I18N_LANGS.length) {
  const corpusDir = `${I18N_DIR}/corpus`;
  const scopeFiles = existsSync(corpusDir) ? readdirSync(corpusDir).filter((f) => f.endsWith('.json')).sort() : [];
  let nFrag = 0;
  for (const lg of I18N_LANGS) {
    const perRoute = new Map(); // route → { blockId: translated html }
    const perPack = new Map(); // pack ('t/<team-slug>') → { blockId: translated html }
    for (const sf of scopeFiles) {
      const scope = sf.slice(0, -5);
      for (const u of load(`${corpusDir}/${sf}`).units ?? []) {
        if (u.id !== blockId(u.text)) { console.error(`⛔ i18n: corpus ${sf} unit "${u.id}" does not hash its own text — regenerate via scripts/extract-i18n-corpus.mjs`); process.exit(1); }
        const routes = u.routes ?? [];
        if (routes.some((r) => !/^[a-z0-9][a-z0-9/-]*$/.test(r))) { console.error(`⛔ i18n: corpus ${sf} unit "${u.id}" carries a malformed route`); process.exit(1); }
        if (u.pack !== undefined && !/^t\/[a-z0-9_-]+$/.test(u.pack)) { console.error(`⛔ i18n: corpus ${sf} unit "${u.id}" carries a malformed pack "${u.pack}"`); process.exit(1); }
        const up = `${I18N_DIR}/${lg}/${scope}/${u.id}.json`;
        if (!existsSync(up)) continue;
        const tx = load(up);
        if (typeof tx.text !== 'string' || !tx.text) continue;
        // Prose XSS gate + degrade-to-OMIT (N2/A2-NEW-1, a later review round): emit the model
        // HTML only when its tag+attribute multiset equals the English source's; on a mismatch OMIT the
        // unit (like any untranslated unit — the `continue` below) rather than writing the English
        // source into the fragment. Writing English made the client swap() stamp lang=<foreign> on
        // English content (a screen-reader mislabel); omitting leaves the baked English in place with
        // no foreign lang attr. u.text is the English source.
        if (!proseTagSafe(u.text, tx.text)) continue;
        const emit = tx.text;
        if (u.pack) {
          if (!perPack.has(u.pack)) perPack.set(u.pack, {});
          perPack.get(u.pack)[u.id] = emit;
          continue;
        }
        for (const r of routes) {
          if (!perRoute.has(r)) perRoute.set(r, {});
          perRoute.get(r)[u.id] = emit;
        }
      }
    }
    for (const [route, map] of perRoute) {
      const out = `dist/i18n/${lg}/p/${route}.json`;
      mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
      writeFileSync(out, JSON.stringify(map) + '\n');
      nFrag++;
    }
    for (const [pk, map] of perPack) {
      const out = `dist/i18n/${lg}/${pk}.json`;
      mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
      writeFileSync(out, JSON.stringify(map) + '\n');
      nFrag++;
    }
  }
  // Shared S-valued blocks: every i18nBlock whose English text is a strings.mjs value translates
  // straight from the chrome pack — ONE route-independent file per language (site/i18n.js fetches
  // it alongside the route fragment; the route fragment wins on id collision). Keys sorted for a
  // stable diff. Composite blocks (non-S text, e.g. corpus prose) are not eligible here.
  for (const lg of I18N_LANGS) {
    const shared = {};
    for (const [id, en] of i18nBlockReg) {
      const key = i18nKeyOf.get(en);
      if (!key) continue;
      const tx = I18N_PACKS.get(lg)[key];
      // Prose XSS gate (N1, a later review round): blocks.json is fetched by site/i18n.js and merged
      // into the SAME innerHTML swap map (i18n.js:93-94) as the per-route fragments — an identical
      // unsanitized sink. Apply the SAME strict tag+attribute gate the corpus/pack path uses; on a
      // mismatch OMIT the block (the client keeps baked English, no foreign lang attr — matching the
      // corpus path's degrade-to-omit). `en` is this block's registered English HTML.
      if (typeof tx === 'string' && tx && proseTagSafe(en, tx)) shared[id] = tx;
    }
    if (Object.keys(shared).length) {
      mkdirSync(`dist/i18n/${lg}`, { recursive: true });
      writeFileSync(`dist/i18n/${lg}/blocks.json`, JSON.stringify(Object.fromEntries(Object.entries(shared).sort(([a], [b]) => a.localeCompare(b)))) + '\n');
      nFrag++;
    }
  }
  if (nFrag) console.log(`i18n fragments: ${nFrag} fragment files across [${I18N_LANGS.join(',')}]`);
}

// ---------- guards ----------
let fileCount = 0;
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(`${d}/${f.name}`) : fileCount++; };
walk('dist');
// EFFICIENCY (cert): fail well BELOW the free-tier 20k static-asset/version cap so growth
// (galleries up to 5/subject, more history editions) has runway and never hits a hard deploy
// rejection unexpectedly. 15k leaves ~2x the current working set.
if (fileCount > 15000) { console.error(`⛔ file count ${fileCount} > 15,000 runway guard (free-tier hard cap is 20,000 static assets/version — move the image tier to R2 before growing further)`); process.exit(1); }
{
  const dupes = [];
  const scanD = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const fp = `${dir}/${e.name}`; if (/ \d+(\.|$)/.test(e.name)) dupes.push(fp); else if (e.isDirectory()) scanD(fp); } };
  scanD('dist');
  if (dupes.length) { console.error(`⛔ Finder duplicate artifacts appeared in dist/ during build:\n${dupes.join('\n')}`); process.exit(1); }
}
console.log(`build OK — ${fileCount} files in dist/ (cap 20,000) · data as of ${AS_OF}`);
