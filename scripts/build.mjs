#!/usr/bin/env node
// build.mjs — Golazo 26 production static-site generator.
// Zero dependencies. Bakes the entire public site into dist/ from the audited
// datasets in data/ (and, once the baker runs, live score state merged there).
// Every page carries provenance and a "data as of" stamp. ~1,250 files.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const matchesDoc = load('data/matches.json');
const matches = matchesDoc.matches;
const VER = (process.env.GITHUB_SHA || 'dev').slice(0, 8); // cache-bust app.js/predict.js per deploy

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

// Merge tournament-time state exported from D1 by the live-update job (overrides
// already applied there — D1 is the single source of truth at runtime).
const liveState = existsSync('data/live-state.json') ? load('data/live-state.json') : null;
const ledgerDoc = existsSync('data/ledger.json') ? load('data/ledger.json') : { events: [] };
const ledgerBy = (type, id) => ledgerDoc.events.filter((e) => e.entity_type === type && String(e.entity_id) === String(id)).sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
const ledgerWhen = (ts) => {
  try {
    const d = new Date(String(ts).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return String(ts);
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).toUpperCase() + ' UTC';
  } catch { return String(ts); }
};
const ledgerHTML = (events, title = 'Old news') => events.length ? `
<div class="gcard" style="margin-top:1rem">
  <div class="g-head"><div><div class="kicker">${esc(title.toUpperCase())} · <b>NEWEST FIRST</b></div>
  <p class="kicker" style="margin-top:.4rem">DETERMINISTIC LEDGER — APPEND-ONLY, AS-OF STAMPED</p></div></div>
  <ul class="g-fixtures num">
${events.slice(0, 8).map((e) => `    <li><span class="when">${ledgerWhen(e.ts)}</span><span style="flex:1">${esc(e.text)}</span>${e.provisional ? '<span class="pill warn">provisional</span>' : e.type === 'correction' ? '<span class="pill warn">corrected</span>' : e.type === 'status' && /set aside/.test(e.text) ? '<span class="pill warn">set aside</span>' : '<span class="pill ft">FT ✓</span>'}</li>`).join('\n')}
  </ul>
  <p class="g-foot">Facts as of the stamp on each line${events.length > 8 ? ` · showing the latest 8 of ${events.length}` : ''} · source: ${esc(events[0]?.source_note ?? 'live baker')}</p>
</div>` : '';
if (liveState) {
  const byN = new Map(liveState.matches.map((m) => [m.n, m]));
  for (const m of matches) {
    const s = byN.get(m.match_no);
    if (s) { m.status = s.status; m.score = s.score; }
  }
}
// AI prediction league: picks exported from D1 by the live-update job into
// data/ai-predictions.json. Absent file = no AI sections bake (same
// no-broken-UI gate as clerk-public.json). Scoring is deterministic at
// bake time: 3 pts exact score, 1 pt right outcome, finished_confirmed only.
const aiDoc = existsSync('data/ai-predictions.json') ? load('data/ai-predictions.json') : null;
const AI_NAME = { claude: 'Claude', gpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok' };
const AI_ORDER = ['claude', 'gpt', 'gemini', 'grok'];
const aiLogo = (p) => `<svg class="ai-logo" viewBox="0 0 24 24" aria-hidden="true"><use href="/brand/ai-logos.svg#ai-${p}"/></svg>`;
const aiLabel = (p) => `${aiLogo(p)} ${AI_NAME[p] ?? esc(p)}`;
const aiByMatch = new Map();
for (const r of aiDoc?.predictions ?? []) {
  const arr = aiByMatch.get(r.match_no) ?? [];
  arr.push(r);
  aiByMatch.set(r.match_no, arr);
}
// Humans leaderboard: exported by recompute-leaderboard during the bake.
// Same gate as the AI doc — absent file, no page, no nav entry. Display
// names arrive pre-anonymized ("First L."); full names never reach the
// generator.
const lbDoc = existsSync('data/leaderboard.json') ? load('data/leaderboard.json') : null;
// Stories: published pieces only (status=published in D1, exported by
// the live export). Absent file = no story sections. mdLite renders the
// narrow markdown subset I allow (bold/em/paras).
const stDoc = existsSync('data/stories.json') ? load('data/stories.json') : null;
const storyBy = new Map();
for (const st of stDoc?.stories ?? []) storyBy.set(`${st.kind}|${st.subject_id}|${st.locale}`, st);
const mdLite = (md) => String(md).split(/\n\n+/).map((par) =>
  `<p>${esc(par.trim()).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')}</p>`).join('');
const storyHTML = (kind, subject, title) => {
  const st = storyBy.get(`${kind}|${subject}|en`);
  if (!st) return '';
  return `<section class="prose"><h2>${title}</h2>${mdLite(st.body_md)}</section>`;
};
// History Hub: edition prose (data/history/<year>.json) + structured facts
// rail (data/history/facts.json, every field extracted verbatim from that
// prose). Absent dir = no /history, no nav entry — same no-broken-UI gate.
const historyOK = existsSync('data/history/facts.json') && existsSync('data/history/hub.json');
const historyFacts = historyOK ? new Map(load('data/history/facts.json').editions.map((e) => [e.year, e])) : new Map();
const historyHub = historyOK ? load('data/history/hub.json') : null;

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

// brand — audited team colors (build refuses unaudited rows) + inline mark
const teamColors = load('data/team-colors.json').teams;
{
  const bad = Object.entries(teamColors).filter(([, t]) => !t.audited);
  if (bad.length || Object.keys(teamColors).length !== 48) { console.error(`⛔ team-colors: ${bad.length} unaudited / ${Object.keys(teamColors).length} rows`); process.exit(1); }
  // SECURITY: every color value is injected into style="--..." / data-* — assert each is a
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

const AS_OF = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const STAGE = { group: 'Group stage', r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', third: 'Third place match', final: 'Final' };
// SECURITY: escape &, <, >, " and ' so the primitive is safe in both element-text
// and double/single-quoted attribute contexts. safeUrl() additionally rejects dangerous schemes.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeUrl = (u) => { const s = String(u ?? '').trim(); return /^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(s) && !/^\s*(javascript|data|vbscript):/i.test(s) ? esc(s) : '#'; };
const et = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const etDate = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
const etDateLong = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
const localT = (iso, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));

// ---------- flags (pinned Twemoji sprite), FIFA codes, kit tokens ----------
const flagMap = load('data/flag-map.json').teams;
const SPRITE = '/brand/flags.svg?v=4';
const slugOf = (name) => teams.get(name)?.slug;
const fifaOf = (name) => flagMap[slugOf(name)]?.fifa ?? '';
const fchip = (name, cls = 's') => {
  const s = slugOf(name);
  return s ? `<span class="fchip ${cls}"><svg viewBox="0 0 36 36" role="img" aria-label="${esc(name)} flag"><use href="${SPRITE}#f-${s}"/></svg></span>` : '';
};
const ANT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 14V5.5 M3 2l5 3.5L13 2 M5.2 14h5.6"/></svg>';
const kitOf = (name) => { const c = teamColors[slugOf(name)]; return c?.ui ?? null; };
// confetti palette: >=2 flag colours; single-colour flags -> [primary, white]
const confettiColors = (name) => {
  const c = teamColors[slugOf(name)]; if (!c) return [];
  const cols = (c.colors || []).filter(Boolean);
  return cols.length >= 2 ? cols.slice(0, 3) : [c.ui?.primary, c.ui?.secondary].filter(Boolean);
};
// away-edge clash rule: same-hue, same-weight primaries -> away secondary
const hsl = (hex) => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: mx ? d / mx : 0, l: (mx + mn) / 2 };
};
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

const flagOf = (name) => teams.get(name)?.flag ?? '';
const teamLink = (name) => `<a class="team" href="/teams/${teams.get(name)?.slug}">${fchip(name)} ${esc(name)}</a>`;
const sideHTML = (s, link = true) => s.team
  ? (link ? teamLink(s.team) : `<span class="team">${fchip(s.team)} ${esc(s.team)}</span>`)
  : `<span class="team tbd">${esc(s.placeholder_text)}</span>`;
const matchURL = (m) => `/matches/${m.match_no}`;
// mirrors app.js live-injection labels exactly (baked == injected)
const scoreHTML = (m) => m.score && m.status !== 'scheduled'
  ? `<span class="score">${m.score.home}&nbsp;:&nbsp;${m.score.away}</span>${m.status === 'finished_provisional' ? ' <span class="pill warn">FT (provisional)</span>' : m.status === 'in_play' ? ` <span class="pill live"><span class="match-min" data-k="${m.kickoff_utc}">LIVE</span></span>` : m.status === 'finished_confirmed' ? ' <span class="pill ft">FT ✓</span>' : ` <span class="pill warn">${esc(String(m.status).replace(/_/g, ' '))}</span>`}`
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

const NAV = [
  ['/', 'Today', 'home'], ['/schedule', 'Schedule', 'schedule'], ['/groups', 'Groups', 'groups'],
  ['/teams/', 'Teams', 'teams'], ['/watch', 'How to watch', 'watch'], ['/calendar', 'Calendar', 'calendar'],
  ...(historyOK ? [['/history', 'History', 'history']] : []),
  ...(aiDoc ? [['/ai-league', 'AI league', 'ai']] : []),
  ...(lbDoc ? [['/leaderboard', 'Leaderboard', 'lb']] : []),
];

