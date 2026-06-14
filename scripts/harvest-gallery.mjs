#!/usr/bin/env node
// harvest-gallery.mjs — multi-image harvest (up to 5 photos per subject).
// For EVERY player/coach/org_person with a Wikidata QID, gathers additional
// identity-verified, license-allowlisted Commons photos beyond the single P18
// already in data/images.json, and emits data/gallery.json.
//
// IDENTITY DOCTRINE (wrong-person photo = cardinal sin): a gallery image is
// accepted ONLY when the file is structurally tied to the subject's QID:
//   E1  the file is a member of the subject's OWN Commons category
//       (Wikidata P373 / commonswiki Category: sitelink), OR
//   E2  the file carries a Commons structured-data depicts statement P180=QID.
// Both are curator-maintained person->file links, not fuzzy name matches.
// No text-search / name-match candidates are ever accepted here.
//
// LICENSE allowlist ONLY: Public Domain / CC0 / CC BY / CC BY-SA. Per file I
// capture author + license + license_url + file page for attribution.
//
// The P18 portrait already in images.json is slot 1 and is NOT re-harvested.
// I add up to 4 more distinct files (cap 5 total). Group/non-portrait files
// (training shots, line-ups, "X and Y") are skipped by filename heuristic.
//
// Output: data/gallery.json — { generated_at, subjects:[{qid,name,team,
//   subject_type, primary_file, gallery:[{file,license,license_url,author,
//   width,height,thumb_url,file_page,evidence:[...]}]}] , audit }.
// Zero dependencies. Serial, polite requests with a descriptive User-Agent.

import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = process.cwd() + '/'; // scripts run from repo root (cwd), like the others
const UA = 'Golazo26/1.0 (fan site; contact: onwike@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

import { ALLOW } from './lib/commons.mjs'; // single-source license allowlist (was copy-pasted in 3 files)
// Filenames that signal a non-solo / non-portrait image — excluded from a
// per-person gallery even when the file lives in the person's category.
const GROUPY = /\b(and|with|vs\.?|versus|v\b|team|squad|celebrat|c[ée]l[ée]brat|players|line[ -]?up|training|group|fans|supporters|stadium|match|trophy|medal|press conference|signing|statue|mural|graffiti|jersey|shirt|boots?|cleats?|autograph|logo|crest|badge|coin|stamp|[ée]quipe|selecci[óo]n|sele[çc][ãa]o|nationalmannschaft|gruppenfoto)\b/i;
// A Commons category named after a person collects EVERYTHING about that topic —
// not just face photos: their childhood house, a street/sports-complex named for
// them, memorabilia, murals, FA-Cup-winning group shots, sponsor events. Those
// are the right *topic* but the wrong *subject* to show as a portrait. I reject
// category-only files matching these patterns; files with an explicit Commons
// `depicts (P180)=QID` statement are exempt (that statement asserts the person
// is in the frame).
const NONPORTRAIT = /\b(casa|barrio|infancia|childhood|house|home|birthplace|predio|estadio|stadium|complejo|complex|calle|street|avenida|avenue|plaza|square|monument|monumento|museum|museo|exhibition|exposici|winners?|final|cup|champions?|trophy|award|ceremony|gala|premios?|wax|madame tussauds|mural|statue|estatua|busto|bust|graffiti|sign|placa|plaque|stamp|sello|coin|moneda|banknote|book|libro|cover|poster|cartel|tattoo|boots?|cleats?|gloves?|kit|camiseta|shirt|jersey|map|mapa|wikipedia|screenshot)\b/i;
const PORTRAITISH = /\.(jpe?g|png|webp)$/i;
const PER_SUBJECT_GALLERY_CAP = 4; // + the P18 primary = 5 total

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

const imagesDoc = JSON.parse(readFileSync('data/images.json', 'utf8'));
// every subject that resolved to a QID is a harvest target (ok OR no_image).
const targets = imagesDoc.entries.filter((e) => e.qid);
// files already used as someone's PRIMARY P18 must never appear in ANY gallery
// (would double-serve one file or imply the wrong person).
const primaryFiles = new Set(
  imagesDoc.entries.filter((e) => e.status === 'ok' && e.image?.commons_file)
    .map((e) => e.image.commons_file.replace(/_/g, ' ')),
);
const primaryByQid = new Map(
  imagesDoc.entries.filter((e) => e.status === 'ok' && e.image?.commons_file)
    .map((e) => [e.qid, e.image.commons_file]),
);
console.log(`harvest targets (have a QID): ${targets.length}; ${primaryByQid.size} already have a P18 primary`);

