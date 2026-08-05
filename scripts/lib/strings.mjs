// strings.mjs — the canonical English string table for every human-facing label the bake emits.
// The canonical English string table consumed by the translation pipeline.
//
// WHY (an earlier fix antidote): until this file, UI copy lived as inline literals scattered through
// build.mjs and the lib renderers — unfindable as a set, untranslatable as a corpus, and prone
// to silent drift between surfaces that repeat the same phrase. This table single-sources them.
// The translation job (run-i18n.mjs) consumes THIS table's keys; the per-language chrome
// packs mirror its shape. English values here are the source of truth the build bakes.
//
// DISCIPLINE:
//   - Keys are stable dotted paths (chrome.nav.today, score.ft, stage.qf). Renaming a key is a
//     breaking change for every language pack — treat keys as API.
//   - Values are EXACT baked output, byte-for-byte, including case, punctuation and entities
//     (a later change ships under a byte-identical-modulo-clock-stamps gate; a changed space fails it).
//   - No logic in this file. Interpolations stay in the templates; this table holds only the
//     constant copy between them.
//   - Module has no imports (an earlier fix: nothing here can be referenced before init).
//
// NAMESPACES (a later change slice 2): chrome.* (shell labels) · editorial.* (site-wide shell copy:
// default meta description, footer legal/provenance, stale banner, shared renderer notes) ·
// footnotes.* (the provenance footnote paragraphs on profile/history/stadiums pages) ·
// pages.* (per-page hand-authored copy, keyed by page).

