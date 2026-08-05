// The /about page's contact point must be a LIVE LINK to the PUBLIC repo. It previously read
// "Contact: via the repository." as plain prose — naming a contact route the reader had no way
// to reach — and the only other repo link on the site (the privacy page's issues link) points at
// the project's private repo, which a public reader cannot open. A reader needs a reachable
// contact route, so the affordance is pinned here.
//
// Source-scan (not a bake): the assertion is about the template's contact affordance, and the
// repo's other one-line template guarantees are pinned this way too (see bracket-monument-source).
//
// This file ships in the public tree, so it names ONLY the public repo. The "not some other
// repo" half of the guarantee is carried by an EQUALITY assertion on the contact line's links —
// a href that IS the public URL cannot be any other repo — rather than by spelling a private
// name out. A test that quoted the private repo would trip the release leak gate on itself, and
// exempting a file from that gate would leave a standing hole behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = readFileSync(join(repo, 'scripts/build.mjs'), 'utf8');
// i18n a later change: the contact copy moved into the canonical string table (S.pages.about.contact) —
// scan both files so the pin follows the string wherever the table keeps it.
const STRINGS = readFileSync(join(repo, 'scripts/lib/strings.mjs'), 'utf8');
const PUBLIC_REPO = 'https://github.com/onwike/golazo26';

test('about: the contact point is a link to the PUBLIC repo (not bare prose, not another repo)', () => {
  const line = (BUILD + '\n' + STRINGS).split('\n').find((l) => l.includes('Built by a fan'));
  assert.ok(line, 'the about page still carries the "Built by a fan" contact line');

  const hrefs = [...line.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  // Equality, not inclusion: pins the contact line to exactly one link AND that link to the
  // public repo. This subsumes the old "must not be the private repo" negative — and every
  // other wrong destination with it — without naming any repo but the public one.
  assert.deepEqual(
    hrefs,
    [PUBLIC_REPO],
    `the contact line must carry exactly one link, to ${PUBLIC_REPO} — a reader needs a reachable contact route`,
  );
  assert.ok(line.includes('rel="noopener"'), 'external link carries rel="noopener" (site convention)');
});

// The contact route IS translated: every shipped chrome pack carries its own pages.about.contact
// with its own copy of the link. Checking English alone would pass while a translated pack pointed
// a German or Twi reader somewhere else, so the packs are asserted too. Unlike the privacy
// data-request route, this one needs no export rewrite — every pack already carries the public
// URL — so the assertion runs unconditionally, in the working repo and the shipped tree alike.
// Packs are DISCOVERED (any data/i18n subdirectory carrying a chrome.json), so a language added
// later is covered automatically; discovery that finds nothing FAILS rather than passing vacuously.
const I18N = join(repo, 'data/i18n');
const packLangs = existsSync(I18N)
  ? readdirSync(I18N, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(I18N, d.name, 'chrome.json')))
      .map((d) => d.name)
      .sort()
  : [];

test('about: every translated contact link points at the PUBLIC repo too', () => {
  assert.ok(
    packLangs.length > 0,
    'no translated chrome pack was discovered under data/i18n — with an empty set this test would pass without checking anything',
  );
  let checked = 0;
  const unreadable = [];
  for (const lang of packLangs) {
    const pack = JSON.parse(readFileSync(join(I18N, lang, 'chrome.json'), 'utf8'));
    const where = `data/i18n/${lang}/chrome.json → pages.about.contact`;
    if (!('pages.about.contact' in pack)) continue; // untranslated: the bake falls back to English
    const html = pack['pages.about.contact'];
    // Present-but-unreadable must fail, never shrink the checked set silently.
    if (typeof html !== 'string') {
      unreadable.push(`${where} (${typeof html})`);
      continue;
    }
    checked += 1;
    assert.deepEqual(
      [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]),
      [PUBLIC_REPO],
      `${where} must carry exactly one link, to ${PUBLIC_REPO} — a reader in every language needs a reachable contact route`,
    );
    assert.ok(html.includes('rel="noopener"'), `${where} link carries rel="noopener" (site convention)`);
  }
  assert.deepEqual(unreadable, [], 'these pack entries exist but are not strings, so they could not be checked');
  assert.ok(checked > 0, `none of the discovered packs [${packLangs.join(', ')}] carried a contact link to check`);
});