const qids = [...new Set(targets.map((t) => t.qid))];
const nameOf = new Map(targets.map((t) => [t.qid, t.name]));

// candidates: qid -> Map(file -> {evidence:[...]})
const cand = new Map();
const norm = (f) => (f.startsWith('File:') ? f : `File:${f}`).replace(/_/g, ' ');
const add = (qid, file, evidence) => {
  if (!file) return;
  const f = norm(file);
  if (primaryFiles.has(f)) return;               // never a primary of anyone
  if (primaryByQid.get(qid) && norm(primaryByQid.get(qid)) === f) return;
  if (!PORTRAITISH.test(f)) return;
  if (GROUPY.test(f)) return;                     // skip group / non-portrait
  if (!cand.has(qid)) cand.set(qid, new Map());
  const m = cand.get(qid);
  if (m.has(f)) m.get(f).evidence.push(evidence);
  else m.set(f, { evidence: [evidence] });
};

// ---- E1: per-person Commons category (P373 or commonswiki Category: sitelink) ----
const catByQid = new Map();
for (const batch of chunk(qids, 50)) {
  const d = await api(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims|sitelinks&sitefilter=commonswiki&format=json&ids=${batch.join('|')}`);
  for (const [qid, ent] of Object.entries(d?.entities ?? {})) {
    const cat = ent.claims?.P373?.[0]?.mainsnak?.datavalue?.value
      ?? (ent.sitelinks?.commonswiki?.title?.startsWith('Category:') ? ent.sitelinks.commonswiki.title.replace('Category:', '') : null);
    if (cat) catByQid.set(qid, cat);
  }
  await sleep(150);
}
console.log(`E1: ${catByQid.size}/${qids.length} subjects have an own Commons category`);
let ci = 0;
for (const [qid, cat] of catByQid) {
  ci++;
  if (ci % 100 === 0) console.log(`  E1 category fetch ${ci}/${catByQid.size}`);
  const d = await api(`https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent('Category:' + cat)}&cmtype=file&cmlimit=40&format=json`);
  for (const m of d?.query?.categorymembers ?? []) add(qid, m.title, { type: 'own_commons_category', category: cat });
  await sleep(160);
}

// ---- E2: Commons structured-data depicts P180=QID ----
let di = 0;
for (const qid of qids) {
  di++;
  if (di % 100 === 0) console.log(`  E2 depicts ${di}/${qids.length}`);
  // only worth querying if I still need more than what the category gave
  const have = cand.get(qid)?.size ?? 0;
  if (have >= PER_SUBJECT_GALLERY_CAP + 3) { continue; } // already plenty to choose from
  const d = await api(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent('haswbstatement:P180=' + qid)}&srnamespace=6&srlimit=15&format=json`);
  for (const r of d?.query?.search ?? []) add(qid, r.title, { type: 'depicts', statement: `P180=${qid}` });
  await sleep(160);
}

// ---- license-gate + metadata for all candidate files ----
const allFiles = [...new Set([...cand.values()].flatMap((m) => [...m.keys()]))];
console.log(`gating + metadata for ${allFiles.length} candidate files`);
const meta = new Map();
for (const batch of chunk(allFiles, 50)) {
  const d = await api(`https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata|size|url|mediatype&iiurlwidth=330&format=json&titles=${encodeURIComponent(batch.join('|'))}`);
  const rename = new Map((d?.query?.normalized ?? []).map((r) => [r.to, r.from]));
  for (const page of Object.values(d?.query?.pages ?? {})) {
    const key = norm(rename.get(page.title) ?? page.title);
    const ii = page.imageinfo?.[0];
    if (!ii || ii.mediatype !== 'BITMAP') continue; // images only (no SVG/PDF/audio)
    const em = ii.extmetadata ?? {};
    const strip = (h) => (h ?? '').replace(/<[^>]*>/g, '').trim();
    meta.set(key, {
      license: em.LicenseShortName?.value ?? null,
      license_url: em.LicenseUrl?.value ?? null,
      author: strip(em.Artist?.value) || null,
      attribution_required: em.AttributionRequired?.value ?? null,
      width: ii.width, height: ii.height,
      thumb_url: ii.thumburl,
      full_url: ii.url,
      file_page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      // PII: do NOT capture the free-text Commons ImageDescription — it pulled private
      // emails/social handles into committed data and is never rendered. Author/license carry attribution.
    });
  }
  await sleep(200);
}

