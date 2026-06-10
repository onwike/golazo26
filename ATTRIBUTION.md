# Attribution & licensing policy

This project is ad-free, non-commercial, and editorial. The rules below are mandatory for every asset and dataset in this repository and on the published site.

## Code

MIT — see [LICENSE](LICENSE).

## Photography (people & teams)

- **Source: Wikimedia Commons only.** Every image is matched to its subject via **Wikidata QID** (never name-string matching) and passes a license allowlist at ingest.
- **License allowlist**: Public Domain, CC0, CC BY (any version), CC BY-SA (any version). **Rejected**: any NC (non-commercial) or ND (no-derivatives) license, and any file whose license cannot be verified on its Commons file page.
- **Per-file attribution is rendered on-page wherever the image appears**: author/artist, license short name linked to the license text, link to the Commons file page, and a "changes made" note if cropped/resized.
- Derivatives of CC BY-SA images (crops, WebP thumbnails) are shared under the same license.
- **Profile galleries (up to 5 photos per subject)**: beyond the primary infobox (Wikidata P18) portrait, a profile page may show additional Commons photos. Each gallery image is tied to the subject by **structural identity evidence only** — membership of the person's own Commons category (Wikidata P373 / Category sitelink) and/or a Commons structured-data `depicts (P180) = QID` statement — never a name/text search. The same allowlist and per-file on-page attribution apply; every accepted image records its identity evidence in [data/gallery.json](data/gallery.json).
- Subjects without an allowlisted photo get a neutral initials avatar — never a near-match photo.
- Personality rights: images of people are used editorially only; the site carries no advertising.

## Text

- Roster and squad data derive from Wikipedia ("2026 FIFA World Cup squads") at a **pinned revision**, under CC BY-SA 4.0 — attribution with the revision permalink is rendered on every roster page.
- Match schedule seed: openfootball/worldcup.json (public domain), cross-checked against independent sources. Per-record `source_url` fields are mandatory in all datasets.
- Name romanization follows Wikipedia (e.g. Japanese names with macrons: Shōgo, Dōan); FIFA's plain romanization differs — these are spelling variants of the same sourced names, and each page uses one source consistently.

## Attribution caveats (audit-confirmed)

- The recorded image `author` is the Commons `|author=` template field **verbatim**; for some files that is the uploader or a hosting account (e.g. a Flickr account) rather than the photographer credited in description prose. We attribute the author field as Commons records it, plus the file-page link, which carries any fuller credit.
- A small number of Commons files have internally inconsistent description metadata (wrong description text on a correct image); image identity is verified by Wikidata-QID matching plus audit spot-checks, not by description prose.

## Flags & symbols

- Country flags: Unicode emoji (rendered by the visitor's device) or Twemoji SVGs (CC-BY 4.0, attributed on `/about`).
- AI prediction league logos: the marks shown beside Claude, ChatGPT, Gemini, and Grok in the AI-league and match tables are simplified, monochrome renditions used purely to identify each model (nominative use). They are trademarks of their respective owners — Anthropic (Claude), OpenAI (ChatGPT), Google (Gemini), and xAI (Grok) — and are not endorsements by, or affiliations with, those companies.
- **Never used**: the FIFA official emblem, trophy imagery, mascots, host-city logos, the FWC 26 typeface, or FIFA wordmarks as branding or in domain names ([FIFA IP Guidelines](https://digitalhub.fifa.com/m/3567360896991b48/original/FIFA-World-Cup-26-IP-Guidelines.pdf)); national-federation crests ([U.S. Soccer brand protection](https://www.ussoccer.com/brand-protection)) — uniformly, all 48 federations.

## Data sources of record

| Source | Use | License / terms |
|---|---|---|
| [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) | schedule seed | public domain |
| [football-data.org](https://www.football-data.org/) (free tier, registered token) | schedule/score cross-check + tournament-time updates | free-tier ToS; attribution given |
| Wikipedia via MediaWiki API (pinned revisions) | rosters, staff, people | CC BY-SA 4.0 |
| Wikimedia Commons API | photography + per-file licenses | per-file |
| FIFA official squad-lists PDF | roster cross-check only | reference |
| [fixturedownload.com](https://fixturedownload.com/) | schedule cross-check | per-site terms; attribution |
| TheSportsDB (free key) | tertiary cross-check (15 events/call free limit) | attribution expected |
| Hand-curated broadcast rows | per-match viewing info | every row carries `source_url` + `verified_by` + `verified_at` |

**Not used**: api.fifa.com (ToS prohibits reuse/automation); API-Football free tier (2026 season access unverified).
