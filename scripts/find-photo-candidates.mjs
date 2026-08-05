#!/usr/bin/env node
// find-photo-candidates.mjs — photo discovery (zero dependencies).
// For every subject without a photo, gathers CANDIDATES from ranked sources:
//   S1 page_image_free across ALL Wikipedia language editions (community-curated
//      infobox images that never made it to Wikidata P18) — strongest evidence
//   S2 per-person Commons category members (P373 / commonswiki sitelink)
//   S3 Commons structured-data depicts (haswbstatement:P180=QID)
//   S4 Commons full-text search (weak — name match only)
//   S5 Openverse CC search (weak — external source, license-gated)
// Every Commons candidate is license-gated (PD/CC0/CC BY/CC BY-SA) at discovery.
// Output: data/photo-candidates.json (decision:null) — NOTHING is ingested here.
// I review the candidates by hand and record accept/reject decisions in
// data/photo-overrides.json; only those reviewed entries reach the build.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = 'Golazo26/1.0 (fan site; +https://github.com/onwike/golazo26)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
import { ALLOW } from './lib/commons.mjs'; // single-source license allowlist
const GROUPY = /\b(and|with|vs|team|squad|celebrat|players|lineup|training)\b/i;

async function api(url, tries = 3) {
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 429) { await sleep(15000); throw new Error('429'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { if (a === tries) return null; await sleep(1200 * a); }
  }
}

const images = JSON.parse(readFileSync('data/images.json', 'utf8')).entries;
const assignedFiles = new Set(images.filter((e) => e.status === 'ok').map((e) => e.image.commons_file));
const targets = images.filter((e) => e.status !== 'ok' && e.qid);
console.log(`targets: ${targets.length}`);

const candidates = new Map(); // qid -> [{file, evidence:[...], ...}]
const addCand = (qid, file, evidence, extra = {}) => {
  if (!file) return;
  const f = file.startsWith('File:') ? file : `File:${file}`;
  if (assignedFiles.has(f)) return;
  if (!candidates.has(qid)) candidates.set(qid, []);
  const list = candidates.get(qid);
  const existing = list.find((c) => c.file === f);
  if (existing) existing.evidence.push(evidence);
  else list.push({ file: f, evidence: [evidence], ...extra });
};

// ---- S1: sitelinks -> per-wiki page_image_free ----
const qids = targets.map((t) => t.qid);
const sitelinksByQid = new Map();
for (const batch of chunk(qids, 50)) {
  const d = await api(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=sitelinks&format=json&ids=${batch.join('|')}`);
  for (const [qid, ent] of Object.entries(d?.entities ?? {})) {
    sitelinksByQid.set(qid, Object.entries(ent.sitelinks ?? {}).filter(([k]) => k.endsWith('wiki') && k !== 'commonswiki' && k !== 'specieswiki').map(([k, v]) => ({ wiki: k.replace(/wiki$/, ''), title: v.title })));
  }
  await sleep(200);
}
// group (wiki -> [{qid,title}]) and batch-query each wiki
const byWiki = new Map();
for (const t of targets) for (const sl of sitelinksByQid.get(t.qid) ?? []) {
  if (!byWiki.has(sl.wiki)) byWiki.set(sl.wiki, []);
  byWiki.get(sl.wiki).push({ qid: t.qid, title: sl.title });
}
console.log(`S1: ${byWiki.size} wikis to query`);
for (const [wiki, items] of byWiki) {
  const host = `${wiki.replace(/_/g, '-')}.wikipedia.org`;
  for (const batch of chunk(items, 50)) {
    const d = await api(`https://${host}/w/api.php?action=query&prop=pageprops&ppprop=page_image_free&redirects=1&format=json&titles=${encodeURIComponent(batch.map((i) => i.title).join('|'))}`);
    if (!d?.query) continue;
    const rename = new Map([...(d.query.normalized ?? []), ...(d.query.redirects ?? [])].map((r) => [r.to, r.from]));
    const titleToQid = new Map(batch.map((i) => [i.title, i.qid]));
    for (const page of Object.values(d.query.pages ?? {})) {
      const img = page.pageprops?.page_image_free;
      if (!img) continue;
      let orig = page.title;
      while (rename.has(orig) && !titleToQid.has(orig)) orig = rename.get(orig);
      const qid = titleToQid.get(orig) ?? titleToQid.get(page.title);
      if (qid) addCand(qid, img, { type: 'page_image_free', wiki });
    }
    await sleep(250);
  }
}

