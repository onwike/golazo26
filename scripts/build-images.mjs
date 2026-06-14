#!/usr/bin/env node
// build-images.mjs — player/coach photo resolver (zero dependencies).
// For every player + coach (and optional extra people in data/people-*.json):
//   en.wikipedia title -> Wikidata QID -> P18 image -> Commons license metadata.
// QID matching only (never name strings). License allowlist: PD/CC0/CC BY/CC BY-SA.
// Statuses: ok | no_wiki_article | no_qid | no_image | license_rejected | license_unreadable.
// Emits data/images.json with per-file attribution + a coverage report. Serial
// requests with a descriptive User-Agent per MediaWiki etiquette.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = 'Golazo26-planning/0.1 (contact: onwike@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return res.json();
      if (res.status >= 500 || res.status === 429) { await sleep(1500 * attempt); continue; }
      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1500 * attempt);
    }
  }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---- curated overrides: hand-reviewed photos for subjects without a usable
// P18, picked from find-photo-candidates output. P18 wins on conflict. Every
// override carries its license evidence plus my accept/reject decision.
const overrides = existsSync('data/photo-overrides.json')
  ? JSON.parse(readFileSync('data/photo-overrides.json', 'utf8')).overrides
  : {};

// ---- collect subjects ----
const rosters = JSON.parse(readFileSync('data/rosters.json', 'utf8'));
const subjects = [];
for (const t of rosters.teams) {
  for (const p of t.players) {
    subjects.push({ subject_type: 'player', team: t.team, name: p.name, wiki_title: p.wiki_title });
  }
  if (t.coach) subjects.push({ subject_type: 'coach', team: t.team, name: t.coach.name, wiki_title: t.coach.wiki_title });
}
for (const extra of ['data/people-fifa.json', 'data/people-ussf.json']) {
  if (existsSync(extra)) {
    const d = JSON.parse(readFileSync(extra, 'utf8'));
    for (const p of d.people) {
      if (p.wikipedia_title) subjects.push({ subject_type: 'org_person', team: d.org, name: p.name, wiki_title: p.wikipedia_title });
    }
  }
}
console.log(`subjects: ${subjects.length} (${subjects.filter((s) => !s.wiki_title).length} with no wiki article)`);

// ---- 1) titles -> QIDs (enwiki pageprops, follows redirects) ----
const titles = [...new Set(subjects.filter((s) => s.wiki_title).map((s) => s.wiki_title))];
const titleToQid = new Map();
for (const batch of chunk(titles, 50)) {
  const u = `https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&titles=${encodeURIComponent(batch.join('|'))}`;
  const d = await api(u);
  const rename = new Map();
  for (const r of [...(d.query.normalized ?? []), ...(d.query.redirects ?? [])]) rename.set(r.to, [...(rename.get(r.to) ?? []), r.from]);
  const originals = (finalTitle) => {
    // walk rename chains back to every original batch title
    const out = [];
    const stack = [finalTitle];
    while (stack.length) {
      const t = stack.pop();
      if (batch.includes(t)) out.push(t);
      for (const prev of rename.get(t) ?? []) stack.push(prev);
    }
    return out.length ? out : [finalTitle];
  };
  for (const page of Object.values(d.query.pages)) {
    const qid = page.pageprops?.wikibase_item;
    for (const orig of originals(page.title)) titleToQid.set(orig, qid ?? null);
  }
  await sleep(150);
}
console.log(`QIDs resolved: ${[...titleToQid.values()].filter(Boolean).length}/${titles.length}`);

