#!/usr/bin/env node
// build-raster.mjs — LOCAL-ONLY rasterization (macOS sips + Chrome
// headless; never runs in CI). Produces: favicon.ico, apple-touch-icon.png,
// og-default.png + 48 team OG PNGs. Re-run only when brand assets change.

import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const px = (f) => statSync(f).size;

mkdirSync('/tmp/g26-raster', { recursive: true });

// 1) favicon + touch icon via sips from the flat SVG variant
run('/usr/bin/sips', ['-s', 'format', 'png', 'site/brand/favicon-flat.svg', '--out', '/tmp/g26-raster/icon-1024.png', '-z', '1024', '1024']);
run('/usr/bin/sips', ['-z', '180', '180', '/tmp/g26-raster/icon-1024.png', '--out', 'site/apple-touch-icon.png']);
run('/usr/bin/sips', ['-z', '32', '32', '/tmp/g26-raster/icon-1024.png', '--out', '/tmp/g26-raster/icon-32.png']);
run('/usr/bin/sips', ['-s', 'format', 'ico', '/tmp/g26-raster/icon-32.png', '--out', 'site/favicon.ico']);
console.log(`favicon.ico ${px('site/favicon.ico')}B · apple-touch-icon.png ${px('site/apple-touch-icon.png')}B`);

// 2) OG PNGs via Chrome headless (text layout needs a real renderer)
if (!existsSync(CHROME)) { console.error('Chrome not found — OG PNGs skipped'); process.exit(1); }
const ogs = readdirSync('site/brand/og').filter((f) => f.endsWith('.svg'));
let n = 0;
for (const f of ogs) {
  const out = `site/brand/og/${f.replace('.svg', '.png')}`;
  run(CHROME, ['--headless=new', `--screenshot=${process.cwd()}/${out}`, '--window-size=1200,630',
    '--default-background-color=00000000', '--hide-scrollbars', `file://${process.cwd()}/site/brand/og/${f}`]);
  n++;
}
console.log(`OG PNGs rendered: ${n} (default + teams)`);
