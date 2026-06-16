# Architecture

Golazo 26 is a **bake-don't-serve** static site. There is no application server,
no database in the request path, and no code running when you load a page. A
single Node generator turns a set of sourced JSON datasets into a folder of plain
HTML, and that folder is served as static files. This document explains how the
pieces fit and how to extend them.

## The shape of it

```
data/*.json   ──┐
                ├──►  node scripts/build.mjs  ──►  dist/   ──►  static host
site/*        ──┘        (the generator)         (HTML +        (Cloudflare
(static assets)                                   assets)         Workers)
```

Three inputs, one command, one output:

- **`data/`** — the datasets the whole site is built from: matches, teams,
  rosters, people, venues, broadcasts, image metadata. Every record carries its
  own `source_url`. This is the source of truth.
- **`site/`** — static assets that get copied into the build verbatim: CSS,
  client JS, fonts, icons, brand marks, flags.
- **`scripts/build.mjs`** — the generator. It reads `data/`, renders every page,
  copies `site/` in, and writes the finished site to `dist/`.

`dist/` is disposable — it's `.gitignore`d and regenerated from scratch on every
build. Nothing downstream of the generator is hand-edited.

## The data pipeline

The build is a pure function of its inputs: same `data/` in, same `dist/` out.
For one build run:

1. **Load + validate** the JSON datasets. Counts that should reconcile do
   reconcile (104 matches, 48 teams, squads of 23–26) or the build is wrong.
2. **Render** every page from that data: the Today view, the schedule, one page
   per match, one per team, venues, groups, the how-to-watch guides (English and
   Spanish), the calendar and per-team `.ics` feeds, the prediction league and
   leaderboard, history, sources, and the static pages.
3. **Assemble** `dist/` — render the HTML, copy `site/` across, and emit the
   machine-readable exports (e.g. the schedule as JSON) alongside it.

Helper scripts in `scripts/` prepare data and images *before* a build (resolving
player photos to a Wikidata QID, pinning flag SVGs, mirroring thumbnails). They
feed `data/` and `site/`; they are not part of rendering. The generator itself is
the only thing that produces a page.

## Zero dependencies

`build.mjs` imports nothing but `node:fs`. There is no `package.json`, no
`node_modules`, no install step. You need a recent Node and that's it:

```sh
node scripts/build.mjs
```

The point isn't minimalism for its own sake — it's that the build can't rot. No
dependency can break it, go unmaintained, or quietly change its behaviour between
runs. A clone from years from now still builds the same site.

## Why static assets

The site deploys to Cloudflare Workers as **assets only** — no fetch handler, no
secrets, no server code (`wrangler.public.toml` is the structural guarantee of
this; never add a `main` to it). That choice buys three things:

- **No metered requests.** Static asset requests are free and exempt from the
  account request cap. A viral matchday cannot run up a bill.
- **It fails closed.** There's no live backend to crash. If my build machine is
  off, the last good `dist/` is still being served. The worst failure mode is
  *slightly stale*, never *down*.
- **It's cheap and fast.** Pages are pre-rendered HTML; nothing is computed at
  request time. Serving files costs effectively nothing.

The site updates by **rebaking**: a scheduled job pulls fresh scores, rebuilds
`dist/`, and redeploys only when something actually changed. The live page is
always a finished artifact, never a render-on-demand.

## Provenance discipline

The hard rule, enforced end to end:

> Every fact carries a source. Anything that can't be sourced renders as **TBD** —
> never a guess.

Concretely:

- Datasets require a `source_url` per record. Schedule data is cross-checked
  across independent sources before it's trusted.
- Photos are matched to people by **Wikidata QID**, never by name string, and
  must pass a license allowlist; a subject without a verified, cleared photo gets
  a neutral initials avatar rather than a near-match. Full policy in
  [ATTRIBUTION.md](../ATTRIBUTION.md).
- Undetermined things stay undetermined on the page. Knockout fixtures show the
  official "Winner Group X" placeholders until the bracket is decided — the site
  never fills them with a prediction.

A wrong kickoff time or a misidentified player is worse than a blank, so the
default is to show less.

## How to extend it

Because the build is data-in / HTML-out, most changes are small and local:

- **Add or fix a fact** → edit the relevant `data/*.json` (with its `source_url`)
  and rebuild. No code change.
- **Add a page or section** → add a render step in `scripts/build.mjs` that reads
  from `data/` and calls `writeFileSync` into `dist/`. Follow the existing
  shared page shell so navigation, theming, and metadata come for free.
- **Add a static asset** (icon, font, style) → drop it in `site/`; it's copied
  into the build as-is.
- **Add a new dataset** → write a small `scripts/` helper that produces a sourced
  JSON file under `data/`, then read it in the generator.

Keep three invariants and you won't break the design: the generator stays a pure
function of `data/` + `site/`; the public deploy stays assets-only; and nothing
ships a fact without a source.
