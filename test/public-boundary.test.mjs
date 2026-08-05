// The public/private boundary of the SHIPPED tree itself. The leak gate reads file CONTENT; this
// test pins the other half — which files exist at all. Operations tooling, CI wiring, the worker
// sources, the agent workspace, unpublished profile/certification data and every non-public
// deploy config stay behind; site/img ships only the three 3D models the public site loads.
//
// BEHAVIOUR CHOSEN — green in the private repo by an explicit SKIP, load-bearing in the exported
// tree, and LOUD on anything in between. Every path below is present in the working repo, so
// asserting them unconditionally would fail the private suite; the test therefore classifies the
// tree first. The classification is deliberately fail-closed TOWARD asserting: only a tree in
// which EVERY private-only path is still present is treated as the working repo. A tree that has
// lost any of them is treated as shipped and fully asserted, so a half-scrubbed export fails here
// rather than skipping — the skip cannot be reached by a partial export, only by an untouched one.
// Content alone cannot tell the working repo from an export that scrubbed nothing, so the release
// gate should also export GOLAZO_PUBLIC_TREE=1 when it runs this suite against the exported tree;
// that declaration overrides the inference and makes even a no-op export fail.
// test/public-privacy-link.test.mjs carries the same list and rule; they are kept in step by hand
// rather than shared, because every .mjs under test/ is executed by `node --test test/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

const PRIVATE_ONLY = ['.claude', '.github', 'worker', 'scripts/lib/ops-hub.mjs', 'data/profiles', 'data/history/certs'];
const isWorkingRepo =
  process.env.GOLAZO_PUBLIC_TREE !== '1' && PRIVATE_ONLY.every((rel) => existsSync(join(repo, rel)));
const skip = isWorkingRepo
  ? { skip: 'private working repo: these paths ship only after the release export removes them; asserted in the shipped tree' }
  : {};

// The only deploy config the public tree carries. Every other wrangler config names private
// infrastructure (accounts, database ids, routes) and must not ship.
const PUBLIC_WRANGLER = 'wrangler.public.toml';
const SHIPPED_MODELS = [
  'site/img/cauldron/wc-cauldron.glb',
  'site/img/cauldron/wc-hood.glb',
  'site/img/trophy/wc-trophy.glb',
];

test('public boundary: private-only paths are absent from the shipped tree', skip, () => {
  const survivors = PRIVATE_ONLY.filter((rel) => existsSync(join(repo, rel)));
  assert.deepEqual(survivors, [], `private-only paths survived the export: ${survivors.join(', ')}`);
});

test('public boundary: only the public deploy config ships', skip, () => {
  const configs = readdirSync(repo).filter((name) => /^wrangler\b.*\.toml$/.test(name));
  const leaked = configs.filter((name) => name !== PUBLIC_WRANGLER).sort();
  assert.deepEqual(leaked, [], `non-public deploy configs survived the export: ${leaked.join(', ')}`);
});

test('public boundary: site/img ships only the three 3D models', skip, () => {
  const root = join(repo, 'site/img');
  const files = existsSync(root)
    ? readdirSync(root, { recursive: true })
        .map((rel) => join('site/img', rel))
        .filter((rel) => statSync(join(repo, rel)).isFile())
        .sort()
    : [];
  assert.deepEqual(
    files,
    SHIPPED_MODELS,
    'site/img must ship exactly the three 3D models the public site loads — every other image is licensed or unpublished material',
  );
});
