# Attribution

This repository is assembled from a small number of clearly-licensed upstream
works plus material made for the project. Everything third-party is listed below
with the path it occupies in the tree, so a reader can check any entry against
the files rather than taking this document's word for it.

The site carries no advertising and is not a commercial product.

## Code in this repository

MIT — see [LICENSE](LICENSE). The generator, the ingest scripts, the client-side
JavaScript, and the stylesheets are all covered by it.

## Vendored browser libraries — `site/vendor/`

The optional 3D bracket uses **three.js** (r160), self-hosted rather than loaded
from a CDN, together with three modules from the same project's examples set:

| File | Upstream | License |
| --- | --- | --- |
| `three.module.min.js` | three.js r160 | MIT — Copyright 2010-2023 Three.js Authors |
| `GLTFLoader.js` | three.js examples | MIT, same terms |
| `CSS3DRenderer.js` | three.js examples | MIT, same terms |
| `BufferGeometryUtils.js` | three.js examples | MIT, same terms |

The SPDX identifier and copyright line are preserved in the bundle header.

## Typefaces — `site/fonts/`

The display face is **Barlow Condensed** (Copyright The Barlow Project Authors),
shipped as subsets containing only the glyphs the site draws. Four glyphs used by
the Twi orthography (the open vowels, upper and lower case) do not exist in any
Barlow release; those are subset from **Noto Sans** (Copyright The Noto Project
Authors) at a matching weight and ship as their own file,
`barlow-condensed-600-african-noto.woff2` — the `barlow-condensed` prefix names
the stack the file serves, not the outlines inside it, which are Noto's.

Both families are licensed under the **SIL Open Font License 1.1**, which permits
subsetting. The license text ships alongside the fonts at
[`site/fonts/OFL.txt`](site/fonts/OFL.txt), carries the copyright notice of both
families, and governs every subset in that directory. Neither family reserves a
font name, so the naming above carries no further obligation.

## Flag artwork — `site/brand/flags/` and `site/brand/flags.svg`

Country flags are **Twemoji** artwork, licensed **CC BY 4.0** and credited to the
Twemoji project (currently maintained at `jdecked/twemoji`). Two copies of that
artwork ship, both pinned at Twemoji **v15.1.0** and served from this origin
rather than fetched at page load:

- `site/brand/flags/` — 48 standalone SVG files, one per qualified team.
- `site/brand/flags.svg` — a sprite sheet carrying the same 48 flags as reusable
  `<symbol>` elements. It is assembled from that same artwork, so it is a
  derivative work under the identical CC BY 4.0 obligation. It sits beside the
  flag directory rather than inside it.

The mapping from team to file, along with the same pin and credit, is recorded in
`data/flag-map.json`.

## AI model marks — `site/brand/ai-logos.svg`

One sprite sheet holding the four marks the site uses to say which AI model made
a given prediction. **This file is not artwork made for the project.** The
geometry comes from two upstream icon sets, and the file declares as much in a
comment at its head. The two sets carry different terms, so they are separated
here.

**The OpenAI and Grok marks come from lobehub/lobe-icons, which is MIT
licensed.** MIT requires that its copyright notice and permission notice be
retained in redistributions, so the notice is reproduced in full:

