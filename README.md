# Golazo 26

A static-site engine for a football tournament guide, written as plain Node with
no package dependencies at all. You point it at a folder of audited JSON, run one
script, and it writes a complete website — every page, every language, every
asset — into `dist/`.

The engine was built for the 2026 World Cup, and the site it bakes is live at
[golazo26.onwike.workers.dev](https://golazo26.onwike.workers.dev): all 104
matches with US kickoff times and free-TV listings, the 16 host venues, and all
48 squads, in six languages (English, Ìgbò, Twi, Spanish, French, and German).
The tournament has ended, so the site is now a finished record of it. It is a
non-commercial fan project with no ads and no affiliation with FIFA.

This repository is published as a showcase of that engine. It is here to be read
and run, not to be a live service. Day-to-day development happens in a private
working repo on a PR-gated dev/main flow, with versioned releases and an
automated bake-and-deploy on every merge to main; this mirror carries what that
pipeline ships.

## What it produces

The generator turns the datasets in `data/` into a browsable guide covering the
104-match tournament: fixtures with kickoff times, the 16 host venues, all 48
qualified squads, group tables, and a knockout bracket that can be viewed either
as a flat diagram or as an optional 3D scene. Output is ordinary HTML, CSS, and
JavaScript — no framework runtime, no build server, nothing to install before a
browser can open it.

## Running

```sh
node scripts/build.mjs  # from the repository root
```

Node 20 or newer. There is no `npm install` step, because there is nothing to
install. The script reads paths relative to the working directory, so run it
from the repository root; when it finishes, `dist/` holds the finished site and
any static file server can serve it.

## Layout

| Path | What lives there |
| --- | --- |
| `data/` | Versioned JSON datasets. Records carry the URL they came from. |
| `scripts/` | The generator and the ingest tools that refresh `data/`. |
| `scripts/lib/` | Rendering helpers, the string table, and shared view modules. |
| `site/` | Client assets copied into the output: stylesheets, scripts, fonts, brand art. |
| `site/vendor/` | Vendored third-party browser modules, pinned and self-hosted. |
| `test/` | Node test files covering the generator and its data contracts. |
| `dist/` | Generated. Not checked in. |

## Images

The datasets ship without photographs. Portraits come from Wikimedia Commons
under rules I kept deliberately strict: a photo is matched to its person by
Wikidata QID rather than by name, it has to pass a license allowlist, and it
carries its author and license credit on every page where it appears. The ingest
scripts in `scripts/` build that image set locally; a subject with no cleared
photo gets an initials avatar, and the site builds fine with no photos at all.
The full policy is in [ATTRIBUTION.md](ATTRIBUTION.md).

## The AI prediction league

Through the tournament the site ran a small side game: four AI models (Claude,
ChatGPT, Gemini, and Grok) predicted a score for every match and were graded
against the real results, 3 points for the exact score and 1 for the right
outcome. The final table is still up, and with the tournament finished it makes
a tidy little benchmark of how the four did at the same forecasting job.

## Ideas

**Bake first, hydrate second.** Every page is complete HTML before a visitor
arrives. Live match state is layered on afterwards by a small script that patches
the pages already on screen, so a reader with JavaScript off still gets the whole
guide.

**Every fact has an address.** Datasets record where each value came from. When
a value has not been confirmed, pages say so rather than guessing.

**Progressive enhancement, and it means it.** Local kickoff times, filters,
translations, and the 3D bracket are all layers over a page that works without
them. Each layer checks whether it is welcome before it runs — reduced-motion
preferences, small viewports, and low-memory devices all turn the heavy ones off.

**No dependencies.** Not a stylistic flourish: it is what keeps a site this size
buildable from a clean checkout years from now.

## More reading

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit together.
- [ATTRIBUTION.md](ATTRIBUTION.md) — upstream data, artwork, and fonts, with their licenses.
- [ROADMAP.md](ROADMAP.md) — where the engine is heading.
- [LICENSE](LICENSE) — MIT, for the code in this repository.
