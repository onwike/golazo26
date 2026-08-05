// i18n-blocks.mjs — the ONE source of Tier-2 prose block units for the corpus scopes
// (the prose swap mechanism and the Tier-2 fragment rows).
//
// The correctness contract this module exists for: the English text the corpus
// extractor emits for a block MUST be byte-identical to the text build.mjs hashes
// when stamping data-i18n-block ids — otherwise a translated fragment can never
// match a stamped id and every block silently degrades to English. So the block-unit
// assembly lives HERE, once: build.mjs consumes these exact strings when it stamps
// and bakes the history/about pages, and scripts/extract-i18n-corpus.mjs serializes
// the same strings into data/i18n/corpus/<scope>.json. Byte-identity is pinned
// against a REAL bake by test/i18n-fragments.test.mjs (round-trip, both directions).
//
// unit id = first 12 hex of sha256 of the unit's English text (the a later change i18nBlock
// convention; run-i18n.mjs unitId computes the same). Paths are cwd-relative like
// every other lib loader — callers run from the repo (or an isolated bake dir).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { S } from './strings.mjs';
import { esc, mdLite } from './render.mjs';

export const blockId = (html) => createHash('sha256').update(html).digest('hex').slice(0, 12);
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Editorial era framing for the history hub (chapter titles, not factual claims).
// Lives here (not build.mjs) because the flatMap of its years IS the edition-page
// route list — the corpus and the bake must derive it from the same constant.
export const HISTORY_ERAS = [
  ['The founding finals · 1930s', [1930, 1934, 1938]],
  ['Postwar revival · 1950s', [1950, 1954, 1958]],
  ['Brazil ascendant · 1960s', [1962, 1966, 1970]],
  ['Total football & shootouts · 1970s–80s', [1974, 1978, 1982, 1986]],
  ['The global game · 1990s–2000s', [1990, 1994, 1998, 2002]],
  ['The modern era · 2006–2022', [2006, 2010, 2014, 2018, 2022]],
];

// history scope — null when the history dataset is absent (mirrors build.mjs historyOK).
// Returns the swap-unit HTML pieces build.mjs bakes verbatim: the mdLite-rendered hub
// prose, the per-edition mdLite-rendered prose (keyed by year), and the loaded edition
// docs (so build.mjs reads title/sources from the same single load).
export function historyBlocks() {
  if (!existsSync('data/history/facts.json') || !existsSync('data/history/hub.json')) return null;
  const years = HISTORY_ERAS.flatMap(([, ys]) => ys);
  const docs = new Map(years.map((y) => [y, load(`data/history/${y}.json`)]));
  return {
    years,
    hubProse: mdLite(load('data/history/hub.json').prose),
    editionProse: new Map(years.map((y) => [y, mdLite(docs.get(y).prose)])),
    docs,
  };
}

// about scope — the ordered block texts of /about (all strings.mjs values; the privacy
// bullet follows the same data/clerk-public.json presence gate build.mjs uses).
export function aboutBlocks(clerkPub) {
  const A = S.pages.about;
  return {
    intro: A.intro,
    bullets: [A.independence, A.licenses, A.honesty, A.brandGraphics, A.editorialIntegrity,
      clerkPub ? A.privacyAccounts : A.privacyNoAccounts],
    contact: A.contact,
  };
}