// Shared face renderer: clicking a photo opens the high-res
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
  return `<div class="gallery" role="group" aria-label="${esc(name)} — ${items.length} verified photos">${items.join('')}</div>
<p class="gallery-note muted">${items.length} photos · tap any to view full size with photographer credit &amp; licence.</p>`;
};
// ---------- deep-profile registry ----------
// Prose shards (data/profiles/prose/*.json) pair with fact shards
// (data/profiles/facts/*.json). A profile page renders ONLY when a published
// prose piece exists; names linkify only then. Slugs derive from the globally
// unique wiki_title (display names collide), with a build-time assert.
const slugify = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const profiles = new Map(); // key `${kind}:${name}` -> {slug, kind, name, team, text, meta, sheet}
const teamProse = new Map(); // team name -> {text, meta, sheet}
if (existsSync('data/profiles/prose')) {
  // Finder "name 2.json" copies shadow real shards via readdir — hard-fail like site/+dist/.
  const dupShard = (f) => / \d+\.[a-z.]+$/i.test(f);
  const factShards = {};
  for (const f of readdirSync('data/profiles/facts')) {
    if (dupShard(f)) { console.error(`⛔ duplicate-contaminated fact shard: data/profiles/facts/${f} — remove it`); process.exit(1); }
    factShards[f] = load(`data/profiles/facts/${f}`);
  }
  // Prefer the fact shard PAIRED with the prose shard being read: the same person
  // can appear in two shards with different kinds (Pochettino: usa.json coach AND
  // officials.json official) and first-match-by-filename picks the wrong identity.
  const sheetFor = (name, preferShard) => {
    if (preferShard && factShards[preferShard]?.[name]) return factShards[preferShard][name];
    for (const sh of Object.values(factShards)) if (sh[name]) return sh[name];
    return null;
  };
  const seenSlugs = new Map();
  const proseFiles = readdirSync('data/profiles/prose').filter((f) => f.endsWith('.json') && !f.endsWith('.review.json'));
  for (const f of proseFiles) if (dupShard(f)) { console.error(`⛔ duplicate-contaminated prose shard: data/profiles/prose/${f} — remove it`); process.exit(1); }
  // PUBLISH GATE: any prose shard beyond the initial hand-licensed set requires a
  // local sign-off file. Its check must record >=1 fact I deliberately suppressed via
  // the TBD path, proving the unverifiable-data handling actually fired before I expand
  // coverage. The build halts without it — scaling publication is a deliberate step.
  const INITIAL_SHARDS = new Set(['usa.json', 'haiti.json', 'teams.json']);
  const extraShards = proseFiles.filter((f) => !INITIAL_SHARDS.has(f));
  if (extraShards.length) {
    const VF = 'data/profiles/review/publish-approval.json';
    let v = null;
    try { v = load(VF); } catch { v = null; }
    const proof = v?.suppressed_facts;
    const gateOK = v && v.approved === true && Array.isArray(proof) && proof.length >= 1 && proof.every((p) => p.subject && p.fact && p.evidence);
    if (!gateOK) {
      console.error(`⛔ publish gate: prose beyond the initial set present (${extraShards.join(', ')}) but ${VF} is missing or invalid — requires approved:true and suppressed_facts[] entries with {subject, fact, evidence}. Build halted.`);
      process.exit(1);
    }
  }
  for (const f of proseFiles) {
    const shard = load(`data/profiles/prose/${f}`);
    for (const [name, piece] of Object.entries(shard)) {
      if (name.startsWith('_') || !piece.text || (piece.published === false && process.env.PREVIEW_UNPUBLISHED !== '1')) continue;
      // hard publish-safety: a review-failed / verbatim-flagged piece never renders,
      // even if its published flag was flipped true (defence in depth past the flip).
      if (piece.review === 'fail' || piece.review === 'fail-verbatim') continue;
      const sheet = sheetFor(name, f);
      if (!sheet) { console.error(`profile prose without a facts shard: ${name}`); continue; }
      if (sheet.kind === 'team') { teamProse.set(name, { text: piece.text, meta: piece, sheet }); continue; }
      const slug = slugify(sheet.wiki_title);
      if (seenSlugs.has(slug) && seenSlugs.get(slug) !== name) { console.error(`⛔ slug collision: ${slug} (${name} vs ${seenSlugs.get(slug)})`); process.exit(1); }
      seenSlugs.set(slug, name);
      profiles.set(`${sheet.kind}:${name}`, { slug, kind: sheet.kind, name, team: sheet.team, text: piece.text, meta: piece, sheet });
    }
  }
  console.log(`profiles loaded: ${profiles.size} people, ${teamProse.size} teams`);
}
const profileURL = (kind, name) => {
  const p = profiles.get(`${kind}:${name}`);
  if (!p) return null;
  return p.kind === 'player' ? `/players/${p.slug}` : `/people/${p.slug}`;
};
const nameLinkHTML = (kind, name, inner) => {
  const u = profileURL(kind, name);
  return u ? `<a class="profile-link" href="${u}">${inner}</a>` : inner;
};

const attrHTML = (img) => img ? `<a class="attr" href="${img.file_page}" rel="noopener" title="Photo: ${esc(img.author ?? 'see file page')} — ${esc(img.license)} — via Wikimedia Commons (resized)">ⓘ</a>` : '';

function page(title, active, body, { desc = 'Independent fan guide to every 2026 World Cup match — times, venues, and how to watch free.', live = false, og = '/brand/og/og-default.png', path = '/', lang = 'en', confetti = false } = {}) {
  // D2 (audit): every multi-column `table.watch` must sit in a scroll container or it forces
  // body-level horizontal overflow on mobile. Wrap them at this single assembly point so current
  // AND future watch tables are always wrapped (tables don't nest -> non-greedy match is safe).
  body = body.replace(/<table class="watch">([\s\S]*?)<\/table>/g, '<div class="tablewrap2"><table class="watch">$1</table></div>');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(desc)}">
<title>${esc(title)} · Golazo 26</title>
<link rel="preload" href="/fonts/barlow-condensed-600-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/brand/tokens.css?v=7">
<link rel="stylesheet" href="/styles.css?v=7">
<script>try{var d=document.documentElement,q=new URLSearchParams(location.search).get("theme"),t=q||localStorage.getItem("theme");if(t)d.dataset.theme=t;var c=localStorage.getItem("contrast");if(c){var T=[6,9,13,18,24,31,39,48,58,70],B=[22,29,36,44,52,60,68,76,84,92],i=+c-1;if(T[i]){d.style.setProperty("--shine-top",T[i]+"%");d.style.setProperty("--shine-bd",B[i]+"%")}}}catch(e){}</script>
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
<a class="skip" href="#main">Skip to content</a>
<div class="ticker" aria-hidden="true"><div class="wrap">
  <span>WORLD CUP 26</span>
  <span class="mid">JUN 11 — JUL 19</span>
  <span class="mid">104 MATCHES</span>
  <span class="mid">48 TEAMS</span>
  <span class="mid">16 CITIES · US MX CA</span>
  <span class="right">AD-FREE FAN GUIDE · DATA AS OF ${AS_OF.slice(11)}</span>