// ---- assemble: pick up to N license-cleared, identity-tied files per subject ----
// Prefer files with an explicit depicts statement (asserts the person is in
// frame), then category membership; prefer larger images; avoid near-identical
// (same author + same dimensions) crops.
const evScore = (ev) => {
  const has = (t) => ev.some((e) => e.type === t);
  return (has('depicts') ? 2 : 0) + (has('own_commons_category') ? 1 : 0);
};
// A category-only file whose base name is JUST a team/nation word (+ optional
// number) is a squad group photo, not a portrait, e.g. "Ghana (1).jpg",
// "Égypte (2).jpg", "Equipe d'Algérie.jpg". Build the set of team names + their
// French/native nation variants from the roster.
const teamWords = new Set([
  // common French/native nation-name variants that appear as bare squad-photo
  // filenames but differ from the English team name in the roster.
  'egypte', 'algerie', 'maroc', 'tunisie', 'senegal', 'bresil', 'bresilien',
  'espagne', 'allemagne', 'angleterre', 'coree', 'japon', 'pays-bas', 'belgique',
  'suisse', 'ecosse', 'norvege', 'suede', 'autriche', 'croatie', 'argentine',
]);
for (const t of targets) {
  for (const w of String(t.team).toLowerCase().split(/[\s'-]+/)) if (w.length >= 3) teamWords.add(w.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}
const isBareTeamPhoto = (file) => {
  const base = file.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(\d+\)|\bphoto\b|\bteam\b|\bd[' ]?/gi, ' ')
    .replace(/[^a-z\s]/gi, ' ').trim().toLowerCase();
  const words = base.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 2 && words.every((w) => teamWords.has(w) || w === 'equipe' || w === 'selection');
};
const subjectsOut = [];
let totalGallery = 0;
const galleryByCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
for (const t of targets) {
  const m = cand.get(t.qid);
  const chosen = [];
  if (m) {
    const hasDepicts = (ev) => ev.some((e) => e.type === 'depicts');
    const ranked = [...m.entries()]
      .map(([file, c]) => ({ file, ...c, meta: meta.get(file) }))
      .filter((c) => c.meta && c.meta.license && ALLOW.test(c.meta.license))
      // category-only files must survive the non-portrait blocklist (filename);
      // depicts=P180 files are trusted to contain the person.
      .filter((c) => hasDepicts(c.evidence) || (!NONPORTRAIT.test(c.file) && !isBareTeamPhoto(c.file)))
      // sort: explicit depicts first (strongest), then category, then by resolution.
      .sort((a, b) => evScore(b.evidence) - evScore(a.evidence) || (b.meta.width * b.meta.height) - (a.meta.width * a.meta.height));
    const seen = new Set(); // dedupe near-identical: author + rounded megapixels
    for (const c of ranked) {
      if (chosen.length >= PER_SUBJECT_GALLERY_CAP) break;
      const sig = `${c.meta.author ?? '?'}|${Math.round((c.meta.width * c.meta.height) / 100000)}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      chosen.push({
        commons_file: c.file,
        license: c.meta.license, license_url: c.meta.license_url, author: c.meta.author,
        attribution_required: c.meta.attribution_required,
        width: c.meta.width, height: c.meta.height,
        thumb_url: c.meta.thumb_url, full_url: c.meta.full_url, file_page: c.meta.file_page,
        evidence: c.evidence, // description intentionally dropped (PII; see above)
      });
    }
  }
  const primary = primaryByQid.get(t.qid) ?? null;
  const total = (primary ? 1 : 0) + chosen.length;
  galleryByCount[Math.min(total, 5)]++;
  totalGallery += chosen.length;
  if (chosen.length) {
    subjectsOut.push({
      qid: t.qid, name: t.name, team: t.team, subject_type: t.subject_type,
      primary_file: primary, total_images: total, gallery: chosen,
    });
  }
}

const audit = {
  harvest_targets: targets.length,
  subjects_with_extra_images: subjectsOut.length,
  total_gallery_images_added: totalGallery,
  identity_doctrine: 'every gallery image is tied to the subject QID via own Commons category (P373/sitelink) and/or Commons depicts P180=QID; no name/text matches accepted',
  license_allowlist: 'Public Domain / CC0 / CC BY / CC BY-SA only',
  distribution_total_images_per_subject: galleryByCount,
};
writeFileSync('data/gallery.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  ...audit,
  subjects: subjectsOut,
}, null, 1) + '\n');
console.log('DONE', JSON.stringify(audit, null, 1));
