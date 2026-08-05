#!/usr/bin/env node
// fetch-team-colors.mjs — extract team colors (one-time network; never in CI).
// Derives per-team UI colors from Twemoji flag SVGs (CC-BY 4.0, pinned tag),
// ranked by fill frequency × path size. Emits data/team-colors.json with
// audited:false on every row — the build REFUSES unaudited rows, so a human
// audit pass (white-field rule etc.) must flip them after review.

import { readFileSync, writeFileSync } from 'node:fs';
import { adjustForContrast } from './brand-tokens.mjs';

const TAG = 'v15.1.0';
const UA = 'Golazo26/1.0 (fan site; +https://github.com/onwike/golazo26)';
const teams = JSON.parse(readFileSync('data/teams.json', 'utf8')).teams;

const NEUTRALS = /^#(fff|ffffff|eee|f5f5f5|e6e7e8|ccd6dd|99aab5|292f33|66757f)$/i; // twemoji border grays + whites

const out = { source: {
  name: 'Twemoji flag artwork', version: `jdecked/twemoji ${TAG}`, license: 'CC-BY 4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  method: 'fill-hex extraction ranked by fill-frequency x path-length proxy; human-audited rank (white-field rule for JP/KR-style flags)',
  fetched_at: new Date().toISOString(),
}, teams: {} };

for (const t of teams) {
  const file = [...t.flag].map((c) => c.codePointAt(0).toString(16)).join('-') + '.svg';
  const url = `https://raw.githubusercontent.com/jdecked/twemoji/${TAG}/assets/svg/${file}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) { console.error(`✗ ${t.name}: HTTP ${res.status} for ${file}`); continue; }
  const svg = await res.text();
  const weights = new Map();
  for (const m of svg.matchAll(/fill="(#[0-9a-fA-F]{3,6})"[^>]*?(?:d="([^"]*)")?/g)) {
    const hex = m[1].length === 4 ? '#' + [...m[1].slice(1)].map((c) => c + c).join('') : m[1];
    weights.set(hex.toLowerCase(), (weights.get(hex.toLowerCase()) ?? 0) + 10 + (m[2]?.length ?? 0));
  }
  // also catch path-then-fill attribute order
  for (const m of svg.matchAll(/d="([^"]*)"[^>]*?fill="(#[0-9a-fA-F]{3,6})"/g)) {
    const hex = m[2].length === 4 ? '#' + [...m[2].slice(1)].map((c) => c + c).join('') : m[2];
    weights.set(hex.toLowerCase(), (weights.get(hex.toLowerCase()) ?? 0) + 10 + m[1].length);
  }
  const ranked = [...weights.entries()].filter(([h]) => !NEUTRALS.test(h)).sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const colors = ranked.slice(0, 6);
  const primary = colors[0] ?? '#5c6570';
  const secondary = colors[1] ?? '#d7dadd';
  out.teams[t.slug] = {
    iso: t.iso, name: t.name, twemoji_file: file,
    colors,
    ui: { primary, secondary, onLight: adjustForContrast(primary, 'onLight'), onDark: adjustForContrast(primary, 'onDark') },
    audited: false, note: '',
  };
  console.log(`${t.slug}: ${colors.join(' ')}`);
  await new Promise((r) => setTimeout(r, 120));
}
writeFileSync('data/team-colors.json', JSON.stringify(out, null, 1) + '\n');
console.log(`DONE — ${Object.keys(out.teams).length}/48 teams (all audited:false until human review)`);