</div></div>
<header class="site"><div class="wrap">
  <a class="brand" href="/">${MARK} <b>GOLAZO <i>26</i></b></a>
  <nav class="main" aria-label="Main">${NAV.map(([href, label, key]) => `<a href="${href}"${key === active ? (href === path ? ' class="on" aria-current="page"' : ' class="on"') : ''}>${label}</a>`).join('')}</nav>
  <div class="hdr-ctrls"><select id="contrast-sel" aria-label="Card colour contrast" title="Card colour contrast">${['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((v) => `<option value="${v}">${v ? `Contrast ${v}` : 'Contrast: auto'}</option>`).join('')}</select><button id="theme-btn" type="button">Theme</button></div>
</div></header>
<main class="wrap" id="main">
${body}
</main>
<footer class="site"><div class="wrap">
<div class="links"><a href="/venues">Venues</a><a href="/people/fifa">FIFA administration</a><a href="/people/us-soccer">U.S. Soccer</a><a href="/como-ver">En español</a><a href="/ics/all.ics">Calendar feed</a><a href="/sources">All sources</a><a href="/about">About</a><a href="/privacy">Privacy</a></div>
<p>Golazo 26 is an independent, ad-free, non-commercial fan guide. Not affiliated with FIFA, any federation, or any broadcaster.</p>
<p>Schedule: <a href="https://github.com/openfootball/worldcup.json" rel="noopener">openfootball</a> (public domain) ⨯ <a href="https://fixturedownload.com" rel="noopener">fixturedownload</a>, cross-checked · Rosters: Wikipedia (<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a>, pinned revision) · Photos: Wikimedia Commons, attributed per image · Flag artwork: <a href="https://github.com/jdecked/twemoji" rel="noopener">Twemoji</a> (<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>) · <span class="muted num">data as of ${AS_OF}</span></p>
<p id="stale-banner" class="muted" role="status" hidden>Live scores may be delayed — last update <span id="stale-asof" class="num"></span>. We show data honestly, never fake-live.</p>
</div></footer>
<script src="/app.js?v=${VER}" defer></script>
${confetti ? '<script type="module" src="/confetti.js?v=1"></script>' : ''}
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

// SECURITY: emit a _headers file so the assets-only Worker sends defensive
// headers on every page. CSP locks framing (frame-ancestors none), object/base-uri, and source
// origins; script-src keeps 'unsafe-inline' ONLY because the theme/contrast pre-paint is an inline
// script in a statically-baked page (no per-request nonce is possible) — everything else is pinned.
// Clerk + the API worker are allowlisted for the predictions box; img allows self + data: (avatars).
{
  // Clerk allowlist: predict.js loads clerk-js from, and calls, the Clerk
  // Frontend-API host ENCODED IN the publishable key — for a production pk_live_* that is the
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
    `connect-src 'self' https://golazo26-api.onwike.workers.dev${clerkSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${clerkPub ? ' https://img.clerk.com' : ''}`,
    "font-src 'self'",
    "worker-src 'self' blob:",
    `frame-src https://challenges.cloudflare.com${clerkSrc}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');
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

const cardKicker = (m) => {
  const bits = [m.stage === 'group' ? `GROUP ${m.group}` : STAGE[m.stage].toUpperCase(), `MATCH ${m.match_no}`];
  if (m.match_no === 1) bits.push('<b>OPENER</b>');
  else if (m.home.team === 'USA' || m.away.team === 'USA') bits.push('<b>USMNT</b>');
  return bits.join(' · ');
};
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
  <div class="mc-teams">${sideHTML(m.home)} <span class="vs">vs</span> ${sideHTML(m.away)}</div>
  <div class="mc-meta">${esc(v.common_name)}, ${esc(v.city)} · ${localT(m.kickoff_utc, v.tz)} local</div>
  <div class="chips mc-chips">${chip(m)} <a class="more" href="${matchURL(m)}" aria-label="Match page: ${names}">Match page →</a></div>
</article>`;
};

// theme-aware hero pitch art (currentColor — works on both themes)
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

// ---------- index (today / next matches) ----------
{
  const now = Date.now();
  const opener = matches[0];
  const heroKicker = now < new Date(opener.kickoff_utc).getTime()
    ? `<b>THE TOURNAMENT STARTS ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(new Date(opener.kickoff_utc)).toUpperCase()}</b> · OPENER AT ESTADIO AZTECA`
    : `<b>WORLD CUP 26</b> · LIVE GUIDE · JUNE 11 – JULY 19`;
  const upcomingDays = [...new Set(matches
    .filter((m) => new Date(m.kickoff_utc).getTime() > now - 6 * 3600e3)
    .sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc))
    .map((m) => etDate(m.kickoff_utc)))].slice(0, 2);
  const daySection = (d) => {
    const ms = matches.filter((m) => etDate(m.kickoff_utc) === d).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
    const usa = ms.some((m) => m.home.team === 'USA' || m.away.team === 'USA');
    const allFree = ms.every((m) => bcast.get(m.match_no)?.us_english === 'FOX');
    return `<section class="daysec"><h2>${etDateLong(ms[0].kickoff_utc)} <span class="kicker">${usa ? `${fchip('USA')} <b>USA PLAYS</b>` : allFree ? '<b>ALL FREE OTA</b>' : `${ms.length} MATCHES`}</span></h2>\n<div class="cards">${ms.map(matchCard).join('\n')}</div></section>`;
  };
  const firstDay = upcomingDays.length ? daySection(upcomingDays[0]) : '';
  const restDays = upcomingDays.slice(1).map(daySection).join('\n');

  // History rail: the last five finals as a mini timeline beside the
  // match cards. Reuses data/history/facts.json — champion + final score per edition,
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
  <a class="rail-cta" href="/history">
    <span class="crown" aria-hidden="true">★</span>
    <span><b>Before the first whistle</b><span class="rc-sub">96 years of World Cups — every champion, told with sources.</span></span>
  </a>
  <div class="rail-sec">
    <p class="rail-h">The last five finals</p>
    <div class="mini-tl">${last5.map(mnode).join('')}</div>
    <a class="rail-more" href="/history">Explore the full history →</a>
  </div>
</aside>`;
  const body = `
<section class="hero">
  ${HERO_ART}
  <p class="kicker">${heroKicker}</p>
  <h1>Every match.<br>Every way to watch.<br><em>Free first.</em></h1>
  <p class="sub">104 matches · 48 teams · 16 stadiums across the US, Mexico &amp; Canada · June 11 – July 19</p>
  <p class="free-callout"><span class="chip ota">${ANT}FREE OTA</span> <span><strong>${bcastDoc.totals.FOX} matches are free over the air on FOX</strong> — and ${bcastDoc.totals.Telemundo} free in Spanish on Telemundo.</span> <span><a href="/watch">Antenna guide →</a> · <a href="/como-ver">en español →</a></span></p>
</section>
${historyOK ? `<div class="todaygrid">
  <div class="firstday">${firstDay}</div>
  ${rail}
  <div class="restdays">${restDays}</div>
</div>` : `${firstDay}\n${restDays}`}
<p class="more"><a href="/schedule">Full 104-match schedule →</a></p>`;
  writeFileSync('dist/index.html', page('Today', 'home', body, { live: true }));
}

// ---------- schedule: day rails (v2) ----------
{
  const STAGE_K = { group: (m) => `GRP ${m.group}`, r32: () => 'R32', r16: () => 'R16', qf: () => 'QF', sf: () => 'SF', third: () => '3RD', final: () => 'FINAL' };
  const srow = (m) => {
    const v = venues.get(m.venue_id);
    const b = bcast.get(m.match_no);
    const names = [m.home.team, m.away.team].filter(Boolean).join('|');
    const { c1, c2 } = edgeColors(m.home.team, m.away.team);
    const [tt, ap] = et(m.kickoff_utc).split(' ');
    return `<a class="srow num" href="${matchURL(m)}" data-srow data-stage="${m.stage}" data-group="${m.group ?? ''}" data-teams="${esc(names)}" data-net="${b?.us_english ?? ''}" style="--c1:${c1};--c2:${c2}">
<span class="s-time"><span class="local-time" data-utc="${m.kickoff_utc}">${tt}<small>${ap} ET</small></span></span>
<span class="s-match">${m.home.team ? `${fchip(m.home.team)} ${esc(m.home.team)}` : `<span class="team tbd">${esc(m.home.placeholder_text)}</span>`} <span class="vs">vs</span> ${m.away.team ? `${fchip(m.away.team)} ${esc(m.away.team)}` : `<span class="team tbd">${esc(m.away.placeholder_text)}</span>`}</span>
<span class="kicker s-kick">${STAGE_K[m.stage](m)}</span>
<span class="s-venue">${esc(v.common_name)}, ${esc(v.city)}</span>
<span class="s-tv">${b ? `${b.us_english === 'FOX' ? `<span class="chip ota">${ANT}FOX</span>` : `<span class="chip">${b.us_english}</span>`}${b.us_spanish === 'Telemundo' ? `<span class="chip ota">${ANT}TEL</span>` : `<span class="chip">${b.us_spanish}</span>`}` : '<span class="chip">TBD</span>'}</span>
<span class="s-go" aria-hidden="true">→</span>
</a>`;
  };
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
<div class="dayrail"><div class="d">${dow}<small>${md}${usa ? ' · USA PLAYS' : ''}</small></div><div class="rulebar"></div><div class="meta">${meta}</div></div>
<div class="slist">
${ms.map(srow).join('\n')}
</div></section>`;
  }).join('\n');
  const body = `
<section class="hero small"><h1>Schedule — all 104 matches</h1></section>
<div class="filters" id="filters">
  <input type="search" id="f-text" placeholder="Search team…" list="teamlist" aria-label="Search team">
  <datalist id="teamlist">${teamsData.map((t) => `<option>${esc(t.name)}</option>`).join('')}</datalist>
  <select id="f-stage" aria-label="Stage"><option value="">All stages</option>${Object.entries(STAGE).map(([k, vl]) => `<option value="${k}">${vl}</option>`).join('')}</select>
  <select id="f-group" aria-label="Group"><option value="">All groups</option>${'ABCDEFGHIJKL'.split('').map((g) => `<option>${g}</option>`).join('')}</select>
  <select id="f-net" aria-label="US channel"><option value="">Any US channel</option><option>FOX</option><option>FS1</option></select>
  <span class="chip count num" id="f-count" aria-live="polite"></span>
</div>
${daySections}
<p class="muted"><span class="chip ota">${ANT}FREE</span> = free over the air with an antenna. Times adapt to your timezone. Knockout slots show official placeholders until decided — never predictions. <a href="/ics/all.ics">Add all matches to your calendar (.ics)</a></p>`;
  writeFileSync('dist/schedule.html', page('Schedule', 'schedule', body, { path: '/schedule' }));
}