// ---- S2: Commons categories ----
const p373 = new Map();
for (const batch of chunk(qids, 50)) {
  const d = await api(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims|sitelinks&sitefilter=commonswiki&format=json&ids=${batch.join('|')}`);
  for (const [qid, ent] of Object.entries(d?.entities ?? {})) {
    const cat = ent.claims?.P373?.[0]?.mainsnak?.datavalue?.value
      ?? (ent.sitelinks?.commonswiki?.title?.startsWith('Category:') ? ent.sitelinks.commonswiki.title.replace('Category:', '') : null);
    if (cat) p373.set(qid, cat);
  }
  await sleep(200);
}
console.log(`S2: ${p373.size} targets with a Commons category`);
for (const [qid, cat] of p373) {
  const d = await api(`https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent('Category:' + cat)}&cmtype=file&cmlimit=10&format=json`);
  for (const m of d?.query?.categorymembers ?? []) addCand(qid, m.title, { type: 'commons_category', category: cat });
  await sleep(250);
}

// ---- S3: depicts + S4: text search (Commons) ----
const nameOf = new Map(targets.map((t) => [t.qid, t.name]));
let i = 0;
for (const t of targets) {
  i++;
  if (i % 50 === 0) console.log(`S3/S4 progress: ${i}/${targets.length}`);
  const dep = await api(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent('haswbstatement:P180=' + t.qid)}&srnamespace=6&srlimit=5&format=json`);
  for (const r of dep?.query?.search ?? []) addCand(t.qid, r.title, { type: 'depicts' });
  await sleep(150);
  const txt = await api(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent('"' + t.name + '"')}&srnamespace=6&srlimit=5&format=json`);
  for (const r of txt?.query?.search ?? []) addCand(t.qid, r.title, { type: 'text_search' });
  await sleep(150);
}

// ---- license-gate all Commons candidates ----
const allFiles = [...new Set([...candidates.values()].flat().map((c) => c.file))];
console.log(`gating ${allFiles.length} candidate files`);
const meta = new Map();
for (const batch of chunk(allFiles, 50)) {
  const d = await api(`https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata|size|url&iiurlwidth=330&format=json&titles=${encodeURIComponent(batch.join('|'))}`);
  const rename = new Map((d?.query?.normalized ?? []).map((r) => [r.to, r.from]));
  for (const page of Object.values(d?.query?.pages ?? {})) {
    const key = rename.get(page.title) ?? page.title;
    const ii = page.imageinfo?.[0];
    if (!ii) continue;
    const em = ii.extmetadata ?? {};
    const strip = (h) => (h ?? '').replace(/<[^>]*>/g, '').trim();
    meta.set(key, {
      license: em.LicenseShortName?.value ?? null, license_url: em.LicenseUrl?.value ?? null,
      author: strip(em.Artist?.value) || null, width: ii.width, height: ii.height,
      thumb_330: ii.thumburl, file_page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      description: strip(em.ImageDescription?.value).slice(0, 240),
    });
  }
  await sleep(250);
}

// ---- S5: Openverse for targets still without any strong candidate ----
const STRONG = new Set(['page_image_free', 'commons_category', 'depicts']);
const stillBare = targets.filter((t) => !(candidates.get(t.qid) ?? []).some((c) => meta.get(c.file) && ALLOW.test(meta.get(c.file).license ?? '') && c.evidence.some((e) => STRONG.has(e.type))));
console.log(`S5 Openverse pass for ${stillBare.length} targets`);
const openverse = [];
for (const t of stillBare) {
  const d = await api(`https://api.openverse.org/v1/images/?q=${encodeURIComponent('"' + t.name + '" football')}&license=by,by-sa,cc0,pdm&page_size=4`);
  for (const r of d?.results ?? []) {
    openverse.push({ qid: t.qid, name: t.name, team: t.team, source: 'openverse',
      url: r.url, foreign_landing_url: r.foreign_landing_url, license: `CC ${String(r.license).toUpperCase()} ${r.license_version ?? ''}`.trim(),
      license_url: r.license_url, author: r.creator ?? null, title: r.title, width: r.width, height: r.height,
      evidence: [{ type: 'openverse_search' }], decision: null });
  }
  await sleep(350);
}

// ---- assemble ----
const out = [];
for (const t of targets) {
  for (const c of candidates.get(t.qid) ?? []) {
    const m = meta.get(c.file);
    if (!m || !m.license || !ALLOW.test(m.license)) continue; // license gate
    out.push({ qid: t.qid, name: t.name, team: t.team, subject_type: t.subject_type, source: 'commons',
      file: c.file, ...m, evidence: c.evidence, groupy_flag: GROUPY.test(c.file) || undefined, decision: null });
  }
}
out.sort((a, b) => Number(b.evidence.some((e) => STRONG.has(e.type))) - Number(a.evidence.some((e) => STRONG.has(e.type))));
const withStrong = new Set(out.filter((c) => c.evidence.some((e) => STRONG.has(e.type))).map((c) => c.qid));
writeFileSync('data/photo-candidates.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  targets: targets.length,
  targets_with_strong_candidates: withStrong.size,
  commons_candidates: out.length,
  openverse_candidates: openverse.length,
  candidates: out, openverse,
}, null, 1));
console.log(`DONE — ${out.length} license-cleared Commons candidates (${withStrong.size}/${targets.length} targets have strong evidence) + ${openverse.length} Openverse candidates`);
