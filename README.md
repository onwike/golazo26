# Golazo 26

A fan-built guide to every match of the 2026 FIFA World Cup — the full schedule, kickoff times, all 16 venues across the US, Mexico, and Canada, and clear, no-nonsense answers to the question I kept asking myself: *how do I actually watch this game, for free, here in the US?*

I'm a football fan, not a media company. There are no ads, no tracking, no paywalls, and no login wall in front of the schedule. Just every game, when it's on, where it's played, and how to tune in.

> Tournament: June 11 – July 19, 2026 · 104 matches · 16 host venues — 11 in the US, 3 in Mexico, 2 in Canada.

## What's in here

- **Every match** — date, local and US kickoff times, group, venue, and stage.
- **All 16 venues** — where each game is played, with the matches assigned to each one.
- **How to watch (free) in the US** — which games are on free over-the-air TV, plus the streaming and cable options when they're not.
- **All 48 teams** — squads, rosters, and staff, every record traced back to its source.

## How it's built — bake, don't serve

Golazo 26 is a static site. There is no app server, no database in the request path, and nothing to fall over on a busy matchday.

A single zero-dependency Node generator reads the JSON datasets in `data/` and **bakes the entire site to plain HTML** in `dist/` — hundreds of pages: the homepage, the schedule, one page per match, one per team, venues, groups, and the rest. That `dist/` folder is then served as static assets (I deploy it to Cloudflare Workers, but it's just files — any static host works).

Why I built it this way:

- **Fast.** Pages are pre-rendered HTML. Nothing is computed when you load them.
- **Cheap.** Serving static files costs effectively nothing, and a traffic spike can't run up a bill.
- **Resilient.** No live backend means nothing to crash. If my build machine is off, the site is still up.

Everything a page shows is decided at build time from the data files, and every fact carries a `source_url` — anything I can't source renders as "TBD" rather than a guess.

## Build it yourself

You need Node (a recent LTS is fine). No `npm install` — there are zero dependencies.

```sh
node scripts/build.mjs
```

That's it. The generator reads `data/`, assembles everything alongside the static assets in `site/`, and writes the finished site to `dist/`. Open `dist/index.html` in a browser, or point any static file server at `dist/` to preview it.

```
data/   →  node scripts/build.mjs  →  dist/   (static HTML, ready to deploy)
```

To publish, upload `dist/` to any static host. The included `wrangler.public.toml` deploys it to Cloudflare Workers as assets-only — no fetch handler, no secrets, no server code.

## Repository layout

| Path | What's there |
|---|---|
| `data/` | The JSON datasets the site is built from — matches, teams, rosters, people, venues, broadcasts, image metadata. Every record cites its source. |
| `scripts/` | The build generator (`build.mjs`) and the helper scripts that ingest and prepare data and images. |
| `site/` | Static assets copied into the build as-is — CSS, client JS, fonts, icons, brand marks. |
| `dist/` | Build output (git-ignored). Created when you run the build. |

## Bring your own images

This repo ships **the code and the data, not the photos.**

Player and team photography comes from Wikimedia Commons, and the rules around it are strict — every image has to be matched to the right person by Wikidata QID (never a name guess), pass a license allowlist, and carry its author and license credit on the page where it appears. I keep that policy and the attribution requirements in [ATTRIBUTION.md](ATTRIBUTION.md). I don't redistribute a bundle of image files here; instead the pipeline expects you to supply your own license-cleared images.

The scripts in `scripts/` are how you populate that yourself:

- `build-images.mjs` — resolves each player/coach to a Wikidata QID, finds the Commons portrait, and records its license and attribution into `data/images.json`.
- `find-photo-candidates.mjs` — gathers candidate photos for subjects that don't have one yet. Nothing is ingested automatically; I review candidates by hand and record accept/reject in `data/photo-overrides.json`.
- `harvest-gallery.mjs` — collects additional identity-verified gallery photos (only files structurally tied to the subject's own Commons category or a `depicts` statement — no fuzzy name matches).
- `fetch-thumbs.mjs` — mirrors the cleared thumbnails locally into `site/img/` so the site never hotlinks Wikimedia.
- `fetch-flags.mjs` — pins the 48 Twemoji flag SVGs locally.

Run those to build up your own image set under `site/img/`; the site generator picks them up from there on the next build. The site still builds without any photos — subjects without a cleared image just get a neutral initials avatar.

## AI prediction league

One feature worth calling out: the site runs a prediction league where frontier AI models (Claude, ChatGPT, Gemini, Grok) each pick scores for the matches and get ranked against the real results — 3 points for an exact score, 1 for the right outcome. The models are *contestants* here, competing at predictions. It's just a fun side-game on top of the schedule.

## License & attribution

- **Code:** MIT — see [LICENSE](LICENSE).
- **Data, flags, photos, and text:** sourced from third parties under their own terms, with per-item attribution. The full policy — sources of record, the license allowlist, flag and emoji credits, and what is deliberately never used — is in [ATTRIBUTION.md](ATTRIBUTION.md). If you fork this, those obligations come with the data.

---

Built by hand by a fan. Ad-free, non-commercial, editorial. Not affiliated with FIFA.