// ---------- 104 match pages ----------
mkdirSync('dist/matches', { recursive: true });
for (const m of matches) {
  const v = venues.get(m.venue_id);
  const b = bcast.get(m.match_no);
  const title = m.home.team && m.away.team ? `${m.home.team} vs ${m.away.team}` : `Match ${m.match_no}: ${m.home.team ?? m.home.placeholder_text} vs ${m.away.team ?? m.away.placeholder_text}`;
  const tubi = m.match_no === 1 || m.match_no === 4;
  const free = [];
  if (b?.us_english === 'FOX') free.push('<strong>FOX</strong> — free over the air with any TV antenna');
  if (b?.us_spanish === 'Telemundo') free.push('<strong>Telemundo</strong> — free over the air, en español');
  if (tubi) free.push('<strong>Tubi</strong> — free stream, live in 4K, no account (<a href="https://corporate.tubitv.com/press/tubi-launches-2026-fifa-world-cup-fox-hub/" rel="noopener">announcement</a>)');
  const clTeam = (s, alignEnd = false) => s.team
    ? `${alignEnd ? '' : `${fchip(s.team, 'lg')} `}<a class="team" href="/teams/${slugOf(s.team)}">${fifaOf(s.team)}</a>${alignEnd ? ` ${fchip(s.team, 'lg')}` : ''}`
    : `<span class="team tbd" style="font:600 14px var(--font-d)">${esc(s.placeholder_text)}</span>`;
  const body = `
<p class="crumb"><a href="/schedule">← Schedule</a></p>
<section class="hero small">
<p class="kicker">MATCH ${m.match_no} · ${m.stage === 'group' ? `GROUP ${m.group}` : STAGE[m.stage].toUpperCase()} · ${etDateLong(m.kickoff_utc).toUpperCase()}</p>
<h1 class="matchup">${sideHTML(m.home)} <span class="vs">vs</span> ${sideHTML(m.away)}</h1>
</section>
<div class="cluster num">
  <div class="cl-row">
    <div class="cl-team">${clTeam(m.home)}</div>
    <div class="cl-mid" data-match="${m.match_no}"${m.home.team && m.away.team ? ` data-home-team="${esc(m.home.team)}" data-away-team="${esc(m.away.team)}" data-home-colors="${confettiColors(m.home.team).join(',')}" data-away-colors="${confettiColors(m.away.team).join(',')}"` : ''}>${scoreHTML(m)}</div>
    <div class="cl-team">${clTeam(m.away, true)}</div>
  </div>
  <div class="cl-bar">${m.status === 'scheduled' ? `KICKOFF ${etDateLong(m.kickoff_utc).toUpperCase()} · ${et(m.kickoff_utc)} ET · ${localT(m.kickoff_utc, v.tz).toUpperCase()} LOCAL` : `STATUS UPDATES HONESTLY — SEE BANNER IF STALE`} · ${esc(v.common_name).toUpperCase()}, ${esc(v.city).toUpperCase()}</div>
</div>
${ledgerHTML(ledgerBy('match', m.match_no), `Match ${m.match_no} — old news`)}
<p class="meta">${esc(v.common_name)} (${esc(v.fifa_name)}), ${esc(v.locality)} · <span class="local-time" data-utc="${m.kickoff_utc}">${et(m.kickoff_utc)} ET</span> <span class="muted">(${localT(m.kickoff_utc, v.tz)} local)</span></p>
<section class="watchbox"><h2>How to watch (US)</h2>
${free.length ? `<p class="free-callout"><span class="chip ota">${ANT}FREE</span> <span>${free.join(' · ')}</span></p>` : ''}
<table class="watch">
<tr><th>English TV</th><td><strong>${b?.us_english ?? 'TBD'}</strong>${b?.us_english === 'FS1' ? ' — cable only; no free English broadcast. Watch options (FOX One $19.99/mo · 4K · 7-day trial, or a live-TV trial): <a href="https://www.foxsports.com/live" rel="noopener">foxsports.com/live</a>' : b?.us_english === 'FOX' ? ' — free over the air with an antenna; also on every live-TV service' : ''} · <a href="https://www.foxsports.com/soccer/fifa-world-cup/schedule" rel="noopener">FOX schedule</a></td></tr>
<tr><th>Spanish TV</th><td><strong>${b?.us_spanish ?? 'TBD'}</strong>${b?.us_spanish === 'Telemundo' ? ' — free over the air with an antenna' : b?.us_spanish === 'Universo' ? ' — cable only' : ''} · stream all 104 in Spanish on <a href="https://www.peacocktv.com/" rel="noopener">Peacock</a> ($10.99/mo)</td></tr>
<tr><th>Streaming</th><td><a href="https://www.peacocktv.com/" rel="noopener">Peacock</a> (Spanish, all 104, $10.99/mo) · <a href="https://www.foxsports.com/live" rel="noopener">FOX One</a> (English, 4K, $19.99/mo, 7-day trial)${tubi ? ' · <strong><a href="https://tubitv.com/" rel="noopener">Tubi</a> — free 4K</strong>' : ''} · <a href="/sources#streaming">pricing sources</a></td></tr>
<tr><th>Canada / México</th><td>Canada: TSN/RDS (all 104), CTV free for 44 (QFs onward except the 3rd-place match) · México: 32 free en TV abierta, ViX (all 104) — <a href="/watch#ca-mx">details</a></td></tr>
</table>
<p class="muted">Channel verified ${b?.verified_at ?? ''} — <a href="${b?.source_url ?? '/sources'}" rel="noopener">source</a>.</p></section>
${clerkPub && m.home.team && m.away.team && m.status === 'scheduled' ? `<section><h2>Predict this match</h2><div id="predict-box" data-match="${m.match_no}" data-kickoff="${m.kickoff_utc}" data-pk="${clerkPub.publishable_key}"></div></section>` : ''}
${m.status === 'finished_confirmed' ? storyHTML('match_recap', String(m.match_no), 'Match report') : ['scheduled', 'in_play'].includes(m.status) ? storyHTML('match_preview', String(m.match_no), 'Match preview') : ''}
${aiByMatch.has(m.match_no) ? `<section><h2>AI prediction league</h2><table class="watch">
<tr><th>AI</th><th>Pick</th><th>Why</th></tr>
${aiByMatch.get(m.match_no).sort((a, b) => AI_ORDER.indexOf(a.provider) - AI_ORDER.indexOf(b.provider)).map((r) => `<tr><th>${aiLabel(r.provider)}</th><td style="white-space:nowrap"><strong>${r.home}–${r.away}</strong></td><td>${esc(r.rationale ?? '')}</td></tr>`).join('\n')}
</table>
<p class="muted">AI-generated picks, placed before kickoff and never changed — a virtual bragging-rights league, no real money. An AI that missed a match scores zero; bets are never backfilled. <a href="/ai-league">League standings →</a></p></section>` : ''}
${m.stage === 'group' ? `<section><h2>Group ${m.group}</h2><p>${teamsData.filter((t) => t.group === m.group).map((t) => teamLink(t.name)).join(' · ')} — <a href="/groups#group-${m.group}">table</a></p></section>` : ''}
<p class="muted footnote">Provenance: schedule from openfootball ⨯ fixturedownload (cross-checked${[29, 31].includes(m.match_no) ? '; kickoff resolved 2-of-3 with Wikipedia and confirmed against FIFA — <a href="/sources#discrepancies">details</a>' : ''}); kickoff in UTC: <code>${m.kickoff_utc}</code>. Add to calendar: <a href="/ics/all.ics">.ics</a></p>`;
  const ogPath = m.home.team && teamColors[teams.get(m.home.team)?.slug] ? `/brand/og/${teams.get(m.home.team).slug}-og.png` : '/brand/og/og-default.png';
  writeFileSync(`dist/matches/${m.match_no}.html`, page(title, 'schedule', body, { og: ogPath, path: `/matches/${m.match_no}`, live: true, confetti: true, desc: `${title} — ${etDateLong(m.kickoff_utc)}, ${v.common_name}. How to watch free in the US.` }));
}

// ---------- teams index + 48 team pages ----------
mkdirSync('dist/teams', { recursive: true });

