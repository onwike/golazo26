#!/usr/bin/env node
// fetch-thumbs.mjs — local thumbnail mirror (zero dependencies).
// Downloads every license-cleared Commons thumbnail once into site/img/ so the
// site never hotlinks Wikimedia (etiquette + reliability). Files are named by
// Wikidata QID (stable, collision-free). Emits data/img-manifest.json.
// Re-run is incremental: existing files are skipped.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';

const UA = 'Golazo26/1.0 (fan site; +https://github.com/onwike/golazo26)';
const images = JSON.parse(readFileSync('data/images.json', 'utf8')).entries;
mkdirSync('site/img', { recursive: true });

// Wikimedia serves FIXED thumb buckets only (120/250/330/500/960/1280); a
// ".webp" suffix on a bucket thumb URL returns WebP. Detail rendition: 960px
// where the original is wider than 960, else 500, else reuse the list file.
const bucketUrl = (thumbUrl, w, webp) => {
  // .../thumb/a/ab/Name.jpg/330px-Name.jpg -> swap the width prefix
  const u = thumbUrl.replace(/\/(\d+)px-/, `/${w}px-`);
  return webp ? `${u}.webp` : u;
};

const jobs = [];
const manifest = {};
for (const e of images) {
  if (e.status !== 'ok' || !e.qid || !e.image?.thumb_url) continue;
  // EFFICIENCY: the primary/list avatar renders at 34–56px on every card and page
  // header, yet previously shipped the raw ~330px JPEG/PNG source — the dominant per-page byte
  // cost site-wide. Fetch it as a downsized 250px WebP (mirrors the detail-rendition pattern),
  // falling back to the raw source only if Commons can't serve the WebP rendition.
  const file = `img/${e.qid}.webp`;
  const m = { file, name: e.name, commons_file: e.image.commons_file, file_page: e.image.file_page, author: e.image.author, license: e.image.license, license_url: e.image.license_url, width: e.image.width ?? null };
  // larger detail rendition for the profile page
  const w = e.image.width ?? 0;
  const detailW = w > 960 ? 960 : w > 500 ? 500 : null;
  if (detailW) {
    m.file_detail = `img/${e.qid}-d.webp`;
    m.detail_width = detailW;
    jobs.push({ url: bucketUrl(e.image.thumb_url, detailW, true), fallback: bucketUrl(e.image.thumb_url, detailW, false), path: `site/${m.file_detail}` });
  }
  manifest[e.qid] = m;
  jobs.push({ url: bucketUrl(e.image.thumb_url, 250, true), fallback: e.image.thumb_url, path: `site/${file}` });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let done = 0, skipped = 0, failed = [];
async function worker(queue) {
  for (;;) {
    const j = queue.pop();
    if (!j) return;
    if (existsSync(j.path) && statSync(j.path).size > 500) { skipped++; continue; }
    for (let a = 1; a <= 5; a++) {
      try {
        let res = await fetch(j.url, { headers: { 'User-Agent': UA } });
        if ((res.status === 400 || res.status === 404) && j.fallback) {
          res = await fetch(j.fallback, { headers: { 'User-Agent': UA } });
        }
        if (res.status === 429) {
          const ra = Number(res.headers.get('retry-after')) || 20;
          await sleep((ra + 5) * 1000);
          throw new Error('HTTP 429');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        writeFileSync(j.path, Buffer.from(await res.arrayBuffer()));
        done++;
        break;
      } catch (err) {
        if (a === 5) failed.push({ url: j.url, err: String(err) });
        else await sleep(1500 * a);
      }
    }
    await sleep(300); // be polite to Commons
  }
}

const queue = [...jobs];
await Promise.all(Array.from({ length: 2 }, () => worker(queue)));
writeFileSync('data/img-manifest.json', JSON.stringify({ generated_at: new Date().toISOString(), count: Object.keys(manifest).length, manifest }, null, 2) + '\n');
console.log(`thumbs: downloaded=${done} skipped=${skipped} failed=${failed.length} manifest=${Object.keys(manifest).length}`);
if (failed.length) { console.error(failed.slice(0, 10)); process.exitCode = failed.length > 20 ? 1 : 0; }
