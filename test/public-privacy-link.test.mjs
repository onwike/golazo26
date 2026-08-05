// The privacy page's data-request route must be reachable by the reader it is written for — in
// EVERY language the site ships, not just English. These two strings are the site's advertised
// route for privacy and GDPR/CCPA access/deletion requests, so a link the public cannot open is
// not a cosmetic defect: it breaks the only contact channel the policy names.
//
// FIXED AT SOURCE (2026-08-05). Both strings previously pointed at the project's
// PRIVATE issue tracker, which 404s for every public visitor, and were corrected to the public
// repository in the English table AND in all five translated packs — twelve surfaces in total.
// Before that fix this assertion could only be made about the EXPORTED tree, because the source
// itself was wrong; it is now true of both trees, which is why nothing here is skipped any more.
// The export still carries a URL rewrite for this route, but it is now a no-op safety net rather
// than the thing standing between a reader and a working contact link.
//
// WHY THIS COVERS THE TRANSLATED PACKS: the same two strings are baked into every translated
// chrome pack under data/i18n/<lang>/chrome.json. A test that checked only the English string
// table would PASS while the private URL shipped to readers in five languages — a German or Twi
// visitor clicking the data-request link would land at a repository they cannot open, and the
// gate would have called that green. So the assertions run over one merged set of SURFACES:
// the English table plus every discovered pack. That English-only blind spot is a defect this
// project has already shipped once; it is the reason discovery below is mandatory.
//
// Packs are DISCOVERED, not enumerated — a sixth language added later is covered automatically,
// and this project has added languages before. Discovery that finds nothing is a FAILURE, never
// a silent pass: an empty surface set would make every assertion below vacuous.
//
// EXPECTATION — stated here and encoded in the assertions, not left to whichever tree runs it.
// BOTH assertions now run in EVERY tree, pre- and post-export, on every surface:
//   · "carries exactly one repo issues link" pins the SHAPE the export's rewrite depends on, so a
//     link that was retargeted, dropped, or split in two fails here rather than slipping through.
//   · "points at the PUBLIC repo" is the regression guard on the source fix. If anyone reintroduces
//     the private URL — in the English table or in any one language pack — this reds immediately,
//     in the working repo, instead of waiting for an export that may not run for weeks.
//
// Like its siblings this file ships publicly, so it names only the public repo; the private repo
// is described by SHAPE (owner + /issues) and never spelled out. A test that quoted the private
// name would trip the release leak gate on itself, and exempting a file from that gate would
// leave a standing hole behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S } from '../scripts/lib/strings.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

// No tree classification here any more. This file previously distinguished the private working
// repo from an export so it could SKIP the public-URL assertion in the former, because the source
// genuinely carried the private URL. The source is now correct in both trees, so the distinction
// bought nothing except a gate that did not run where the defect actually lived.
// (test/public-boundary.test.mjs still classifies the tree — it asserts on paths that legitimately
// differ between the two. Its copy is unaffected by this removal.)
const PUBLIC_ISSUES = 'https://github.com/onwike/golazo26/issues';
// Owner + /issues with the repo name left open — matches the pre-export and post-export URL alike.
const ISSUES_SHAPE = /^https:\/\/github\.com\/onwike\/[A-Za-z0-9._-]+\/issues$/;
const CONTACT_KEYS = ['whoRuns', 'rightsB'];
const hrefsOf = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

// Discovery: a shipped language is any data/i18n subdirectory carrying a chrome.json (this is what
// excludes the corpus/ working directory, rather than a hand-kept list of language codes).
const I18N = join(repo, 'data/i18n');
const packLangs = existsSync(I18N)
  ? readdirSync(I18N, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(I18N, d.name, 'chrome.json')))
      .map((d) => d.name)
      .sort()
  : [];

// One merged set of surfaces: the English string table, then every discovered pack. A pack that
// OMITS a key contributes nothing for it — the bake falls back to the English string, which the
// English surface already covers — so a partially translated pack is not a false alarm.
//
// A key that is PRESENT but not a readable string is a different case entirely, and it must
// never be silently dropped from the set — that is exactly how a fail-closed gate reports a
// vacuous pass. Such entries are collected and asserted on below rather than filtered out.
const surfaces = [];
const unreadable = [];
for (const key of CONTACT_KEYS) {
  surfaces.push({ where: `S.pages.privacy.${key}`, html: S.pages.privacy[key] });
}
for (const lang of packLangs) {
  const pack = JSON.parse(readFileSync(join(I18N, lang, 'chrome.json'), 'utf8'));
  for (const key of CONTACT_KEYS) {
    const packKey = `pages.privacy.${key}`;
    const where = `data/i18n/${lang}/chrome.json → ${packKey}`;
    if (!(packKey in pack)) continue; // untranslated: the bake falls back to the English surface
    const html = pack[packKey];
    if (typeof html !== 'string') unreadable.push(`${where} (${typeof html})`);
    else surfaces.push({ where, html });
  }
}

test('privacy: the translated packs are discovered (an empty set would pass everything vacuously)', () => {
  assert.ok(
    packLangs.length > 0,
    'no translated chrome pack was discovered under data/i18n — with an empty set the assertions below would pass without checking anything',
  );
  assert.ok(
    surfaces.length > CONTACT_KEYS.length,
    `no translated pack contributed a data-request link (only the ${CONTACT_KEYS.length} English surfaces were found, from packs [${packLangs.join(', ')}]) — the translated bakes would go unchecked`,
  );
  // Present-but-unreadable entries fail here rather than quietly shrinking the checked set.
  assert.deepEqual(
    unreadable,
    [],
    'these pack entries exist but are not strings, so they could not be checked — a fail-closed gate must fail on them, not drop them from the set',
  );
});

test('privacy: every data-request contact carries exactly one repo issues link', () => {
  for (const { where, html } of surfaces) {
    assert.ok(html, `${where} still exists`);
    const hrefs = hrefsOf(html);
    assert.equal(
      hrefs.length,
      1,
      `${where} must carry exactly one link — the export rewrites this route by URL, so a second link or none would slip past it`,
    );
    assert.match(hrefs[0], ISSUES_SHAPE, `${where} must link an issue tracker under the project owner`);
    assert.ok(html.includes('rel="noopener"'), `${where} link carries rel="noopener" (site convention)`);
  }
});

test('privacy: the data-request contact points at the PUBLIC repo, in every language', () => {
  for (const { where, html } of surfaces) {
    assert.deepEqual(
      hrefsOf(html),
      [PUBLIC_ISSUES],
      `${where} must point the reader at ${PUBLIC_ISSUES} — a data-request route the public can actually open, in every language the site ships`,
    );
  }
});