// Country banner: shared frame — ink field, outlined FIFA code,
// kit baseline — country layer = the team's pinned Twemoji flag at a broadcast crop.
// Per-flag transforms tuned for the eight tricky flags; centered safe crop otherwise.
const FLAG_TF = {
  'czechia': 'translate(312 -120) scale(10)', 'mexico': 'translate(312 -84) scale(8)',
  'south-africa': 'translate(312 -102) scale(9)', 'bosnia-and-herzegovina': 'translate(303 -102) scale(9)',
  'qatar': 'translate(240 -120) scale(10)', 'switzerland': 'translate(254.5 -147) scale(11.5)',
};
const TBC = { // banner-code color: hand-picked per flag; default = lighter of the kit pair
  'czechia': '#d7141a', 'korea-republic': '#c60c30', 'mexico': '#a6d388', 'south-africa': '#ffb611',
  'bosnia-and-herzegovina': '#fbd116', 'canada': '#d52b1e', 'qatar': '#eeeeee', 'switzerland': '#d32d27',
};
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255); };
const relLum = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
const cRatio = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const visBase = (hex) => hex?.toLowerCase() === '#eeeeee' ? '#d7dadd' : hex; // white baselines -> visible neutral
const bannerSVG = (t) => {
  const ui = teamColors[t.slug]?.ui;
  if (!ui) return '';
  const tf = FLAG_TF[t.slug] ?? 'translate(294 -102) scale(9)';
  let tbc = TBC[t.slug] ?? (lum(ui.primary) >= lum(ui.secondary) ? ui.primary : ui.secondary);
  if (cRatio(tbc, '#11151d') < 3) tbc = ui.onDark && cRatio(ui.onDark, '#11151d') >= 3 ? ui.onDark : '#eeeeee'; // contrast floor vs ink field
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
<section class="hero small"><h1>Teams</h1>
<p class="sub">48 teams, 12 groups. Every banner is the country's own flag — pinned Twemoji artwork at a broadcast crop.</p></section>
${groups.map((g) => `<p class="kicker" style="margin:1.4rem 0 .6rem" id="group-${g}">GROUP ${g}</p><div class="tgrid">${teamsData.filter((t) => t.group === g).map((t) => {
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
  const heroSVG = `<svg class="team-hero2" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(t.name)} — Group ${t.group} team header">
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
${teamProse.has(t.name) ? `<section class="prose"><h2>About this team</h2>${teamProse.get(t.name).text.split(/\n\n+/).map((par) => `<p>${esc(par)}</p>`).join('')}${proseFooter(teamProse.get(t.name))}</section>` : ''}
${storyHTML('team_outlook', t.name, 'Tournament outlook')}
<section><h2>Fixtures</h2><ul class="fixtures">${fixtures.map((m) => {
    const v = venues.get(m.venue_id);
    return `<li><a class="muted" href="${matchURL(m)}">${etDate(m.kickoff_utc)}</a> — ${sideHTML(m.home, m.home.team !== t.name)} vs ${sideHTML(m.away, m.away.team !== t.name)} · <span class="local-time" data-utc="${m.kickoff_utc}">${et(m.kickoff_utc)} ET</span> · ${esc(v.common_name)} ${chip(m)}</li>`;
  }).join('')}</ul>
<p class="muted">Knockout fixtures appear here when qualification is decided. <a href="/ics/${t.slug}.ics">Add ${esc(t.name)}'s matches to your calendar</a></p></section>
${ledgerHTML(ledgerBy('team', t.slug), `${t.name} — old news`)}
<section><h2>Squad — ${r?.players.length ?? 0} players</h2>
<div class="tablewrap"><table class="roster"><thead><tr><th>#</th><th>Pos</th><th>Player</th><th>Born</th><th>Caps</th><th>Goals</th><th>Club</th></tr></thead><tbody>
${(r?.players ?? []).slice().sort((a, b) => a.no - b.no).map((p) => {
    const img = imgByName.get(`player:${p.name}`);
    return `<tr><td>${p.no}</td><td>${p.pos}</td><td class="player">${face(img, p.name)} ${nameLinkHTML('player', p.name, esc(p.name))}${p.captain ? ' <span class="cap">(c)</span>' : ''} ${attr(img)}</td><td>${p.dob}</td><td>${p.caps}</td><td>${p.goals}</td><td>${esc(p.club)}</td></tr>`;
  }).join('\n')}
</tbody></table></div>
<p class="muted">Roster: Wikipedia squads page, <a href="${rosters.source.permalink}" rel="noopener">pinned revision ${rosters.source.revid}</a> (<a href="${rosters.source.license_url}" rel="noopener">CC BY-SA 4.0</a>). Photos: Wikimedia Commons — hover ⓘ for author &amp; license; players without a free-licensed photo get initials, never a near-match.</p></section>`;
  // teamscope rule: decorative art = kit tokens (--k1/--k2, theme-invariant);
  // text accents/rings = audited ui.onLight/onDark per theme (--t1-l/--t1-d).
  const t1l0 = tcol?.onLight ?? tcol?.primary, t1d0 = tcol?.onDark ?? tcol?.primary;
  const t1l = tcol && cRatio(t1l0, '#f6f7f4') >= 4.5 ? t1l0 : '#0b7c38';   // WCAG AA contrast floor
  const t1d = tcol && cRatio(t1d0, '#1a1f2b') >= 4.5 ? t1d0 : '#2ee06f';
  const wrapped = tcol
    ? `<div class="teamscope" style="--k1:${tcol.primary};--k2:${visBase(tcol.secondary)};--t1-l:${t1l};--t1-d:${t1d};--t2-l:${tcol.secondary};--on-t1-l:#fff;--on-t1-d:#0b0e14">${body}</div>`
    : body;
  writeFileSync(`dist/teams/${t.slug}.html`, page(`${t.name} — squad & fixtures`, 'teams', wrapped, { og: `/brand/og/${t.slug}-og.png`, path: `/teams/${t.slug}` }));
}

// ---------- groups (tables from football-data's own standings, never local tiebreaker math) ----------
{
  const fdStandings = liveState?.standings ?? null;
  const fdNorm = new Map([['South Korea', 'Korea Republic'], ['Czech Republic', 'Czechia'], ['Turkey', 'Türkiye'], ['Ivory Coast', "Côte d'Ivoire"], ['Iran', 'IR Iran'], ['Cape Verde', 'Cabo Verde'], ['DR Congo', 'Congo DR'], ['United States', 'USA'], ['Bosnia-Herzegovina', 'Bosnia and Herzegovina'], ['Curacao', 'Curaçao']]);
  const groups = [...new Set(teamsData.map((t) => t.group))];
  const fdTableFor = (g) => {
    const fdG = fdStandings?.find((s) => (s.group ?? '').endsWith(`_${g}`) || s.group === `Group ${g}`);
    return fdG?.table?.length && fdG.table.some((r) => r.playedGames > 0) ? fdG.table : null;
  };
  const drawCard = (g) => {
    const gTeams = teamsData.filter((t) => t.group === g);
    const fx = matches.filter((m) => m.stage === 'group' && m.group === g).sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
    const first = fx[0];
    const v = first ? venues.get(first.venue_id) : null;
    return `<div class="gcard">
<div class="g-head"><span class="g-letter" aria-hidden="true">${g}</span><div>
<div class="flags">${gTeams.map((t) => fchip(t.name, 'lg')).join(' ')}</div>
<p class="kicker" style="margin-top:.45rem">FIRST MATCH · <b>${first ? etDate(first.kickoff_utc).toUpperCase() : 'TBD'}</b>${v ? ` · ${esc(v.common_name).toUpperCase()}` : ''}</p>
</div></div>
<ul class="g-fixtures num">
${fx.map((m) => `<li><span class="when">${etDate(m.kickoff_utc).toUpperCase()}</span><span style="flex:1">${fchip(m.home.team)} <a class="team" href="${matchURL(m)}">${esc(m.home.team)} — ${esc(m.away.team)}</a> ${fchip(m.away.team)}</span><span class="muted num">${et(m.kickoff_utc)} ET</span></li>`).join('\n')}
</ul>
<p class="g-foot">${gTeams.map((t) => teamLink(t.name)).join(' · ')}</p>
</div>`;
  };
  const standingsCard = (g, table) => `<div class="gcard">
<div class="g-head"><span class="g-letter" aria-hidden="true">${g}</span><div>
<div class="kicker">STANDINGS · <b>FROM FOOTBALL-DATA.ORG</b></div>
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
<p class="g-foot">Top two advance · <span style="color:var(--amber);font-weight:600">third place</span> may advance among the 8 best thirds · as of the last bake</p>
</div>`;
  const body = `
<section class="hero small"><h1>Groups</h1>
<p class="sub">${fdStandings ? 'Standings from football-data.org official tables — never computed locally.' : 'No matches played yet — each group renders as its draw and fixtures; standings fill in from official tables (football-data.org), never local math.'}</p></section>
${groups.map((g) => {
    const table = fdTableFor(g);
    return `<section id="group-${g}"><h2>Group ${g}</h2><div class="groups2">${drawCard(g)}${table ? standingsCard(g, table) : ''}</div>${ledgerHTML(ledgerBy('group', g), `Group ${g} — old news`)}</section>`;
  }).join('\n')}
<p class="muted">Top two per group + the 8 best third-placed teams reach the Round of 32.</p>`;
  writeFileSync('dist/groups.html', page('Groups', 'groups', body, { path: '/groups' }));
}

// ---------- venues ----------
{
  const body = `
<h1>Venues — 16 stadiums, 3 countries</h1>
<div class="cards">${venuesDoc.venues.map((v) => {
    const ms = matches.filter((m) => m.venue_id === v.id);
    return `<article class="match-card"><div class="teams"><strong>${esc(v.common_name)}</strong></div><div class="meta">FIFA name: ${esc(v.fifa_name)} · ${esc(v.locality)}${v.locality !== v.city ? ` (${esc(v.city)})` : ''}, ${v.country} · ${ms.length} matches</div><div class="chips">${ms.slice(0, 6).map((m) => `<a class="chip link" href="${matchURL(m)}">#${m.match_no}</a>`).join('')}${ms.length > 6 ? `<span class="chip">+${ms.length - 6}</span>` : ''}</div></article>`;
  }).join('\n')}</div>
<p class="muted">Names per fixturedownload (FIFA) and Wikipedia pinned rev 1358650246 (common).</p>`;
  writeFileSync('dist/venues.html', page('Venues', 'teams', body));
}

// ---------- calendar page + ICS ----------
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
{
  const byDate = new Map();
  for (const m of matches) {
    const d = etDateLong(m.kickoff_utc);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(m);
  }
  const body = `
<h1>Calendar</h1>
<p>Subscribe: <a href="/ics/all.ics">all 104 matches (.ics)</a> or any team from its page.</p>
${[...byDate].map(([d, ms]) => `<h2>${d}</h2><ul class="fixtures">${ms.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc)).map((m) => `<li><span class="local-time" data-utc="${m.kickoff_utc}">${et(m.kickoff_utc)} ET</span> — <a href="${matchURL(m)}">${m.home.team ?? m.home.placeholder_text} vs ${m.away.team ?? m.away.placeholder_text}</a> ${chip(m)}</li>`).join('')}</ul>`).join('\n')}`;
  writeFileSync('dist/calendar.html', page('Calendar', 'calendar', body, { path: '/calendar' }));
}

// ---------- watch + como-ver ----------
{
  const t = bcastDoc.totals;
  const body = `
<h1>How to watch every match (US)</h1>
<section class="hero small"><p class="free-callout">📡 With a <strong>$20 TV antenna</strong>: <strong>${t.FOX} matches free on FOX</strong> (every match from the Round of 16 on, all USMNT group games) and <strong>${t.Telemundo} free in Spanish on Telemundo</strong>.</p></section>
<h2>English</h2>
<table class="watch">
<tr><th>FOX 📡</th><td><strong>${t.FOX} matches, free over the air.</strong> Also on all live-TV services. <a href="https://www.foxsports.com/soccer/fifa-world-cup/schedule" rel="noopener">Schedule</a></td></tr>
<tr><th>FS1</th><td>${t.FS1} matches — pay TV, or <strong>FOX One</strong> ($19.99/mo, 7-day free trial, all 104 in 4K — <a href="/sources#streaming">source</a>), or a live-TV service free trial (lengths vary)</td></tr>
<tr><th>Tubi (free)</th><td>Opening ceremony + the opener + USA–Paraguay (Jun 12) live in 4K, no account — <a href="https://corporate.tubitv.com/press/tubi-launches-2026-fifa-world-cup-fox-hub/" rel="noopener">announcement</a></td></tr>
</table>
<h2>Español</h2>
<table class="watch">
<tr><th>Telemundo 📡</th><td><strong>${t.Telemundo} partidos gratis</strong> por aire; App de Telemundo gratis sin login junio 11–13</td></tr>
<tr><th>Universo</th><td>${t.Universo} partidos (TV de paga)</td></tr>
<tr><th>Peacock</th><td>Los 104 en español — Premium $10.99/mes</td></tr>
</table>
<h2 id="ca-mx">Canada &amp; Mexico</h2>
<table class="watch">
<tr><th>🇨🇦 Canada</th><td>TSN (EN) / RDS (FR) carry all 104 (pay). <strong>CTV airs 44 free over the air</strong>: 27 group games incl. all three Canada matches, 6 of the Round of 32, 4 of the Round of 16, then everything from the quarter-finals on except the third-place match. Crave streams the CTV feed; TSN's YouTube streams the first 10 minutes of every match free.</td></tr>
<tr><th>🇲🇽 México</th><td><strong>32 partidos gratis</strong> en TV abierta (Canal 5 / Las Estrellas y Azteca 7 / Azteca UNO); ViX transmite los 104 (Pase Mundial $999 MXN, acceso jun 11 – jul 19).</td></tr>
</table>
<p class="muted">Every row above is sourced — see <a href="/sources">/sources</a>. Totals reflect June 2026 listings; Fox's January announcement said 70/34 and two matches have since moved to FOX (<a href="/sources#discrepancies">documented</a>). <a href="/como-ver">Versión en español →</a></p>`;
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
<h1>${title}</h1>
<p class="muted">Every role verified ${doc.verified_at} against official sources; photos from Wikimedia Commons with per-file attribution (hover ⓘ).</p>
<div class="tablewrap"><table class="sched"><thead><tr><th>Name</th><th>Role</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>
${tbd.length ? `<p class="muted">Honestly unresolved: ${tbd.map((p) => `${esc(p.role)} — no public holder verifiable as of June 2026`).join('; ')}.</p>` : ''}
<p class="muted">Editorial, non-commercial content. No FIFA or federation marks are used.</p>`;
  writeFileSync(`dist/people/${file}.html`, page(title, 'teams', body));
}

// ---------- humans leaderboard ----------
if (lbDoc) {
  const totalPts = lbDoc.entries.reduce((a, e) => a + e.pts, 0);
  const anyScored = lbDoc.entries.some((e) => e.scored > 0);
  const body = `
<h1>Predictions leaderboard</h1>
<p>Every signed-in fan can <a href="/schedule">predict the score of any match</a> until kickoff, then it locks. <strong>3 points</strong> for the exact score, <strong>1 point</strong> for the right outcome — scored only on <em>confirmed</em> finals and recomputed deterministically on every update, never hand-edited.</p>
${lbDoc.entries.length === 0 ? `<p class="muted">No predictions yet — be the first: open any upcoming <a href="/schedule">match page</a> and sign in.</p>` : `
<table class="watch">
<tr><th>#</th><th>Predictor</th><th>Bets</th><th>Scored</th><th>Exact (3 pts)</th><th>Outcome (1 pt)</th><th>Points</th></tr>
${lbDoc.entries.map((e, i) => `<tr><th>${i + 1}</th><td>${esc(e.name)}</td><td>${e.bets}</td><td>${e.scored}</td><td>${e.exact}</td><td>${e.outcome}</td><td><strong>${e.pts}</strong></td></tr>`).join('\n')}
</table>
${!anyScored ? `<p class="muted">${lbDoc.entries.length} predictor${lbDoc.entries.length === 1 ? '' : 's'} in — points appear once the first match reaches a confirmed final score${totalPts === 0 ? '' : ''}.</p>` : ''}`}
<h2>How the machines are doing</h2>
<p>Four frontier AI models run their own bragging-rights league on every match — see the <a href="/ai-league">AI prediction league</a>.</p>
<p class="muted footnote">Predictors appear as first name + last initial from their sign-in name; locked and deleted accounts are excluded. Predictions lock at kickoff and are never edited after. As of <code>${esc(lbDoc.as_of ?? '')}</code> · <a href="/about">privacy</a></p>`;
  writeFileSync('dist/leaderboard.html', page('Leaderboard', 'lb', body, { path: '/leaderboard', desc: 'Fan prediction standings for every 2026 World Cup match — 3 points exact, 1 point outcome, locked at kickoff.' }));
}

// ---------- AI prediction league standings ----------
if (aiDoc) {
  const finished = new Map(matches.filter((m) => m.status === 'finished_confirmed' && m.score).map((m) => [m.match_no, m.score]));
  const rows = aiDoc.predictions;
  const standings = AI_ORDER.map((p) => {
    const bets = rows.filter((r) => r.provider === p);
    let exact = 0, outcome = 0, scoredN = 0;
    for (const b of bets) {
      const s = finished.get(b.match_no);
      if (!s) continue;
      scoredN++;
      if (s.home === b.home && s.away === b.away) exact++;
      else if (Math.sign(s.home - s.away) === Math.sign(b.home - b.away)) outcome++;
    }
    return { p, model: bets[0]?.model ?? '—', bets: bets.length, scoredN, exact, outcome, pts: exact * 3 + outcome };
  }).sort((a, b) => b.pts - a.pts || b.bets - a.bets);
  const withPicks = matches.filter((m) => aiByMatch.has(m.match_no));
  const pickOf = (n, p) => {
    const r = (aiByMatch.get(n) ?? []).find((x) => x.provider === p);
    return r ? `${r.home}–${r.away}` : '<span class="muted">—</span>';
  };
  const body = `
<h1>The AI prediction league</h1>
<p>Four frontier AI models — Claude, ChatGPT, Gemini, and Grok — predict the full-time score of every match <strong>before kickoff</strong>. Virtual bragging rights only: no real money, no odds, no betting links. Picks are locked the moment they're made; an AI that misses a match scores zero and is never backfilled.</p>
<h2>Standings</h2>
<table class="watch">
<tr><th>AI</th><th>Model</th><th>Bets placed</th><th>Matches scored</th><th>Exact (3 pts)</th><th>Outcome (1 pt)</th><th>Points</th></tr>
${standings.map((s) => `<tr><th>${aiLabel(s.p)}</th><td><code>${esc(s.model)}</code></td><td>${s.bets}</td><td>${s.scoredN}</td><td>${s.exact}</td><td>${s.outcome}</td><td><strong>${s.pts}</strong></td></tr>`).join('\n')}
</table>
${finished.size === 0 ? `<p class="muted">No matches have a confirmed final score yet — points appear as results are confirmed (never on provisional scores).</p>` : ''}
<h2>Scoring</h2>
<p><strong>3 points</strong> for the exact score · <strong>1 point</strong> for the right outcome (winner or draw) · scored only on <em>confirmed</em> finals, recomputed deterministically on every bake — never hand-edited.</p>
<h2>Every pick</h2>
<table class="watch">
<tr><th>Match</th><th>Kickoff (ET)</th>${AI_ORDER.map((p) => `<th>${aiLabel(p)}</th>`).join('')}<th>Result</th></tr>
${withPicks.map((m) => `<tr><th><a href="/matches/${m.match_no}">${esc(m.home.team)} v ${esc(m.away.team)}</a></th><td>${etDateLong(m.kickoff_utc)}</td>${AI_ORDER.map((p) => `<td>${pickOf(m.match_no, p)}</td>`).join('')}<td>${m.status === 'finished_confirmed' && m.score ? `<strong>${m.score.home}–${m.score.away}</strong>` : '<span class="muted">—</span>'}</td></tr>`).join('\n')}
</table>
<p class="muted footnote">All picks are AI-generated (each row records its exact model id) and timestamped in our database before kickoff; gaps mean that AI had no working API access before the match locked. Predictions as of <code>${esc(aiDoc.as_of ?? '')}</code> · raw data: <a href="/data/ai.json">/data/ai.json</a> · <a href="/sources">sources &amp; integrity</a></p>`;
  writeFileSync('dist/ai-league.html', page('AI prediction league', 'ai', body, { path: '/ai-league', desc: 'Claude, ChatGPT, Gemini, and Grok predict every 2026 World Cup match before kickoff — a virtual bragging-rights league.' }));
}

// ---------- sources + about + 404 ----------
{
  const open = discrepancies.open ?? [];
  const resolved = discrepancies.resolved ?? [];
  const body = `
<h1>Sources &amp; data integrity</h1>
<p>Everything on this site traces to a source. Datasets and their audits live in the project repository.</p>
<h2 id="streaming">Streaming prices &amp; trials (US)</h2>
<ul>
<li><strong>FOX One</strong> — $19.99/mo, 7-day free trial, all 104 matches in 4K: <a href="https://variety.com/2026/shopping/news/how-to-watch-fox-sports-online-free-1236762221/" rel="noopener">Variety</a> + <a href="https://www.tomsguide.com/entertainment/sports/how-to-watch-the-world-cup-2026-in-4k" rel="noopener">Tom's Guide</a> (verified 2026-06-09)</li>
<li><strong>Peacock Premium</strong> — $10.99/mo, all 104 in Spanish: <a href="https://www.nbcsports.com/soccer/news/how-to-watch-the-2026-world-cup-live-stream-link-tv-channel-dates-full-details" rel="noopener">NBC Sports</a> (verified 2026-06-09)</li>
<li><strong>Tubi</strong> — free 4K stream for the opener and USA–Paraguay: <a href="https://corporate.tubitv.com/press/tubi-launches-2026-fifa-world-cup-fox-hub/" rel="noopener">Tubi press release</a> (verified 2026-06-09)</li>
<li>Live-TV service trial lengths change frequently — we link, we don't pin numbers.</li>
</ul>
<h2>Sources of record</h2>
<table class="watch">
<tr><th>Schedule</th><td><a href="https://github.com/openfootball/worldcup.json" rel="noopener">openfootball</a> (public domain) cross-checked per match against <a href="https://fixturedownload.com/feed/json/fifa-world-cup-2026" rel="noopener">fixturedownload</a></td></tr>
<tr><th>Rosters</th><td>Wikipedia "2026 FIFA World Cup squads", <a href="${rosters.source.permalink}" rel="noopener">pinned revision ${rosters.source.revid}</a> (CC BY-SA 4.0), audited against the official FIFA squad-lists PDF</td></tr>
<tr><th>US TV</th><td>Per-match from <a href="https://www.sportsmediawatch.com/tv-schedules/fifa-world-cup-tv-schedule/" rel="noopener">Sports Media Watch</a> ⨯ <a href="https://www.foxsports.com/soccer/fifa-world-cup/schedule" rel="noopener">FOX Sports</a>; Spanish split per <a href="https://www.nbcsports.com/soccer/news/how-to-watch-the-2026-world-cup-live-stream-link-tv-channel-dates-full-details" rel="noopener">NBC</a> (92/12 — matches exactly)</td></tr>
<tr><th>Photos</th><td>Wikimedia Commons only, matched by Wikidata QID, license-allowlisted (PD/CC0/CC BY/CC BY-SA), attributed per image</td></tr>
</table>
<h2 id="discrepancies">Documented discrepancies</h2>
<p class="muted">When sources disagree we say so — we never silently pick.</p>
<ul>
${resolved.map((d) => `<li><strong>Match ${d.match_no} kickoff</strong>: ${esc(d.note)} — resolved ${d.rule} (<a href="${d.tiebreaker_url}" rel="noopener">tiebreaker</a>)</li>`).join('\n')}
${open.map((d) => `<li><strong>${esc(d.id)}</strong> (${d.severity}): ${esc(d.value_a)} vs ${esc(d.value_b)}. ${esc(d.resolution)}</li>`).join('\n')}
</ul>
<p class="muted">Unverifiable facts render as TBD — never a guess. Scores carry "as of" stamps and a provisional state until confirmed.</p>`;
  writeFileSync('dist/sources.html', page('Sources', 'watch', body));

  const about = `
<h1>About Golazo 26</h1>
<p>An independent, ad-free, non-commercial fan guide to the 2026 World Cup, built so anyone can answer one question in one click: <em>when is the match, and how do I watch it — free if possible?</em></p>
<ul>
<li><strong>Independence</strong>: not affiliated with FIFA, any federation, broadcaster, or sponsor. No FIFA marks, emblems, mascots, or federation crests are used. Editorial mentions of the tournament are exactly that — editorial.</li>
<li><strong>Licenses</strong>: roster text derives from Wikipedia under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a> (pinned revisions, linked on each page). Photos are from Wikimedia Commons under their per-file licenses, attributed where shown (hover ⓘ). Flags are self-hosted <a href="https://github.com/jdecked/twemoji" rel="noopener">Twemoji</a> artwork (CC BY 4.0, pinned v15.1.0). Site code: MIT.</li>
<li><strong>Honesty</strong>: every fact carries a source (<a href="/sources">/sources</a>); unverifiable data shows TBD; scores are stamped "as of" and marked provisional until confirmed — never marketed as live.</li>
<li><strong>Brand graphics</strong>: the Golazo 26 mark, doodles, hero art, and share-image compositions are original works of this project (MIT/CC0) — no FIFA or federation marks anywhere. Team banners and flag chips render the country's actual flag from pinned <a href="https://github.com/jdecked/twemoji" rel="noopener">Twemoji</a> artwork (CC BY 4.0, self-hosted), with kit palettes human-audited. Display typeface: Barlow Condensed (<a href="https://openfontlicense.org" rel="noopener">OFL</a>).</li>
<li><strong>Editorial integrity</strong>: I write the prose on this site from its own sourced data, and the build cross-checks every piece so that each name and number in it traces back to that data — anything that doesn't is flagged and the piece is held, never shown. I read and approve every team outlook and match preview before it publishes. Match recaps are assembled at the final whistle from the confirmed result and the sourced goalscorers, and one only publishes once it clears that check: a recap is held until its scorers are sourced, and a recap that fails the check is held back rather than shown. Separately, the <a href="/ai-league">AI prediction league</a> is a clearly-labeled contest in which four AI models guess every match before kickoff — that league is the only place AI picks appear, and they are bragging-rights fun, never editorial fact.</li>
${clerkPub ? `<li><strong>Privacy</strong>: this site sets no cookies and runs no trackers or ads. Match predictions use sign-in accounts; your name and email are stored in our own database via the auth provider (Clerk) so your account stays portable. The public leaderboard shows only your first name and last initial. To delete your account, open your profile from the sign-in menu and choose delete — your name, email and predictions are removed from our database within minutes of the request and reconciled daily, and you drop off the leaderboard within a day. Full details: <a href="/privacy">privacy policy</a>.</li>` : `<li><strong>Privacy</strong>: this site sets no cookies, runs no trackers or ads, and <strong>collects no personal data</strong> — there are no accounts and nothing about you is stored. (If match predictions are enabled later, sign-in accounts are introduced; this notice and the <a href="/privacy">privacy policy</a> are updated accordingly.)</li>`}
</ul>
<p class="muted">Built by a fan. Contact: via the repository.</p>`;
  writeFileSync('dist/about.html', page('About', 'watch', about));

  // /privacy — dedicated privacy policy: names the controller + processors, legal basis,
  // retention, and DSAR/CCPA deletion. Honest about whether predictions (hence accounts) are live.
  const privacy = `
<h1>Privacy policy</h1>
<p class="muted">Last updated ${esc(AS_OF)}. Golazo 26 is an independent, ad-free, non-commercial fan project.</p>
<h2>Who runs this site</h2>
<p>Golazo 26 is operated by an individual (the "controller"). Privacy or data requests: <a href="https://github.com/onwike/worldcup2026/issues" rel="noopener">open a GitHub issue</a> or email the contact listed on the repository.</p>
<h2>What we collect</h2>
${clerkPub ? `<p>The public pages set <strong>no cookies and run no trackers, analytics, or ads</strong>. The only personal data we process is for the optional <strong>match-predictions</strong> feature, which requires sign-in:</p>
<ul>
<li><strong>Account</strong>: your name and email address, to identify your account and show it back to you.</li>
<li><strong>Predictions</strong>: the scores you submit, linked to your account id.</li>
<li>The public leaderboard displays only your <strong>first name + last initial</strong> — never your email.</li>
</ul>` : `<p>This site sets <strong>no cookies</strong> and runs <strong>no trackers, analytics, or ads</strong>, and <strong>collects no personal data</strong>. There are no user accounts and nothing about you is stored. (If the optional match-predictions feature is enabled in future it introduces sign-in accounts; this policy is updated before that happens.)</p>`}
<h2>Processors we use</h2>
<ul>
<li><strong>Cloudflare</strong> — hosting and edge delivery (static site, Workers, and the D1 database where ${clerkPub ? 'account and prediction data live' : 'tournament data lives'}). Subject to Cloudflare's privacy terms.</li>
${clerkPub ? `<li><strong>Clerk</strong> — authentication; Clerk stores your name and email and sends sign-in emails. We keep our own portable copy (name + email) so the auth vendor is replaceable. Subject to Clerk's privacy terms.</li>` : ''}
</ul>
<h2>Legal basis &amp; retention</h2>
${clerkPub ? `<p>We process account and prediction data on the basis of your <strong>consent</strong>, given when you sign in. We retain it until you delete your account, after which your name, email, and predictions are removed from our database within minutes of the request and reconciled daily.</p>` : `<p>No personal data is processed, so no retention applies to visitors. Tournament content derives from cited public sources (see <a href="/sources">/sources</a>).</p>`}
<h2>Your rights (GDPR / CCPA)</h2>
<p>You may request access to, correction of, or deletion of your personal data.${clerkPub ? ' To delete everything immediately: open your profile from the sign-in menu and choose <strong>delete</strong> — this erases your account and predictions.' : ''} For any access/deletion request, <a href="https://github.com/onwike/worldcup2026/issues" rel="noopener">contact us via the repository</a>.</p>
<h2>Photos &amp; attribution</h2>
<p>Player and staff photos are reused from Wikimedia Commons and other free-licensed sources under their per-file licenses, with attribution shown on each image. We honor takedown and personality-rights requests — use the contact above.</p>`;
  writeFileSync('dist/privacy.html', page('Privacy', 'watch', privacy, { path: '/privacy', desc: 'Golazo 26 privacy policy — what we collect, processors, retention, and how to request deletion.' }));
  writeFileSync('dist/robots.txt', 'User-agent: *\nAllow: /\n');

  // ---------- History Hub: /history timeline + 22 edition pages ----------
  if (historyOK) {
    // editorial era framing (chapter titles, not factual claims) over the 22 editions
    const ERAS = [
      ['The founding finals · 1930s', [1930, 1934, 1938]],
      ['Postwar revival · 1950s', [1950, 1954, 1958]],
      ['Brazil ascendant · 1960s', [1962, 1966, 1970]],
      ['Total football & shootouts · 1970s–80s', [1974, 1978, 1982, 1986]],
      ['The global game · 1990s–2000s', [1990, 1994, 1998, 2002]],
      ['The modern era · 2006–2022', [2006, 2010, 2014, 2018, 2022]],
    ];
    const years = ERAS.flatMap(([, ys]) => ys);
    const editions = new Map(years.map((y) => [y, load(`data/history/${y}.json`)]));
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
    const timeline = ERAS.map(([label, ys]) =>
      `<div class="era"><b>${esc(label)}</b></div>\n${ys.map(tnode).join('\n')}`).join('\n');
    const hubBody = `
<section class="hubhero">
  <p class="kicker"><b>1930 ${dash} 2022</b> · 22 TOURNAMENTS · ONE TROPHY</p>
  <h1>History of the<br>World Cup</h1>
  <p class="sub">Ninety-six years of football's greatest tournament — every edition, every champion, the road to 2026.</p>
</section>
<section class="prose" style="max-width:720px;margin:.5rem auto 0">${mdLite(historyHub.prose)}</section>
<nav class="tl" aria-label="World Cup editions, 1930 to 2022">
${timeline}
</nav>
<p class="muted" style="text-align:center;max-width:680px;margin:1.4rem auto 0">Every edition page draws on cited sources; the result, host and individual awards on each card are taken verbatim from that edition's referenced write-up. A blank field means the cited sources don't state it — never a guess.</p>`;
    mkdirSync('dist/history', { recursive: true });
    writeFileSync('dist/history.html', page('History of the World Cup', 'history', hubBody, {
      desc: 'Every FIFA World Cup from 1930 to 2022 — champions, hosts and the stories of each tournament, on the road to 2026.',
      path: '/history',
    }));

    // edition pages
    const fcell = (k, v) => v ? `<div class="fcell"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>` : '';
    for (let i = 0; i < years.length; i++) {
      const y = years[i];
      const ed = editions.get(y);
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
  <p class="kicker"><a href="/history" style="color:var(--muted)">← All editions</a></p>
  <h1>${esc(ed.title)}</h1>
</section>
${f.champion ? `<div class="fin"><span class="champ"><span class="crown" aria-hidden="true">★</span> ${esc(f.champion)}</span>${f.runner_up ? `<span class="vsline">${f.final_score ? `${esc(f.final_score)} ` : ''}def. ${esc(f.runner_up)}</span>` : ''}</div>` : ''}
<div class="frail">${rail}</div>
<section class="prose" style="max-width:720px">${mdLite(ed.prose)}</section>
<nav class="editnav" aria-label="Adjacent editions">
  ${prev ? `<a href="/history/${prev}">← ${prev}</a>` : '<span></span>'}
  ${next ? `<a href="/history/${next}">${next} →</a>` : '<span></span>'}
</nav>
<section class="prose" style="max-width:720px"><h2>Sources</h2><ul>${srcs}</ul>
<p class="muted footnote">Adapted under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a> from the cited sources. Result, host and awards above are extracted verbatim from the referenced write-up; a blank field means the sources don't state it. <a href="https://github.com/onwike/golazo26/issues/new?title=History%20correction:%20${y}">Report an error</a>.</p></section>`;
      writeFileSync(`dist/history/${y}.html`, page(`${ed.title}`, 'history', body, {
        desc: `${ed.title}: ${f.champion ? `${f.champion} champions${f.host ? `, hosted by ${f.host}` : ''}.` : 'World Cup edition.'} The full story, with sources.`,
        path: `/history/${y}`,
      }));
    }
    console.log(`history hub: 1 timeline + ${years.length} edition pages`);
  }

  writeFileSync('dist/404.html', page('Not found', 'home', `<svg class="doodle" width="96" height="96" aria-hidden="true"><use href="/brand/doodles.svg#d-ball"/></svg><h1>Lost the ball</h1><p>That page doesn't exist. Try the <a href="/schedule">schedule</a> or <a href="/">today's matches</a>.</p>`, { path: '/404' }));
}

