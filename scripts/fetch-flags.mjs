#!/usr/bin/env node
// fetch-flags.mjs — pin all 48 Twemoji flag SVGs (CC BY 4.0) locally,
// emit site/brand/flags/<slug>.svg + a combined symbol sprite site/brand/flags.svg
// + data/flag-map.json (slug -> fifa code, file, codepoints). Run once per Twemoji bump.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const TAG = 'v15.1.0'; // same pin as fetch-team-colors.mjs
const teams = JSON.parse(readFileSync('data/teams.json', 'utf8')).teams;

// FIFA trigram codes, hand-audited against the FIFA squad-lists PDF naming (2026-06-10).
const FIFA = {
  'czechia': 'CZE', 'korea-republic': 'KOR', 'mexico': 'MEX', 'south-africa': 'RSA',
  'bosnia-and-herzegovina': 'BIH', 'canada': 'CAN', 'qatar': 'QAT', 'switzerland': 'SUI',
  'brazil': 'BRA', 'haiti': 'HAI', 'morocco': 'MAR', 'scotland': 'SCO',
  'australia': 'AUS', 'paraguay': 'PAR', 'turkiye': 'TUR', 'usa': 'USA',
  'cote-d-ivoire': 'CIV', 'curacao': 'CUW', 'ecuador': 'ECU', 'germany': 'GER',
  'japan': 'JPN', 'netherlands': 'NED', 'sweden': 'SWE', 'tunisia': 'TUN',
  'belgium': 'BEL', 'egypt': 'EGY', 'ir-iran': 'IRN', 'new-zealand': 'NZL',
  'cabo-verde': 'CPV', 'saudi-arabia': 'KSA', 'spain': 'ESP', 'uruguay': 'URU',
  'france': 'FRA', 'iraq': 'IRQ', 'norway': 'NOR', 'senegal': 'SEN',
  'algeria': 'ALG', 'argentina': 'ARG', 'austria': 'AUT', 'jordan': 'JOR',
  'colombia': 'COL', 'congo-dr': 'COD', 'portugal': 'POR', 'uzbekistan': 'UZB',
  'croatia': 'CRO', 'england': 'ENG', 'ghana': 'GHA', 'panama': 'PAN',
};

const SUBDIV = {
  'GB-SCT': '1f3f4-e0067-e0062-e0073-e0063-e0074-e007f',
  'GB-ENG': '1f3f4-e0067-e0062-e0065-e006e-e0067-e007f',
};
const codepoints = (iso) => SUBDIV[iso] ||
  [...iso].map((c) => (0x1f1e6 + c.charCodeAt(0) - 65).toString(16)).join('-');

mkdirSync('site/brand/flags', { recursive: true });
const map = {};
const symbols = [];
let fetched = 0;

for (const t of teams) {
  const file = codepoints(t.iso) + '.svg';
  const url = `https://raw.githubusercontent.com/jdecked/twemoji/${TAG}/assets/svg/${file}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'golazo26-build (worldcup2026 fan site; flags pin)' } });
  if (!res.ok) { console.error(`FAIL ${t.slug}: ${res.status} ${url}`); process.exit(1); }
  const svg = (await res.text()).trim();
  if (!svg.startsWith('<svg') || !svg.includes('viewBox="0 0 36 36"')) { console.error(`BAD SVG ${t.slug}`); process.exit(1); }
  writeFileSync(`site/brand/flags/${t.slug}.svg`, svg);
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  symbols.push(`<symbol id="f-${t.slug}" viewBox="0 0 36 36">${inner}</symbol>`);
  if (!FIFA[t.slug]) { console.error(`NO FIFA CODE for ${t.slug}`); process.exit(1); }
  map[t.slug] = { fifa: FIFA[t.slug], iso: t.iso, twemoji_file: file, audited: true };
  fetched++;
  await new Promise((r) => setTimeout(r, 220));
}

if (fetched !== 48) { console.error(`expected 48 flags, got ${fetched}`); process.exit(1); }
writeFileSync('site/brand/flags.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${symbols.join('\n')}</svg>\n`);
writeFileSync('data/flag-map.json', JSON.stringify({
  _note: `Twemoji ${TAG} flag artwork (CC BY 4.0, jdecked/twemoji), pinned + self-hosted. FIFA trigrams hand-audited 2026-06-10.`,
  teams: map,
}, null, 1));
console.log(`flags OK — 48 files + sprite (${(symbols.join('').length / 1024).toFixed(0)}KB) + flag-map.json`);
