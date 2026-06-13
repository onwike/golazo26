#!/usr/bin/env node
// build-brand.mjs — writes every committed brand asset from the
// template module + audited team colors. Zero network. Refuses unaudited rows.
// Run order on brand change: build-brand -> build-raster (local mac) -> build.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DIRECTIONS, wobblePath } from './brand-tokens.mjs';
import { markBallO, faviconSVG, faviconFlatSVG, teamBanner, doodlesSVG, heroSVG, ogSVG } from './brand-templates.mjs';

const direction = JSON.parse(readFileSync('data/brand-direction.json', 'utf8')).direction;
const T = DIRECTIONS[direction];
if (!T) { console.error(`⛔ unknown direction ${direction}`); process.exit(1); }

const tc = JSON.parse(readFileSync('data/team-colors.json', 'utf8'));
const unaudited = Object.entries(tc.teams).filter(([, t]) => !t.audited);
if (unaudited.length) { console.error(`⛔ ${unaudited.length} unaudited team-color rows — refusing`); process.exit(1); }
if (Object.keys(tc.teams).length !== 48) { console.error('⛔ expected 48 team-color rows'); process.exit(1); }

mkdirSync('site/brand/teams', { recursive: true });
mkdirSync('site/brand/og', { recursive: true });

writeFileSync('site/favicon.svg', faviconSVG(T));
writeFileSync('site/brand/favicon-flat.svg', faviconFlatSVG());
writeFileSync('site/brand/doodles.svg', doodlesSVG(T, (d) => wobblePath(d, T, 24)));
writeFileSync('site/brand/hero.svg', heroSVG(T));
writeFileSync('site/brand/og/og-default.svg', ogSVG(T));

let banners = 0;
for (const [slug, c] of Object.entries(tc.teams)) {
  const banner = teamBanner(c, T);
  writeFileSync(`site/brand/teams/${slug}-banner.svg`, banner);
  writeFileSync(`site/brand/og/${slug}-og.svg`, ogSVG(T, { title: 'Golazo 26', claim: `${c.name} at the 2026 World Cup — fixtures, squad, how to watch free.`, banner }));
  banners++;
}

// the inline header mark, exported for build.mjs to import as a constant
writeFileSync('site/brand/mark.svg', markBallO(T, { ink: 'currentColor' }));

console.log(`brand assets written — direction=${direction}, banners=${banners}, og-svgs=${banners + 1}`);