```
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**The Claude and Gemini marks come from simple-icons, whose packaging is
released under CC0 1.0.** CC0 asks for nothing in return. The credit is here
anyway, because a reader checking this document against the tree should be able
to find where every shipped mark came from, not only the ones a licence compels
us to name.

Both sets are drawn in a single colour through `currentColor` so they stay
legible in either theme; that recolouring is the only change made to them.

**The marks themselves are trademarks, and neither licence above conveys any
right in them.** A copyright licence over an SVG path covers the drawing, not
the brand it depicts. Anthropic, OpenAI, Google, and xAI own the respective
marks, and their use here is nominative identification — labelling whose model
produced a prediction — not endorsement, affiliation, or sponsorship.

## Match schedule — `data/matches.json`

The fixture list is seeded from **openfootball/worldcup.json**, which its authors
publish as public-domain data, and cross-checked against **fixturedownload.com**,
which carries its own site terms. Both source URLs are stored on each of the 104
match records, so the provenance of an individual fixture is readable from the
data itself rather than from this file.

**The compiled dataset carries no licence statement of its own.** `matches.json`
records provenance but not terms, and rather than manufacture a grant this
document says so plainly: what is verified is where each fixture came from, not
what licence the assembled file is offered under. Treat the upstream terms above
as the ones that bind, and ask if you need something clearer.

Live scores and status, where the site shows them, come from public score feeds at
tournament time and are not part of the committed dataset.

## Squads — `data/rosters.json`

Squad and staff lists derive from the English Wikipedia article *2026 FIFA World
Cup squads*, taken at a **pinned revision** (`oldid=1358656369`) and covering 48
teams and 1,246 players. Wikipedia text is licensed **CC BY-SA 4.0**; the dataset
records the license, its URL, and a permalink to the exact revision used, and the
site renders that credit on every page built from it.

Name romanisation follows the same source, which occasionally differs from other
published spellings of the same name.

## Tournament history — `data/history/`

One record per past World Cup, 1930 through 2022, plus a hub record and a
structured facts file. Two different things are being credited here, and they need
separating.

**The prose was written by an AI model, not by a person.** Every narrative record
in `data/history/` carries a `model` field recording that, alongside a
`written_at` timestamp and the `sources` list its subject was researched from.
Nothing in this tree is human-authored editorial, and this document would rather
say that than let a reader assume otherwise.

**The sources are third-party and cited per record.** The `sources` array on each
record holds the title and URL of every reference used. English Wikipedia is the
dominant source and is licensed **CC BY-SA 4.0**; the remainder are public pages
from FIFA, ESPN, Britannica, the RSSSF, Olympics.org and similar publishers, cited
as references rather than reproduced.

What that means in practice: the facts belong to the cited sources and are not
ours to license; the wording is original text generated for this project and ships
under the terms in [LICENSE](LICENSE); and where any passage tracks a CC BY-SA
source closely enough to count as a derivative of it, that source's share-alike
terms apply and its citation on the record is the attribution. If you intend to
reuse this prose, read the record's `sources` list first — it is there precisely so
you can.

These records carry no licence field of their own. As with the schedule, that is
stated rather than filled in with a guess.

## Venue and city writing — `data/stadiums/` and `data/stadiums/cities/`

The same shape as the history tree, for the 16 host venues: a prose record per
venue, a matching `.facts.json` of structured, individually-sourced values, a hub
record, and a combined facts file.

There is a **second set of prose records** beside them, in `data/stadiums/cities/`
— one per host city rather than per venue, sixteen of them, keyed by `city_id`
and about the place rather than the ground. They sit in a subdirectory, so a
reader scanning only the parent path can miss them; they are called out here for
that reason.

**The prose is AI-generated on the same terms — both sets.** Every venue record
and every city record carries a `model` field recording that, with a
`written_at` stamp and a `sources` list. The separate
`.facts.json` files are where the checkable material lives: capacities, opening
dates, architects, tenants and renovation history, each carrying its own source
URL, several of them pinned to a specific Wikipedia revision.

**Sources.** English Wikipedia again dominates and is **CC BY-SA 4.0**; the rest
are public pages from FIFA, StadiumDB, ESPN, Britannica, municipal and provincial
government sites, clubs and broadcasters. Every one of them is cited in the record
that relies on it. The city records cite the same kinds of publisher, in the same
per-record form, so everything said here applies to them identically.

The licensing position is identical to the history tree: cited facts stay with
their sources, the generated wording ships under [LICENSE](LICENSE), share-alike
follows any passage that is genuinely derivative of a CC BY-SA source, and no
licence is asserted for the compiled files because none is recorded in them.

## Photography

The ingest tooling can source portraits and team photography from **Wikimedia
Commons**, matched to a subject by Wikidata identifier and filtered through a
license allowlist that admits only public-domain, CC0, CC BY, and CC BY-SA files.
Every accepted image records its author, license, and Commons file page, and those
credits are rendered on the page wherever the image appears; derivatives of
share-alike originals are shared under the same terms.

**This repository does not ship that photography.** The image tree here contains
no Commons files. Anyone running the ingest scripts fetches their own copies and
inherits the per-file obligations recorded alongside them.

## 3D models — `site/img/`

Three glTF binaries are used by the optional 3D bracket scene:

- `site/img/trophy/wc-trophy.glb`
- `site/img/cauldron/wc-cauldron.glb`
- `site/img/cauldron/wc-hood.glb`

They were made for this project and are distributed with it under the terms in
[LICENSE](LICENSE). No third-party model library is vendored here.

## Artwork made for the project

The brand mark, doodles, social cards, and per-team banner art in `site/brand/`
are generated by this repository's own scripts from the palettes in `data/`. The
three site icons are rasterised from that same brand mark and sit at the top of
the site tree rather than inside `site/brand/`:

- `site/favicon.svg`
- `site/favicon.ico`
- `site/apple-touch-icon.png`

**The four character illustrations were generated by an AI model, not drawn by a
person.** They were made for this project, but unlike the icons above they are
not derived from the brand mark, and they are the one part of this section that
is not the output of the repository's own scripts:

- `site/personas/claude.webp`
- `site/personas/gemini.webp`
- `site/personas/gpt.webp`
- `site/personas/grok.webp`

Nothing in the repository records which model produced them, so this document
names none — stated rather than filled in with a guess, on the same principle
the datasets above are described.

All of it is distributed under the terms in [LICENSE](LICENSE). Note that this
section covers first-party artwork only; the flag artwork and the AI model marks
that also live under `site/brand/` are third-party and are credited in their own
sections above.

## Trademarks

The AI model marks the site draws to identify whose predictions it is showing
are trademarks of their respective owners and are used nominatively. They are
also third-party artwork under upstream licences, so they are covered in full by
their own section above rather than repeated here.

The site does not use any national federation crest, nor any competition emblem,
mascot, official typeface, or wordmark as branding, in its artwork, or in its
naming. Team, competition, and venue names appear descriptively, to say what a
page is about.

## Corrections

If an attribution here is wrong, incomplete, or out of date, please open an issue.
Provenance errors are treated as defects, not as cosmetic problems.