export const S = {
  chrome: {
    skip: 'Skip to content',
    ticker: {
      title: 'WORLD CUP 26',
      dates: 'JUN 11 — JUL 19',
      matches: '104 MATCHES',
      teams: '48 TEAMS',
      cities: '16 CITIES · US MX CA',
      guide: 'AD-FREE FAN GUIDE',
      dataAsOf: 'DATA AS OF', // + ' HH:MM UTC' interpolated at bake
    },
    nav: {
      today: 'Today',
      schedule: 'Schedule',
      brackets: 'Brackets',
      teams: 'Teams',
      watch: 'How to watch',
      history: 'History',
      stadiums: 'Stadiums',
      aiLeague: 'AI league',
      barTalk: 'Bar Talk',
      leaderboard: 'Leaderboard',
    },
    controls: {
      theme: 'Theme',
      contrastLabel: 'Card colour contrast',
      contrastAuto: 'Contrast: auto',
      contrastN: 'Contrast', // + ' N'
      langLabel: 'Language', // #lang-sel aria-label (attribute-carried — see attrs.* note)
    },
    footer: {
      venues: 'Venues',
      fifaAdmin: 'FIFA administration',
      usSoccer: 'U.S. Soccer',
      enEspanol: 'En español',
      calendar: 'Calendar feed',
      sources: 'All sources',
      about: 'About',
      privacy: 'Privacy',
      opsHub: 'Ops hub',
    },
  },
  editorial: {
    // page() shell — shared by every baked page
    defaultDesc: 'Independent fan guide to every 2026 World Cup match — times, venues, and how to watch free.',
    footerLegal: 'Golazo 26 is an independent, ad-free, non-commercial fan guide. Not affiliated with FIFA, any federation, or any broadcaster.',
    footerSources: 'Schedule: <a href="https://github.com/openfootball/worldcup.json" rel="noopener">openfootball</a> (public domain) ⨯ <a href="https://fixturedownload.com" rel="noopener">fixturedownload</a>, cross-checked · Rosters: Wikipedia (<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a>, pinned revision) · Flag artwork: <a href="https://github.com/jdecked/twemoji" rel="noopener">Twemoji</a> (<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>)',
    footerDataAsOf: 'data as of', // + ' <AS_OF>' interpolated at bake
    staleBanner: 'Live scores may be delayed — last update <span id="stale-asof" class="num"></span>. We show data honestly, never fake-live.',
    // shared renderers in build.mjs
    ledgerFacts: 'Facts as of the stamp on each line', // ledgerHTML g-foot; ' · showing…' tail interpolated
    galleryNote: 'photos · tap any to view full size with photographer credit &amp; licence.', // preceded by '<count> '
  },
  footnotes: {
    reportError: 'Report an error', // shared mailto link text (history editions, stadiums, profiles)
    historyEdition: `Adapted under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a> from the cited sources and reviewed by the site's solo maintainer. Result, host and awards above are extracted verbatim from the referenced write-up; a blank field means the sources don't state it.`,
    stadiumsA: `Facts and figures are drawn from the cited sources and reviewed by the site's solo maintainer. Capacities show the FIFA World Cup configuration with the regular configuration alongside; a blank or "not specified" field means the sources don't state it. Renovation details as of`, // + ' <asOf>' + stadiumsB
    stadiumsB: '; later changes are not reflected. Text adapted under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a>.',
    profile: { // proseFooter() — phrase keys between the pinned-source interpolations
      factsAsOf: 'Facts as of',
      adaptedUnder: `(pinned sources; later events are not reflected). Adapted under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a> from the sources below, and reviewed by the site's solo maintainer`,
      careerNarrative: 'Career narrative:',
      wikipediaPinned: 'Wikipedia, pinned revision',
      squadStats: 'Squad number, caps &amp; goals:',
      squadsPinned: 'squads page, pinned revision',
      auditedData: '+ audited tournament data. Facts hash',
    },
  },
  // attrs.*: attribute-carried strings — aria-label / title / placeholder / <option> text.
  // These CANNOT swap via the baked lang-span CSS mechanism (an attribute has no child elements);
  // they route through the chrome packs + the client attribute pass. Full consumer inventory
  // with file:line — internal notes
  // Keys below the (unwired) marker still have their English copy inline in a file outside a later change's
  // edit allowlist (scripts/lib renderers, site/*.js); the value here is canon and the consumer is
  // rewired in a later change — until then the inventory pins the pairing.
  attrs: {
    mainNav: 'Main',
    verifiedPhotosSuffix: 'verified photos', // gallery group aria-label tail, after '<name> — <n> '
    photoPrefix: 'Photo:', // attribution title head (build.mjs attrHTML; site/app.js lightbox aria)
    photoVia: 'via Wikimedia Commons (resized)', // attribution title tail
    barTalkTeaser: 'Bar Talk — the AI panel',
    aiRail: 'AI prediction league',
    bracket: 'Knockout bracket',
    jumpToStage: 'Jump to stage',
    searchTeamPlaceholder: 'Search team…',
    searchTeam: 'Search team',
    stageFilter: 'Stage',
    allStages: 'All stages',
    groupFilter: 'Group',
    allGroups: 'All groups',
    usChannel: 'US channel',
    anyUsChannel: 'Any US channel',
    teamHeaderSuffix: 'team header', // team hero SVG aria tail, after '<name> — Group <g> '
    thirdRace: 'Third-place race',
    standingsViews: 'Standings views',
    filterByStage: 'Filter by stage',
    editionsNav: 'World Cup editions, 1930 to 2022',
    adjacentEditions: 'Adjacent editions',
    hostCitiesNav: '2026 World Cup host cities',
    // (unwired) — copy lives in scripts/lib renderers / site JS pending the a later change attribute pass
    flagSuffix: 'flag', // render.mjs fchip aria tail, after '<name> '
    usEnglishTv: 'US English TV', // render.mjs chip() title head
    usSpanishTv: 'US Spanish TV',
    freeOverAir: 'free over the air', // render.mjs chip() title tail
    cableTv: 'cable',
    matchPagePrefix: 'Match page:', // render.mjs matchCard aria head
    confidence: 'confidence', // ai-league-render title
    inDepthPick: 'in-depth pick', // ai-league-render star title
    barTalkFromMatch: 'Bar Talk from match', // bartalk-view aria head, + ' <n>'
    loadEpisode: 'Load episode:', // bartalk-view aria head, + ' <label>'
    barTalkHighlights: 'Bar Talk highlights', // site/bartalk-teaser.js tablist aria
    highlightPrefix: 'Highlight', // site/bartalk-teaser.js dot aria, + ' <k>: <name>'
    onThisPage: 'On this page', // timeline-view anchors nav aria
    close: 'Close', // site/app.js lightbox + site/bracket-3d.js reader
    bracketView: 'Bracket view', // site/bracket-3d.js + bracket-map.js segmented control
    bracketOverview: 'Toggle full-bracket overview', // site/bracket-3d.js
    homeGoals: 'home goals', // site/predict.js score inputs
    awayGoals: 'away goals',
  },
  // stage / bracket labels (chrome-span keys): short round/section labels reused across the
  // home bracket stepper, the /standings static bracket, the Bar Talk stage filter and match kickers.
  // Each VALUE is globally unique (strings.mjs uniqueness contract) and shared by every emit site via
  // i18nSpan — identical text shares ONE key; numbers/letters stay interpolated in the templates.
  stage: {
    match: 'MATCH',              // match-page kicker "MATCH n · GROUP g · …" (static word)
    groupUpper: 'GROUP',         // match kicker + teams-index kicker "GROUP A" (static word)
    groups: 'Groups',            // home bracket stepper button
    groupStage: 'Group Stage',   // Bar Talk stage filter button
    groupStageLc: 'Group stage', // /standings/groups h1 + stage-band h2
    r32: 'R32',                  // home bracket stepper button
    r16: 'R16',
    qf: 'QF',
    sf: 'SF',
    qfSf: 'QF / SF',             // Bar Talk stage filter button
    final: 'Final',              // stepper + filter + static-bracket h3 (one value, one key)
    all: 'All',                  // Bar Talk stage filter button
    roundOf32: 'Round of 32',    // /standings static-bracket h3
    roundOf16: 'Round of 16',    // static-bracket h3 + Bar Talk filter button
    quarterFinals: 'Quarter-finals',
    semiFinals: 'Semi-finals',
    thirdPlace: 'Third place',   // static-bracket h3
  },
  pages: {
    home: {
      zoomOut: 'Zoom out',                 // bracket zoom-out button (h2 "Knockout bracket" reuses attrs.bracket)
      allFreeOta: 'ALL FREE OTA',          // day-section h2 tag (all matches free OTA)
      usaPlays: 'USA PLAYS',               // day-section h2 tag
      matchesUpper: 'MATCHES',             // day-section h2 count tail ("<n> MATCHES")
      heroKickerLive: '<b>WORLD CUP 26</b> · LIVE GUIDE · JUNE 11 – JULY 19', // constant branch; pre-opener branch stays interpolated in build.mjs
      railAiSub: 'Four frontier models predict every match — re-betting as results land.',
      railHistoryHead: 'Before the first whistle',
      railHistorySub: '96 years of World Cups — every champion, told with sources.',
      aiHomeSub: 'Four frontier AI models predict every match — score, scorers, key players — re-betting as results come in.',
      freeCalloutFox: 'matches are free over the air on FOX', // preceded by '<count> '
      freeCalloutTelemundo: 'free in Spanish on Telemundo.', // preceded by '<count> '
    },
    schedule: {
      h1: 'Schedule — all 104 matches',   // schedule + schedule-spa hero h1
      spaKicker: 'v3 dynamic prototype — rendered client-side from /api/v1/live + a static context, no rebuild', // schedule-spa prototype kicker
      loading: 'Loading…',                // schedule-spa app placeholder
      footnote: '= free over the air with an antenna. Times adapt to your timezone. Knockout slots show official placeholders until decided — never predictions. <a href="/ics/all.ics">Add all matches to your calendar (.ics)</a>', // preceded by the FREE chip
    },
    teams: {
      aboutThisTeam: 'About this team', // team-page prose section h2
      fixtures: 'Fixtures',             // team-page fixtures section h2
      squad: 'Squad',                   // team-page squad h2 "Squad — <n> players" (static word)
      players: 'players',               // team-page squad h2 tail (static word)
      indexSub: `48 teams, 12 groups. Every banner is the country's own flag — pinned Twemoji artwork at a broadcast crop.`,
      knockoutNote: 'Knockout fixtures appear here when qualification is decided.', // + ' <add-to-calendar link>'
      photosNote: 'Photos: Wikimedia Commons — hover ⓘ for author &amp; license; players without a free-licensed photo get initials, never a near-match.',
    },
    people: {
      usSoccerAdmin: 'U.S. Soccer administration & USMNT staff', // /people/us-soccer h1 (FIFA admin h1 reuses chrome.footer.fifaAdmin)
      verifiedA: 'Every role verified', // + ' <date> ' + verifiedB
      verifiedB: 'against official sources; photos from Wikimedia Commons with per-file attribution (hover ⓘ).',
      unresolvedSuffix: 'no public holder verifiable as of June 2026', // per unresolved role, after '<role> — '
      editorialNote: 'Editorial, non-commercial content. No FIFA or federation marks are used.',
    },
    leaderboard: {
      intro: 'Every signed-in fan can <a href="/schedule">predict the score of any match</a> until kickoff, then it locks. <strong>3 points</strong> for the exact score, <strong>1 point</strong> for the right outcome — scored only on <em>confirmed</em> finals and recomputed deterministically on every update, never hand-edited.',
      empty: 'No predictions yet — be the first: open any upcoming <a href="/schedule">match page</a> and sign in.',
      machines: 'Four frontier AI models run their own bragging-rights league on every match — see the <a href="/ai-league">AI prediction league</a>.',
      footnoteA: 'Predictors appear as first name + last initial from their sign-in name; locked and deleted accounts are excluded. Predictions lock at kickoff and are never edited after. As of', // + ' <code>ts</code> · privacy link'
      desc: 'Fan prediction standings for every 2026 World Cup match — 3 points exact, 1 point outcome, locked at kickoff.',
    },
    aiLeague: {
      h1: 'The AI prediction league',        // page h1 (attrs.aiRail is the shorter rail label)
      standings: 'Standings',                // standings section h2
      nextMatch: 'The next match, in depth', // featured-pick section h2
      everyPick: 'Every pick',               // every-pick section h2 (static words; "(★ = in-depth)" separate)
      inDepthNote: '(★ = in-depth)',         // every-pick section h2 muted note
      loadingLeague: 'Loading the live league…', // standings hydration placeholder
      scoringNote: '<strong>3 pts</strong> exact score · <strong>1 pt</strong> right outcome · <strong>+1</strong> per correctly predicted goalscorer (only on matches with sourced scorers). Scored on confirmed finals, recomputed deterministically — never hand-edited. Each AI re-predicts the matches it judges a new result has changed.',
      barTalkSub: 'The same four models, off the clock: after every match they pull up a barstool and argue about it — in character. AI-generated comedy, not real statements. <a href="/bar-talk">See all episodes →</a>',
      footnoteA: 'All picks are AI-generated (each records its exact model id) and timestamped in our database before kickoff. Live as of', // + ' <code>ts</code> · raw data links'
      desc: 'Claude Opus 4.8, ChatGPT, Gemini 3 Pro, and Grok 4 predict every 2026 World Cup match — score, scorers, key players — re-betting as results come in.',
    },
    barTalk: {
      eyebrow: 'AI COMEDY · NOT COMMENTARY', // hub eyebrow label
      episodes: 'EPISODES',                  // guide-rail eyebrow
      loadingEpisodes: 'Loading episodes…',  // guide-list hydration placeholder
      teaserTag: 'Four AIs argue every match — <b>hear the panel →</b>',
      heroSub: 'Four models, one bar, every match — Grok, Claude, Gemini and ChatGPT argue in character after the final whistle.',
      readingEmpty: 'Select an episode from the guide.',
      hubFootnote: `Each episode is AI-generated (the four models in character) and stored before it's shown. The picks they reference are the <a href="/ai-league">AI prediction league</a> — bragging-rights fun, never editorial fact.`,
      desc: 'Bar Talk — Grok, Claude, Gemini and ChatGPT argue every 2026 World Cup match, in character. AI-generated comedy.',
    },
    standings: {
      h1Bracket: 'Bracket',     // /standings hero h1
      firstMatch: 'FIRST MATCH', // group draw-card kicker (static words)
      bracketSub: 'The knockout path — round of 32 to the final. Live scores from ESPN. <a href="/">Open the interactive bracket →</a>',
      bracketFootnote: 'Top two per group + the 8 best third-placed teams reach the Round of 32. Winners advance to the right; the third-place play-off is contested by the semi-final losers.',
      groupsSub: `Every group's official ESPN table and fixtures — never local math. <a href="/standings">← Bracket</a> · <a href="/">interactive bracket</a>`,
      groupsFootnote: 'Top two per group + the 8 best third-placed teams reach the Round of 32. <a href="/standings">See the bracket →</a>',
      emptyBracket: 'The knockout bracket fills in once the group stage ends.',
      thirdRaceSub: 'The 8 best of 12 third-placed teams advance — ranked by points, then goal difference, then goals scored. From ESPN, never local math.',
      movedNote: 'This page moved to <a href="/standings">Standings</a>.',
    },
    venues: {
      h1: 'Venues — 16 stadiums, 3 countries', // venues page h1 (static words; numbers interpolation-free literal)
      sourcesNote: 'Names per fixturedownload (FIFA) and Wikipedia pinned rev 1358650246 (common).',
    },
    watch: {
      h1: 'How to watch every match (US)', // /watch page h1
      tubiRow: 'Opening ceremony + the opener + USA–Paraguay (Jun 12) live in 4K, no account — <a href="https://corporate.tubitv.com/press/tubi-launches-2026-fifa-world-cup-fox-hub/" rel="noopener">announcement</a>',
      canadaRow: `TSN (EN) / RDS (FR) carry all 104 (pay). <strong>CTV airs 44 free over the air</strong>: 27 group games incl. all three Canada matches, 6 of the Round of 32, 4 of the Round of 16, then everything from the quarter-finals on except the third-place match. Crave streams the CTV feed; TSN's YouTube streams the first 10 minutes of every match free.`,
      footnote: `Every row above is sourced — see <a href="/sources">/sources</a>. Totals reflect June 2026 listings; Fox's January announcement said 70/34 and two matches have since moved to FOX (<a href="/sources#discrepancies">documented</a>). <a href="/como-ver">Versión en español →</a>`,
    },
    opsHub: {
      desc: 'How Golazo 26 is run, taught, and kept healthy — onboarding, incident playbooks, and match-day cards for its operators.',
    },
    about: {
      h1: 'About Golazo 26', // /about hero h1
      intro: 'An independent, ad-free, non-commercial fan guide to the 2026 World Cup, built so anyone can answer one question in one click: <em>when is the match, and how do I watch it — free if possible?</em>',
      independence: '<strong>Independence</strong>: not affiliated with FIFA, any federation, broadcaster, or sponsor. No FIFA marks, emblems, mascots, or federation crests are used. Editorial mentions of the tournament are exactly that — editorial.',
      licenses: '<strong>Licenses</strong>: roster text derives from Wikipedia under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a> (pinned revisions, linked on each page). Photos are from Wikimedia Commons under their per-file licenses, attributed where shown (hover ⓘ). Flags are self-hosted <a href="https://github.com/jdecked/twemoji" rel="noopener">Twemoji</a> artwork (CC BY 4.0, pinned v15.1.0). Site code: MIT.',
      honesty: `<strong>Honesty</strong>: every fact carries a source (<a href="/sources">/sources</a>); unverifiable data shows TBD; live scores come straight from ESPN's official match feed.`,
      brandGraphics: `<strong>Brand graphics</strong>: the Golazo 26 mark, doodles, hero art, and share-image compositions are original works of this project (MIT/CC0) — no FIFA or federation marks anywhere. Team banners and flag chips render the country's actual flag from pinned <a href="https://github.com/jdecked/twemoji" rel="noopener">Twemoji</a> artwork (CC BY 4.0, self-hosted), with kit palettes human-audited. Display typeface: Barlow Condensed (<a href="https://openfontlicense.org" rel="noopener">OFL</a>).`,
      editorialIntegrity: `<strong>Editorial integrity</strong>: the written pieces on this site are AI-drafted from this site's own sourced data and then machine-checked, so every name and number in them traces back to that data — anything that doesn't is flagged and the piece is held, never shown. Team outlooks and match previews are read and approved by the editor before publishing. Match recaps are generated automatically at the final whistle: each is grounded in the confirmed result and the sourced goalscorers, and it publishes only once it clears that machine check — no human in the loop. A recap is held until its scorers are sourced, and a recap that fails the check is held back rather than shown. Separately, the <a href="/ai-league">AI prediction league</a> is a clearly-labeled contest in which four AI models guess every match before kickoff — that league is the only place AI picks are presented as such, and they are bragging-rights fun, never editorial fact.`,
      privacyAccounts: '<strong>Privacy</strong>: this site sets no cookies and runs no trackers or ads. Match predictions use sign-in accounts; your name and email are stored in our own database via the auth provider (Clerk) so your account stays portable. The public leaderboard shows only your first name and last initial. To delete your account, open your profile from the sign-in menu and choose delete — your name, email and predictions are removed from our database within minutes of the request and reconciled daily, and you drop off the leaderboard within a day. Full details: <a href="/privacy">privacy policy</a>.',
      privacyNoAccounts: '<strong>Privacy</strong>: this site sets no cookies, runs no trackers or ads, and <strong>collects no personal data</strong> — there are no accounts and nothing about you is stored. (If match predictions are enabled later, sign-in accounts are introduced; this notice and the <a href="/privacy">privacy policy</a> are updated accordingly.)',
      contact: 'Built by a fan. Contact: via the <a href="https://github.com/onwike/golazo26" rel="noopener">public repository</a>.',
    },
    privacy: {
      h1: 'Privacy policy',                    // /privacy hero h1
      whoRunsHeading: 'Who runs this site',    // section h2
      whatWeCollect: 'What we collect',        // section h2
      processors: 'Processors we use',         // section h2
      legalBasis: 'Legal basis &amp; retention', // section h2 (entity byte-exact)
      yourRights: 'Your rights (GDPR / CCPA)', // section h2
      photosHeading: 'Photos &amp; attribution', // section h2 (entity byte-exact)
      lastUpdated: 'Last updated', // + ' <AS_OF>' interpolated at bake
      project: 'Golazo 26 is an independent, ad-free, non-commercial fan project.',
      whoRuns: 'Golazo 26 is operated by an individual (the "controller"). Privacy or data requests: <a href="https://github.com/onwike/golazo26/issues" rel="noopener">open a GitHub issue</a> or email the contact listed on the repository.',
      collectAccounts: `<p>The public pages set <strong>no cookies and run no trackers, analytics, or ads</strong>. The only personal data we process is for the optional <strong>match-predictions</strong> feature, which requires sign-in:</p>
<ul>
<li><strong>Account</strong>: your name and email address, to identify your account and show it back to you.</li>
<li><strong>Predictions</strong>: the scores you submit, linked to your account id.</li>
<li>The public leaderboard displays only your <strong>first name + last initial</strong> — never your email.</li>
</ul>`,
      collectNoAccounts: '<p>This site sets <strong>no cookies</strong> and runs <strong>no trackers, analytics, or ads</strong>, and <strong>collects no personal data</strong>. There are no user accounts and nothing about you is stored. (If the optional match-predictions feature is enabled in future it introduces sign-in accounts; this policy is updated before that happens.)</p>',
      cloudflareA: '<strong>Cloudflare</strong> — hosting and edge delivery (static site, Workers, and the D1 database where', // + branch + cloudflareB
      cloudflareDataAccounts: 'account and prediction data live',
      cloudflareDataNoAccounts: 'tournament data lives',
      cloudflareB: `). Subject to Cloudflare's privacy terms.`,
      clerk: `<strong>Clerk</strong> — authentication; Clerk stores your name and email and sends sign-in emails. We keep our own portable copy (name + email) so the auth vendor is replaceable. Subject to Clerk's privacy terms.`,
      basisAccounts: '<p>We process account and prediction data on the basis of your <strong>consent</strong>, given when you sign in. We retain it until you delete your account, after which your name, email, and predictions are removed from our database within minutes of the request and reconciled daily.</p>',
      basisNoAccounts: '<p>No personal data is processed, so no retention applies to visitors. Tournament content derives from cited public sources (see <a href="/sources">/sources</a>).</p>',
      rightsA: 'You may request access to, correction of, or deletion of your personal data.', // + optional delete note + ' ' + rightsB
      rightsDelete: ' To delete everything immediately: open your profile from the sign-in menu and choose <strong>delete</strong> — this erases your account and predictions.',
      rightsB: 'For any access/deletion request, <a href="https://github.com/onwike/golazo26/issues" rel="noopener">contact us via the repository</a>.',
      photos: 'Player and staff photos are reused from Wikimedia Commons and other free-licensed sources under their per-file licenses, with attribution shown on each image. We honor takedown and personality-rights requests — use the contact above.',
      desc: 'Golazo 26 privacy policy — what we collect, processors, retention, and how to request deletion.',
    },
    sources: {
      h1: 'Sources &amp; data integrity',            // /sources hero h1 (entity byte-exact)
      streamingPrices: 'Streaming prices &amp; trials (US)', // streaming section h2 (entity byte-exact)
      sourcesOfRecord: 'Sources of record',          // sources-of-record section h2
      documentedDiscrepancies: 'Documented discrepancies', // discrepancies section h2
      heading: 'Sources',                            // shared "Sources" h2 (history edition + stadium pages)
      intro: 'Everything on this site traces to a source. Datasets and their audits live in the project repository.',
      foxOne: `<strong>FOX One</strong> — $19.99/mo, 7-day free trial, all 104 matches in 4K: <a href="https://variety.com/2026/shopping/news/how-to-watch-fox-sports-online-free-1236762221/" rel="noopener">Variety</a> + <a href="https://www.tomsguide.com/entertainment/sports/how-to-watch-the-world-cup-2026-in-4k" rel="noopener">Tom's Guide</a> (verified 2026-06-09)`,
      peacock: '<strong>Peacock Premium</strong> — $10.99/mo, all 104 in Spanish: <a href="https://www.nbcsports.com/soccer/news/how-to-watch-the-2026-world-cup-live-stream-link-tv-channel-dates-full-details" rel="noopener">NBC Sports</a> (verified 2026-06-09)',
      tubi: '<strong>Tubi</strong> — free 4K stream for the opener and USA–Paraguay: <a href="https://corporate.tubitv.com/press/tubi-launches-2026-fifa-world-cup-fox-hub/" rel="noopener">Tubi press release</a> (verified 2026-06-09)',
      trialNote: `Live-TV service trial lengths change frequently — we link, we don't pin numbers.`,
      scheduleRow: '<a href="https://github.com/openfootball/worldcup.json" rel="noopener">openfootball</a> (public domain) cross-checked per match against <a href="https://fixturedownload.com/feed/json/fifa-world-cup-2026" rel="noopener">fixturedownload</a>',
      rostersA: 'Wikipedia "2026 FIFA World Cup squads",', // + <a href=permalink>rostersPinned + revid</a> + rostersB
      rostersPinned: 'pinned revision',
      rostersB: '(CC BY-SA 4.0), audited against the official FIFA squad-lists PDF',
      usTvRow: 'Per-match from <a href="https://www.sportsmediawatch.com/tv-schedules/fifa-world-cup-tv-schedule/" rel="noopener">Sports Media Watch</a> ⨯ <a href="https://www.foxsports.com/soccer/fifa-world-cup/schedule" rel="noopener">FOX Sports</a>; Spanish split per <a href="https://www.nbcsports.com/soccer/news/how-to-watch-the-2026-world-cup-live-stream-link-tv-channel-dates-full-details" rel="noopener">NBC</a> (92/12 — matches exactly)',
      photosRow: 'Wikimedia Commons only, matched by Wikidata QID, license-allowlisted (PD/CC0/CC BY/CC BY-SA), attributed per image',
      discrepanciesNote: 'When sources disagree we say so — we never silently pick.',
      tbdNote: `Unverifiable facts render as TBD — never a guess. Live scores come straight from ESPN's official match feed.`,
    },
    match: {
      matchStats: 'Match stats',        // stats section h2 (before "via ESPN")
      blowByBlow: 'Blow-by-blow',       // commentary section h2
      storyHeading: 'The Story',        // story timeline section h2
      via: 'via',                       // "via ESPN" provenance tag (static word)
      watchAlongHeading: 'AI Watch-Along', // watch-along section h2
      aiComedy: 'comedy',               // "AI comedy" provenance tag (static word)
      barTalkPre: 'Bar Talk: pre-game', // pre-game bar-talk section h2 (static words)
      allEpisodes: 'all episodes →',    // bar-talk section h2 "all episodes" link
      howToWatchUs: 'How to watch (US)', // match-page how-to-watch section h2
      freeFox: '<strong>FOX</strong> — free over the air with any TV antenna',
      freeTelemundo: '<strong>Telemundo</strong> — free over the air, en español',
      freeTubi: '<strong>Tubi</strong> — free stream, live in 4K, no account (<a href="https://corporate.tubitv.com/press/tubi-launches-2026-fifa-world-cup-fox-hub/" rel="noopener">announcement</a>)',
      noFree: 'No free US broadcast for this match — all viewing options',
      statsEmpty: 'Stats not yet available for this match.',
      storyFootnote: `Goals, substitutions, and cards from ESPN's official match feed — home team on the left, away on the right.`,
      lineupsFootnote: `Starting XI and substitutes from ESPN's official match feed.`,
      watchAlongNote: 'AI-generated comedy reacting to the live feed — the four models in character (Grok, Claude, Gemini, ChatGPT). Played for laughs, not real statements or editorial fact.',
      aiPicksNote: 'AI-generated picks — each AI re-bets as results come in, and only a pick locked in before kickoff can score. A virtual bragging-rights league, no real money. An AI that missed a match scores zero; bets are never backfilled. <a href="/ai-league">League standings →</a>',
      barTalkPreNote: 'AI-generated comedy — the four models in character (Grok, Claude, Gemini, ChatGPT) trash-talking their own pre-match predictions. Played for laughs, not real statements or editorial fact.',
      barTalkNote: 'AI-generated comedy — the four models in character (Grok, Claude, Gemini, ChatGPT), reacting to this match. Played for laughs, not real statements or editorial fact.',
    },
    notFound: {
      title: 'Lost the ball',
      body: `That page doesn't exist. Try the <a href="/schedule">schedule</a> or <a href="/">today's matches</a>.`,
    },
    history: {
      kickerTail: 'TOURNAMENTS · ONE TROPHY', // hub kicker static tail (years/count interpolated)
      h1: 'History of the<br>World Cup',       // hub h1 — CARRIES HTML (<br>); emitted raw via i18nSpan
      allEditions: '← All editions',           // edition-page back kicker link
      heroSub: `Ninety-six years of football's greatest tournament — every edition, every champion, the road to 2026.`,
      hubFootnote: `Every edition page draws on cited sources; the result, host and individual awards on each card are taken verbatim from that edition's referenced write-up. A blank field means the cited sources don't state it — never a guess.`,
      hubDesc: 'Every FIFA World Cup from 1930 to 2022 — champions, hosts and the stories of each tournament, on the road to 2026.',
    },
    stadiums: {
      cities: 'CITIES',        // hub kicker static word ("16 CITIES")
      stadiumsWord: 'STADIUMS', // hub kicker static word ("16 STADIUMS")
      nations: 'NATIONS',      // hub kicker static word ("3 NATIONS")
      h1: 'Stadiums of the<br>2026 World Cup', // hub h1 — CARRIES HTML (<br>); emitted raw via i18nSpan
      allStadiums: '← All stadiums', // detail-page back kicker link
      formerly: 'formerly',    // detail-page sub "formerly <name>" (static word)
      photos: 'Photos',        // detail-page photos section h2
      theStadium: 'The stadium', // detail-page stadium section h2
      iconicGames: 'Iconic games', // detail-page iconic-games section h2
      renovations: 'World Cup 2026 renovations', // detail-page renovations section h2 (static word)
      heroSub: 'Sixteen host cities across the United States, Mexico and Canada — their history, their stadiums, and the games that made them.',
      hubFootnote: `Every fact is drawn from cited sources; capacities show the FIFA World Cup configuration with the regular configuration alongside. A blank or "not specified" field means the cited sources don't state it — never a guess. <a href="/venues">Match-by-venue index →</a>`,
      hubDesc: 'All 16 host cities and stadiums of the 2026 World Cup — history, iconic games, and World-Cup renovations, with sources.',
      iconicEmpty: 'No major prior football matches at this venue are recorded in the cited sources.',
      renoEmpty: 'No World-Cup renovation details are specified in the cited sources.',
      gapsSummary: `What the cited sources don't specify`, // + ' (<count>)'
    },
  },
};

// Flat lookup used by tests and the a later change extraction job: every leaf as 'dotted.path' → value.
export function flatten(obj = S, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[path] = v;
    else Object.assign(out, flatten(v, path));
  }
  return out;
}
