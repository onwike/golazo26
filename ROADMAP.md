# Roadmap

This is a fan project, so the roadmap is honest about it: I build the parts I'd
actually use, in roughly the order I want them. Below is what's already in the
repo and what I'd like to add next. No promises, no dates — just direction.

## What's built

The site is live and covers the whole tournament:

- **Today view** — the homepage leads with what's on now and what's next, so you
  don't have to scroll a 104-match list to find today's games.
- **Full schedule** — every match with its date, group/stage, venue, and kickoff
  shown in your own timezone. Knockout slots show the official placeholders
  ("Winner Group A", etc.) until the bracket is decided — never a prediction.
- **A page per match** — teams, venue, kickoff, and how to watch it free in the
  US, each with its source.
- **A page per team** — all 48, with the team's fixtures and a one-click calendar
  feed for just that team's matches.
- **All 16 venues** — each stadium with the matches assigned to it.
- **Group tables** — the eight groups, ready to fill in as results land.
- **How to watch (free), US** — `/watch` lays out which games are free over the
  air on FOX, which are free in Spanish on Telemundo, and the streaming/cable
  options for the rest.
- **En español** — a Spanish how-to-watch page (`/como-ver`), because a lot of
  this tournament is free over the air in Spanish and that deserves its own page.
- **Calendar / ICS** — subscribe to the whole tournament, or just one team, as a
  standard `.ics` feed that drops every match straight into your calendar.
- **Downloadable schedule data** — the baked site ships the full schedule as JSON
  so anyone can grab it and build their own thing.
- **History** — a look back at past World Cups.
- **A prediction league** — fans pick scores and get ranked (3 points for an
  exact score, 1 for the right outcome, locked at kickoff). There's also a
  side-game where a few AI models play the same league as contestants — more on
  that below.

## What's next

Rough order of what I want to get to:

- **AI prediction league, expanded.** The fun one. A handful of frontier AI
  models each predict the full-time score of every match before kickoff and get
  ranked against the real results, same scoring as the human league. The models
  are *contestants*, not commentators — virtual bragging rights only, no money,
  no odds, no betting links. I want to round this out: a cleaner standings page,
  a short note on how each model did, and the knockout rounds filling in
  automatically as teams qualify.
- **More languages.** The Spanish how-to-watch page proved the pattern. I'd like
  to extend at least the watch guide, and ideally the schedule, to more of the
  languages this tournament is actually followed in.
- **Richer match pages.** Lineups when they're confirmed, a short recap once a
  match finishes, head-to-head context — all held to the same rule as everything
  else: it ships only when I can source it.
- **Deeper team pages.** Squad and staff detail with photos, where the photo can
  be identity-verified and is properly licensed (see
  [ATTRIBUTION.md](ATTRIBUTION.md) for why I'm strict about this).
- **Better "today" during live windows.** Faster score updates and a tighter
  live view on matchdays.

## How I decide what ships

One rule runs through all of it: **every fact carries a source, and anything I
can't source renders as "TBD" rather than a guess.** If a feature can't meet that
bar, it waits. A wrong kickoff time or a misidentified player is worse than a
blank, so when in doubt the site says less.

If you've got an idea or you spot something wrong, open an issue — I read them.
