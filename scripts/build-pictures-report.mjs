#!/usr/bin/env node
// build-pictures-report.mjs — regenerates docs/pictures.md, the honest photo
// coverage report. Reads data/images.json (single-image / P18 layer),
// data/gallery.json (harvested extra images + identity/license audit) and
// data/gallery-manifest.json (what actually downloaded). Counts, per subject,
// the number of ON-SITE photos = (1 if an ok P18 primary) + downloaded gallery
// renditions, and reports per-team 0 / 1 / 2-4 / 5 buckets plus the full
// zero-image list. Zero dependencies.

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';

const images = JSON.parse(readFileSync('data/images.json', 'utf8'));
const gallery = existsSync('data/gallery.json') ? JSON.parse(readFileSync('data/gallery.json', 'utf8')) : { subjects: [], total_gallery_images_added: 0 };
const galManifest = existsSync('data/gallery-manifest.json') ? JSON.parse(readFileSync('data/gallery-manifest.json', 'utf8')).manifest : {};

// on-site image count per subject (by qid): primary P18 + downloaded gallery strips
const primaryQids = new Set(images.entries.filter((e) => e.status === 'ok' && e.qid).map((e) => e.qid));
const countByQid = new Map();
for (const e of images.entries) {
  if (!e.qid) continue;
  const n = (primaryQids.has(e.qid) ? 1 : 0) + (galManifest[e.qid]?.length ?? 0);
  countByQid.set(e.qid, Math.min(n, 5));
}

// per-team buckets over PLAYERS + COACH (org_person rows are reported separately)
const teamRows = new Map(); // team -> {b0,b1,b24,b5, total, zero:[names]}
const bucket = (n) => (n === 0 ? 'b0' : n === 1 ? 'b1' : n === 5 ? 'b5' : 'b24');
for (const e of images.entries) {
  if (e.subject_type !== 'player' && e.subject_type !== 'coach') continue;
  const team = e.team;
  if (!teamRows.has(team)) teamRows.set(team, { b0: 0, b1: 0, b24: 0, b5: 0, total: 0, zero: [] });
  const row = teamRows.get(team);
  const n = e.qid ? (countByQid.get(e.qid) ?? 0) : 0;
  row[bucket(n)]++;
  row.total++;
  if (n === 0) row.zero.push(e.name);
}

const sum = (k) => [...teamRows.values()].reduce((a, r) => a + r[k], 0);
const playerCoachTotal = sum('total');
const tally = { b0: sum('b0'), b1: sum('b1'), b24: sum('b24'), b5: sum('b5') };
const withAny = playerCoachTotal - tally.b0;

// repo-size impact of the gallery image set (site/img/*-g* files)
let galleryBytes = 0, galleryFiles = 0;
for (const f of readdirSync('site/img')) {
  if (/-g\d/.test(f)) { galleryBytes += statSync(`site/img/${f}`).size; galleryFiles++; }
}
const mb = (b) => (b / 1024 / 1024).toFixed(1);

const teamLines = [...teamRows.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([team, r]) =>
  `| ${team} | ${r.b0} | ${r.b1} | ${r.b24} | ${r.b5} | ${r.total} |`).join('\n');

// the full zero-image list (the subjects that stay on initials avatars)
const zeroList = [...teamRows.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  .filter(([, r]) => r.zero.length)
  .map(([team, r]) => `- **${team}** (${r.zero.length}): ${r.zero.join(', ')}`).join('\n');

const dist = gallery.distribution_total_images_per_subject ?? {};

const md = `# Player & coach photo coverage — multi-image report

Pipeline (single image): enwiki pageprops → Wikidata **P18** → Commons license check (QID matching only).
Pipeline (gallery, up to 5/subject): for every subject with a QID, harvest extra Commons photos tied to the person by **structural identity evidence only** — membership of the person's **own Commons category** (Wikidata P373 / Category sitelink) and/or a Commons structured-data **\`depicts (P180)=QID\`** statement. No name/text-search matches are ever accepted (a wrong-person photo is the cardinal sin). Every accepted image records its evidence in [data/gallery.json](../data/gallery.json).

**License allowlist (both layers): Public Domain / CC0 / CC BY / CC BY-SA only.** Anything NC, ND, unverifiable, or free-but-unlisted (e.g. GFDL-1.2-only) is rejected with its actual license recorded. Generated ${new Date().toISOString()}.

## Headline coverage (players + head coaches: ${playerCoachTotal} subjects)

| Photos on profile | Subjects | Share |
|---|---|---|
| **0** (initials avatar — honestly no free verified photo) | ${tally.b0} | ${(tally.b0 / playerCoachTotal * 100).toFixed(1)}% |
| **1** | ${tally.b1} | ${(tally.b1 / playerCoachTotal * 100).toFixed(1)}% |
| **2–4** | ${tally.b24} | ${(tally.b24 / playerCoachTotal * 100).toFixed(1)}% |
| **5 (cap reached)** | ${tally.b5} | ${(tally.b5 / playerCoachTotal * 100).toFixed(1)}% |

**${withAny}/${playerCoachTotal} (${(withAny / playerCoachTotal * 100).toFixed(1)}%) have at least one photo**; **${tally.b24 + tally.b5}** now have a multi-photo gallery (2+). The remaining **${tally.b0}** stay on neutral initials avatars — they are listed in full below and were **never** padded with a look-alike or a near-match.

Whole-population distribution (players, coaches, and org/admin people — ${Object.values(dist).reduce((a, b) => a + b, 0)} subjects with a QID), total images per subject:

| Images | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| Subjects | ${dist[0] ?? 0} | ${dist[1] ?? 0} | ${dist[2] ?? 0} | ${dist[3] ?? 0} | ${dist[4] ?? 0} | ${dist[5] ?? 0} |

## Identity & license audit

- **${gallery.subjects?.length ?? 0}** subjects gained at least one extra verified photo; **${gallery.total_gallery_images_added ?? 0}** gallery images harvested, of which **${galleryFiles ? Object.values(galManifest).reduce((a, l) => a + l.length, 0) : 0}** downloaded successfully and render on-site.
- Every gallery image carries machine-readable identity evidence (own Commons category and/or P180 depicts) and a license in the allowlist — see [data/gallery.json](../data/gallery.json) for the per-file record.
- Category-only files are additionally screened by a non-portrait filename blocklist (houses, streets/complexes named after the person, memorabilia, group/trophy shots, murals, waxworks) so a category that collects *everything about a topic* does not surface a building or a group photo as a portrait. Files with an explicit \`depicts\` statement are exempt from that filter (the statement asserts the person is in frame).
- **Repo-size impact of the gallery set**: ${galleryFiles} WebP renditions, **${mb(galleryBytes)} MB** added under \`site/img/\` (strip thumbnails at 250px + lightbox detail renditions, WebP to keep the 5× set small).

## Per-team coverage (players + head coach)

| Team | 0 photos | 1 photo | 2–4 photos | 5 photos | Squad+coach |
|---|---|---|---|---|---|
${teamLines}

## The zero-photo subjects (stay on initials avatars — honest gap)

These ${tally.b0} subjects have a Wikidata item but **no allowlisted, identity-verified free photograph** on Commons (no usable P18, no category/depicts portrait that passes the license + portrait filters). They render as initials avatars. This list is the honest coverage gap — no substitutes were used.

${zeroList}
`;

writeFileSync('docs/pictures.md', md);
console.log(`pictures.md: ${playerCoachTotal} player/coach subjects · ${tally.b0} zero · ${tally.b24 + tally.b5} multi · gallery set ${mb(galleryBytes)}MB / ${galleryFiles} files`);
