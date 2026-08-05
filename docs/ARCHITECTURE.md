# Architecture

## What this repository is

This is a showcase of a static-site generator, not an operational deployment. It
contains the engine, the datasets it reads, and the client-side code it emits.
There is no server to stand up, no infrastructure definition to apply, and no
scheduler running anywhere in here. Anyone who clones it can run the generator
and get the same output that the published guide is built from; nobody who clones
it inherits a running system.

Read the sections below as a description of the machine, in the order data moves
through it.

---

## 1. Ingest — pinned upstream, versioned locally

Nothing in the site talks to an upstream provider at page-view time. Instead, the
scripts in `scripts/` fetch from public sources on demand and write the result
into `data/` as ordinary JSON that is reviewed and committed like any other file.

Each ingest script owns one dataset and one shape. The fixture list, the squad
lists, the venue records, the flag map, and the team palettes are all built this
way, and every record keeps the URL it was derived from alongside the value. Two
consequences fall out of that choice:

- **The build is reproducible.** A checkout plus Node reproduces the site byte
  for byte. Upstream can go down, rate-limit, or reshape its API without
  affecting anyone building the site today.
- **Corrections are diffs.** When a source is wrong, the fix is a reviewable
  change to a JSON file, not an invisible cache eviction.

Where a value is not confirmed, the dataset leaves it unset and the page renders
a placeholder. The generator has no path that invents a plausible substitute.

## 2. Generation — one script, one pass, no dependencies

`scripts/build.mjs` is the whole build. It loads the datasets, then emits the
complete site into `dist/` in a single pass: the fixture list and per-match pages,
group tables, venue and squad pages, the bracket, the static assets copied from
`site/`, and the redirect and header files a static host needs.

Rendering is done with template literals and small helper modules under
`scripts/lib/` — an escaping layer, a URL sanitiser, a date formatter that keeps
tournament time and visitor time distinct, and one shared string table. There is
no template language and no plugin system, because there is exactly one site to
generate and speculative flexibility would cost more than it returns.

Two properties are worth calling out because they shape everything downstream:

- **Output is inert.** The generator writes files. It does not deploy, publish,
  or notify.
- **Pages are complete.** Every page is fully readable as delivered. The client
  scripts described below only ever refine a page that already says the right
  thing.

## 3. Hydration — patching a finished page

Live tournament state is the one thing that cannot be baked, because it changes
while the page is open. The client handles it with the smallest mechanism that
works: a short poll for a small JSON snapshot of current match state, followed by
in-place patches to the score, status, and table cells already present in the DOM.

The rules the hydrator follows are deliberately narrow.

- It fetches a snapshot document and, if that request fails for any reason, falls
  back to a snapshot baked into the site at build time. A reader never sees an
  error state caused by the live layer.
- It mutates existing nodes rather than re-rendering regions. Nodes that carry
  live values are the same DOM nodes for the lifetime of the page, which is what
  lets the translation layer coexist with it (see below).
- It polls only while matches could plausibly be in progress, and re-checks when
  a backgrounded tab returns to the foreground.

Everything else on the page — filters, sorting, visitor-local kickoff times — is
pure client enhancement over baked markup, re-runnable at any time and idempotent
by construction, because several layers may enhance the same subtree in sequence.

## 4. The translation overlay

The site ships in English and five additional languages (Spanish, French, German,
Igbo, Twi). Translation is an overlay in two tiers, and the split matters.

**Chrome tier.** Short, structural labels — navigation, column headings, buttons —
are baked into the HTML once per language as sibling spans scoped by language.
A single attribute on the root element decides, in CSS, which set is visible.
That flip happens before first paint, so switching language never shows a frame
of the wrong text.

**Prose tier.** Longer passages are too large to bake five times into every page.
Instead the build emits one JSON fragment per language per route, and the client
swaps the matching sections in when a non-English language is active. The root
language attribute is only updated once that swap has completed.

Two safeguards keep the overlay from fighting the live layer. Subtrees that carry
live values are explicitly marked as never-translated, and they survive a section
swap as the very same nodes, so a score being updated mid-swap is never orphaned.
And when a fragment is missing, slow, or malformed, nothing happens at all: the
page stays in English. The degraded path is the designed path, not an accident.

## 5. The knockout room — optional 3D, strictly opt-in

The bracket has two presentations behind a `[2D | 3D]` toggle. The flat diagram is
the default and the guaranteed one; the 3D scene is an extra.

- **It is not offered unless it makes sense.** No WebGL, a reduced-motion
  preference, a narrow viewport, or a low reported device memory each suppress
  the toggle entirely.
- **Nothing loads until it is asked for.** The three.js runtime and the glTF
  models are dynamic imports from the same origin, triggered by the first opt-in.
  A visitor who never touches the toggle downloads none of it.
- **The scene has no data source of its own.** It builds its model by reading the
  already-baked 2D bracket out of the DOM, and it re-syncs through a debounced
  observer when the hydration layer changes those cells. There is exactly one
  source of truth for match state on the page, and the 3D layer is downstream of
  it rather than beside it.
- **Turning it off is complete.** Toggling back to 2D disposes the GL context and
  the scene graph and restores the flat view immediately.

The scene itself is built for a low, flat frame cost: baked lighting rather than
real-time lights, a small fixed set of materials, and a fixed-cardinality model
sized to the tournament (12 groups, 16 first-round ties, then 8, 4, 2, 1) so that
no part of it grows with the data.

## 6. Testing

The tests under `test/` are plain `node --test` files with no runner or harness to
install. They cover the shapes the generator depends on — dataset integrity,
string-table uniqueness, escaping at every markup sink, the translation
fragments' numeric fidelity against their English source, and structural pins on
the generated HTML that would otherwise drift silently.

They are unit and contract tests over a pure function from data to files, which is
the useful thing about a generator with no runtime: almost everything worth
asserting can be asserted without a browser.

---

## Why it is shaped this way

The whole design follows from one constraint: the site had to be correct, fast,
and cheap to keep alive for a tournament that lasts weeks and an archive that
lasts longer. Baking everything makes it fast and cheap. Keeping provenance in the
data makes it correctable. Refusing dependencies makes it still buildable when the
tournament is a memory. The interesting engineering is in what each layer is
*forbidden* to do — the live layer may not re-render, the translation layer may
not touch live nodes, the 3D layer may not fetch — and those prohibitions are what
let five independent enhancements share one page without collisions.