// ---------- player & coach profile pages ----------
function proseFooter(p) {
  const spine = p.sheet.spine_source ?? { revid: rosters.source.revid, permalink: rosters.source.permalink };
  const asOf = (p.sheet.fetched_at ?? '').slice(0, 10);
  return `<p class="muted footnote"><strong>Facts as of ${esc(asOf)}</strong> (pinned sources; later events are not reflected). Adapted under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a> from the sources below. Career narrative: <a href="${p.sheet.permalink}" rel="noopener">Wikipedia, pinned revision ${p.sheet.revid}</a>. Squad number, caps &amp; goals: <a href="${spine.permalink}" rel="noopener">squads page, pinned revision ${spine.revid}</a> + audited tournament data. Content hash <code>${p.sheet.content_hash}</code>. <a href="https://github.com/onwike/golazo26/issues/new?title=Correction:%20${encodeURIComponent(p.name)}">Report an error</a>.</p>`;
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
<h1 class="matchup">${faceHTML(img, p.name, 56)} ${esc(p.name)}</h1>
<p class="meta">${statLine}</p>
${galleryHTML(img, galleryByName.get(`${subjType}:${p.name}`), p.name)}
<section class="prose">${p.text.split(/\n\n+/).map((par) => `<p>${esc(par)}</p>`).join('')}</section>
${proseFooter(p)}`;
    const dir = p.kind === 'player' ? 'players' : 'people';
    writeFileSync(`dist/${dir}/${p.slug}.html`, page(`${p.name} — profile`, 'teams', body, { desc: `${p.name}: verified profile for the 2026 World Cup.` }));
  }
}

// ---------- data endpoints ----------
mkdirSync('dist/data', { recursive: true });
writeFileSync('dist/data/matches.json', JSON.stringify({ as_of: AS_OF, matches: matches.map((m) => ({ n: m.match_no, stage: m.stage, group: m.group, kickoff_utc: m.kickoff_utc, venue: venues.get(m.venue_id).common_name, home: m.home.team ?? m.home.placeholder_text, away: m.away.team ?? m.away.placeholder_text, us_tv: bcast.get(m.match_no) ? `${bcast.get(m.match_no).us_english}/${bcast.get(m.match_no).us_spanish}` : 'TBD' })) }));
writeFileSync('dist/data/live.json', JSON.stringify({ as_of: new Date().toISOString(), matches: matches.map((m) => ({ n: m.match_no, status: m.status, score: m.score, k: m.kickoff_utc })), ai_n: aiDoc?.predictions?.length ?? 0, lb_sig: liveState?.lb_sig ?? '', st_sig: liveState?.st_sig ?? '' }));
if (aiDoc) writeFileSync('dist/data/ai.json', JSON.stringify(aiDoc));
writeFileSync('dist/data/config.json', JSON.stringify({ as_of: new Date().toISOString(), flags: { api_read_only: false, ai_halted: false, bake_paused: false }, version: 'v1' }));

// ---------- guards ----------
let fileCount = 0;
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(`${d}/${f.name}`) : fileCount++; };
walk('dist');
// EFFICIENCY: fail well BELOW the free-tier 20k static-asset/version cap so growth
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