// ---- 2) QIDs -> P18 image filename ----
const qids = [...new Set([...titleToQid.values()].filter(Boolean))];
const qidToImage = new Map();
const matchMethodByQid = new Map(); // 'wikidata_p18' | 'curated_override'
for (const batch of chunk(qids, 50)) {
  const u = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&ids=${batch.join('|')}`;
  const d = await api(u);
  for (const [qid, ent] of Object.entries(d.entities ?? {})) {
    const img = ent.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (img) { qidToImage.set(qid, img); matchMethodByQid.set(qid, 'wikidata_p18'); }
    else if (overrides[qid]?.commons_file) {
      qidToImage.set(qid, overrides[qid].commons_file.replace(/^File:/, ''));
      matchMethodByQid.set(qid, 'curated_override');
    } else qidToImage.set(qid, null);
  }
  await sleep(150);
}
const nOv = [...matchMethodByQid.values()].filter((m) => m === 'curated_override').length;
console.log(`images: ${[...qidToImage.values()].filter(Boolean).length}/${qids.length} QIDs (${nOv} via curated overrides)`);

// ---- 3) image files -> Commons license metadata ----
const files = [...new Set([...qidToImage.values()].filter(Boolean))].map((f) => `File:${f}`);
const fileMeta = new Map();
for (const batch of chunk(files, 50)) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata%7Curl%7Csize&iiurlwidth=330&format=json&titles=${encodeURIComponent(batch.join('|'))}`;
  const d = await api(u);
  const rename = new Map((d.query.normalized ?? []).map((r) => [r.to, r.from]));
  for (const page of Object.values(d.query.pages ?? {})) {
    const key = rename.get(page.title) ?? page.title;
    const ii = page.imageinfo?.[0];
    const em = ii?.extmetadata ?? {};
    const strip = (h) => (h ?? '').replace(/<[^>]*>/g, '').trim();
    fileMeta.set(key, ii ? {
      license: em.LicenseShortName?.value ?? null,
      license_url: em.LicenseUrl?.value ?? null,
      author: strip(em.Artist?.value) || null,
      attribution_required: em.AttributionRequired?.value ?? null,
      file_page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      thumb_url: ii.thumburl ?? null,
      full_url: ii.url ?? null,
      width: ii.width ?? null,
      height: ii.height ?? null,
    } : null);
  }
  await sleep(150);
}

import { ALLOW } from './lib/commons.mjs'; // single-source license allowlist

// ---- assemble ----
const entries = [];
const counts = {};
for (const s of subjects) {
  let status, image = null;
  if (!s.wiki_title) status = 'no_wiki_article';
  else {
    const qid = titleToQid.get(s.wiki_title) ?? null;
    if (!qid) status = 'no_qid';
    else {
      const file = qidToImage.get(qid);
      if (!file) status = 'no_image';
      else {
        const meta = fileMeta.get(`File:${file}`);
        if (!meta || !meta.license) status = 'license_unreadable';
        else if (!ALLOW.test(meta.license)) {
          status = 'license_rejected';
          s.rejected_license = meta.license; // accurate reason, e.g. GFDL-1.2-only — not necessarily NC/ND
          s.rejected_file_page = meta.file_page;
        } else {
          status = 'ok';
          image = { commons_file: `File:${file}`, ...meta };
          if (matchMethodByQid.get(qid) === 'curated_override') {
            s.override = { evidence: overrides[qid]?.evidence ?? null, verified_by: overrides[qid]?.verified_by ?? null, verified_at: overrides[qid]?.verified_at ?? null };
          }
        }
      }
      s.qid = qid;
    }
  }
  counts[status] = (counts[status] ?? 0) + 1;
  entries.push({ ...s, match_method: s.qid ? (s.override ? 'curated_override' : 'wikidata_qid') : null, status, image });
}

// duplicate-file guard: one Commons file must never serve two different QIDs
const fileToQid = new Map();
for (const e of entries) {
  if (e.status !== 'ok') continue;
  const prev = fileToQid.get(e.image.commons_file);
  if (prev && prev !== e.qid) { console.error(`⛔ duplicate file across QIDs: ${e.image.commons_file} (${prev} vs ${e.qid})`); process.exit(1); }
  fileToQid.set(e.image.commons_file, e.qid);
}

writeFileSync('data/images.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  pipeline: 'enwiki pageprops -> wikidata P18 -> commons extmetadata; QID matching only',
  license_allowlist: 'Public domain / CC0 / CC BY / CC BY-SA only — anything else is rejected with its actual license recorded per entry (e.g. NC, ND, or GFDL-1.2-only, which is free but outside the allowlist)',
  attribution_note: 'The author field records the Commons |author= template field verbatim; for some files that is the uploader or a hosting account rather than the credited photographer named in description prose.',
  coverage: counts,
  subject_count: entries.length,
  entries,
}, null, 2) + '\n');

console.log('coverage:', JSON.stringify(counts));
const okByType = {};
for (const e of entries) if (e.status === 'ok') okByType[e.subject_type] = (okByType[e.subject_type] ?? 0) + 1;
console.log('ok by type:', JSON.stringify(okByType));