// stadiums scope — null when the stadiums dataset is absent (mirrors build.mjs stadiumsOK).
// Returns the swap-unit HTML pieces build.mjs bakes verbatim on /stadiums + the 16 venue
// pages: the mdLite-rendered hub prose, and per-venue city/stadium prose (each with its
// facts-sheet fallback — the SAME assembly build.mjs used to inline, moved here so the
// corpus extractor serializes byte-identical English). Also returns the loaded rail,
// facts sheets and prose docs so build.mjs reads iconic games / renovations / gaps /
// sources from the same single load. NOT swap units (data-driven, esc'd facts): the
// iconic-games and renovations lists, gaps, the pitch line, and the facts rail.
export function stadiumsBlocks() {
  if (!existsSync('data/stadiums/facts.json')) return null;
  const rail = load('data/stadiums/facts.json');
  const hub = existsSync('data/stadiums/hub.json') ? load('data/stadiums/hub.json') : null;
  const sheets = new Map(); // venue_id → <id>.facts.json (curated facts sheet)
  const proseDocs = new Map(); // venue_id → <id>.json (stadium prose doc) or null
  const cityHTML = new Map(); // venue_id → baked city-history swap-unit HTML ('' when no data)
  const stadHTML = new Map(); // venue_id → baked stadium-history swap-unit HTML ('' when no data)
  for (const r of rail.venues) {
    const id = r.venue_id;
    const cf = existsSync(`data/stadiums/${id}.facts.json`) ? load(`data/stadiums/${id}.facts.json`) : {};
    const pr = existsSync(`data/stadiums/${id}.json`) ? load(`data/stadiums/${id}.json`) : null;
    const cp = existsSync(`data/stadiums/cities/${id}.json`) ? load(`data/stadiums/cities/${id}.json`) : null;
    const ch = cf.city_history ?? {};
    sheets.set(id, cf);
    proseDocs.set(id, pr);
    cityHTML.set(id, cp?.prose ? mdLite(cp.prose) : [
      ch.founded ? `<p><b>Founded.</b> ${esc(ch.founded)}</p>` : '',
      ch.significance ? `<p>${esc(ch.significance)}</p>` : '',
      ch.football_culture ? `<p><b>Football culture.</b> ${esc(ch.football_culture)}</p>` : '',
    ].filter(Boolean).join('\n'));
    stadHTML.set(id, pr?.prose ? mdLite(pr.prose)
      : (Array.isArray(cf.stadium_history_facts) && cf.stadium_history_facts.length
          ? `<ul>${cf.stadium_history_facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''));
  }
  return { rail, hub, hubProse: hub?.prose ? mdLite(hub.prose) : '', sheets, proseDocs, cityHTML, stadHTML };
}

// NOTE — /people/fifa and /people/us-soccer bake NO body prose (name/role/source table rows
// plus S-valued notes already stamped via i18nBlock/i18nSpan — chrome tier) and need no scope.
// Person BIOS live on the /players/<slug> + /people/<slug> profile pages — the profiles
// scope below (the plan §3 per-team profile packs).

// ---------- profiles scope (Phase 2.5B registry + plan §3 per-team packs) ----------
// The deep-profile registry — moved here VERBATIM from scripts/build.mjs so the corpus
// extractor serializes byte-identical paragraph units from the same single assembly
// (the module's contract, above). build.mjs consumes {profiles, teamProse} for the pages.
//
// Prose shards (data/profiles/prose/*.json) pair with fact shards
// (data/profiles/facts/*.json). A profile page renders ONLY when a certified
// prose piece exists; names linkify only then. Slugs derive from the globally
// unique wiki_title (display names collide), with a build-time assert.
const slugify = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function profilesRegistry() {
  if (!existsSync('data/profiles/prose')) return null;
  const profiles = new Map(); // key `${kind}:${name}` -> {slug, kind, name, team, pack, text, meta, sheet}
  const teamProse = new Map(); // team name -> {text, meta, sheet}
  // Profile takedowns (privacy / right-to-be-forgotten): D1 `overrides` rows
  // (entity_type='profile', field='takedown', active=1), exported to data/takedowns.json by
  // poll-and-bake. A taken-down slug is dropped from the profiles map below — no page, no links:
  // the permanent removal. site/profile.js + /api/v1/takedowns cover the instant window between
  // the takedown and the next (forced) bake that purges the HTML.
  const takedowns = new Set((existsSync('data/takedowns.json') ? load('data/takedowns.json').slugs : []) || []);
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
  const proseFiles = readdirSync('data/profiles/prose').filter((f) => f.endsWith('.json') && !f.endsWith('.gate-a.json'));
  for (const f of proseFiles) if (dupShard(f)) { console.error(`⛔ duplicate-contaminated prose shard: data/profiles/prose/${f} — remove it`); process.exit(1); }
  // MECHANICAL WAVE GATE:
  // any prose shard beyond the wave-1 licensed set requires a passing review verdict
  // file, whose pass criterion must include >=1 fact provably suppressed via the TBD path.
  // The wave build halts without it — publication scaling is earned, never declared.
  const WAVE1_SHARDS = new Set(['usa.json', 'haiti.json', 'teams.json']);
  const waveShards = proseFiles.filter((f) => !WAVE1_SHARDS.has(f));
  if (waveShards.length) {
    const VF = 'data/profiles/certs/sparse-canary-gold.json';
    let v = null;
    try { v = load(VF); } catch { v = null; }
    const proof = v?.tbd_suppression_proof;
    const gateOK = v && /^gold/i.test(String(v.verdict ?? '')) && /pass/i.test(String(v.verdict ?? '')) && Array.isArray(proof) && proof.length >= 1 && proof.every((p) => p.subject && p.fact && p.evidence);
    if (!gateOK) {
      console.error(`⛔ wave gate: prose beyond wave-1 present (${waveShards.join(', ')}) but ${VF} is missing or invalid — requires a passing verdict and tbd_suppression_proof[] entries with {subject, fact, evidence}. Build halted.`);
      process.exit(1);
    }
  }
  for (const f of proseFiles) {
    const shard = load(`data/profiles/prose/${f}`);
    for (const [name, piece] of Object.entries(shard)) {
      if (name.startsWith('_') || !piece.text || (piece.published === false && process.env.PREVIEW_UNPUBLISHED !== '1')) continue;
      // hard publish-safety: a gate-failed / verbatim-flagged piece never renders,
      // even if its published flag was flipped true (defence in depth past the flip).
      if (piece.gate_a === 'fail' || piece.gate_a === 'fail-verbatim') continue;
      const sheet = sheetFor(name, f);
      if (!sheet) { console.error(`profile prose without fact sheet: ${name}`); continue; }
      if (sheet.kind === 'team') { teamProse.set(name, { text: piece.text, meta: piece, sheet }); continue; }
      const slug = slugify(sheet.wiki_title);
      if (takedowns.has(slug)) continue; // taken down (D1 override) — never bake the page, never link to it
      if (seenSlugs.has(slug) && seenSlugs.get(slug) !== name) { console.error(`⛔ slug collision: ${slug} (${name} vs ${seenSlugs.get(slug)})`); process.exit(1); }
      seenSlugs.set(slug, name);
      profiles.set(`${sheet.kind}:${name}`, { slug, kind: sheet.kind, name, team: sheet.team, text: piece.text, meta: piece, sheet });
    }
  }
  // Per-team pack id (plan §3): players + the coach of a team share ONE pack `t/<team-slug>`;
  // org people (officials — any kind that is not player/coach, or a team outside teams.json)
  // pool into `t/_org`. build.mjs stamps this exact id (data-i18n-pack) and the fragment bake
  // names dist/i18n/<lang>/<pack>.json from it — computed once HERE so they can never diverge.
  const teamSlugs = new Map(load('data/teams.json').teams.map((t) => [t.name, t.slug]));
  for (const p of profiles.values()) {
    p.pack = (p.kind === 'player' || p.kind === 'coach') && teamSlugs.has(p.team)
      ? `t/${teamSlugs.get(p.team)}` : 't/_org';
  }
  return { profiles, teamProse };
}

// The ONE paragraph split+escape both build.mjs (stamped bake) and the corpus serialize:
// each returned string is a paragraph's exact swap-unit innerHTML (build bakes
// `<p data-i18n-block="<id>">${html}</p>`; the client swaps that <p>'s innerHTML).
export const profileParagraphs = (text) => String(text).split(/\n\n+/).map((par) => esc(par));

// ---- corpus flatteners: [{ id, text, routes }] per scope (the shape
// extract-i18n-corpus.mjs writes and the build's fragment bake consumes) ----
const unit = (text, routes) => ({ id: blockId(text), text, routes });

export function historyUnits() {
  const hb = historyBlocks();
  if (!hb) return null;
  return [
    unit(S.pages.history.heroSub, ['history']),
    unit(hb.hubProse, ['history']),
    unit(S.pages.history.hubFootnote, ['history']),
    ...hb.years.map((y) => unit(hb.editionProse.get(y), [`history/${y}`])),
    unit(S.footnotes.historyEdition, hb.years.map((y) => `history/${y}`)), // the shared edition-footnote span
  ];
}

export function aboutUnits(clerkPub) {
  const ab = aboutBlocks(clerkPub);
  return [ab.intro, ...ab.bullets, ab.contact].map((t) => unit(t, ['about']));
}

export function stadiumsUnits() {
  const sb = stadiumsBlocks();
  if (!sb) return null;
  const ids = sb.rail.venues.map((r) => r.venue_id);
  const venueRoutes = ids.map((id) => `stadiums/${id}`);
  // renoEmpty bakes (i18nBlock-stamped) only on venues with zero renovations — same
  // resolution order build.mjs uses (pr?.renovations ?? cf.renovations ?? []).
  const renoEmptyRoutes = ids
    .filter((id) => ((sb.proseDocs.get(id)?.renovations ?? sb.sheets.get(id).renovations) ?? []).length === 0)
    .map((id) => `stadiums/${id}`);
  return [
    unit(S.pages.stadiums.heroSub, ['stadiums']),
    ...(sb.hubProse ? [unit(sb.hubProse, ['stadiums'])] : []),
    unit(S.pages.stadiums.hubFootnote, ['stadiums']),
    ...ids.flatMap((id) => [
      ...(sb.cityHTML.get(id) ? [unit(sb.cityHTML.get(id), [`stadiums/${id}`])] : []),
      ...(sb.stadHTML.get(id) ? [unit(sb.stadHTML.get(id), [`stadiums/${id}`])] : []),
    ]),
    ...(renoEmptyRoutes.length ? [unit(S.pages.stadiums.renoEmpty, renoEmptyRoutes)] : []),
    unit(S.footnotes.stadiumsA, venueRoutes), // the shared provenance-footnote spans (every venue page)
    unit(S.footnotes.stadiumsB, venueRoutes),
  ];
}

// profiles scope — null when the profiles dataset is absent (mirrors build.mjs profReg).
// One unit PER PARAGRAPH of each profile's certified bio, text = the exact esc'd innerHTML
// build.mjs stamps (`<p data-i18n-block="<id>">…</p>` — paragraph-level, so one flagged
// paragraph degrades alone). Units carry `pack` (the per-team fragment file the build bakes
// and the client fetches) plus `routes` (the profile pages, for reference/round-trip tests).
// Deduped per (pack, id): a paragraph repeated within a pack merges routes; the rare
// paragraph shared ACROSS teams (e.g. one identical honours line on two players) emits one
// unit per pack so every team's file stays complete.
export function profilesUnits() {
  const reg = profilesRegistry();
  if (!reg) return null;
  const byPackId = new Map(); // `${pack} ${id}` → unit
  const units = [];
  for (const p of reg.profiles.values()) {
    const route = `${p.kind === 'player' ? 'players' : 'people'}/${p.slug}`;
    for (const html of profileParagraphs(p.text)) {
      const id = blockId(html);
      const k = `${p.pack} ${id}`;
      const u = byPackId.get(k);
      if (u) { if (!u.routes.includes(route)) u.routes.push(route); continue; }
      const nu = { id, text: html, routes: [route], pack: p.pack };
      byPackId.set(k, nu);
      units.push(nu);
    }
  }
  return units;
}
