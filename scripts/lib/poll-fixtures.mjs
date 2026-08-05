// poll-fixtures.mjs — PURE helpers for the poll's fixture/bracket sync (node-importable; no JSON
// import, unlike worker/poll.mjs, so it is unit-testable). Two concerns:
//
//   1) WHICH extra dates to fetch — the live window is yesterday+today, but knockout matchups
//      resolve (group winner → R32 slot, etc.) days before kickoff. So we also fetch the dates of
//      upcoming SCHEDULED games whose teams aren't resolved yet, bounded to a short horizon + cap
//      so the per-poll ESPN call count stays small (the next round resolves within days).
//
//   2) WHICH team name to write — ESPN labels an unresolved knockout slot with a PLACEHOLDER team
//      ("Quarterfinal 1 Winner", abbr QFW1; "Group A Winner"; etc.), which must NEVER be written.
//      So we only fill a name we recognize as a real WC participant (the set of teams already
//      assigned to played group games), fill blanks only, and yield to a manual override.
import { canonTeam, ESPN_PLACEHOLDER_RE } from './team-aliases.mjs';

// utcDate(Date) → 'YYYYMMDD' (ESPN scoreboard ?dates= form), UTC.
export function utcDate(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// The real-team allowlist: every distinct non-empty home_team/away_team currently stored (the
// group-stage fixtures carry the 48 participants). ESPN bracket placeholders are never in here.
export function knownTeamSet(matchRows) {
  const s = new Set();
  for (const r of matchRows) {
    if (r.home_team) s.add(r.home_team);
    if (r.away_team) s.add(r.away_team);
  }
  return s;
}

// Dates (YYYYMMDD, UTC) of scheduled games still missing a team, kicking off within `horizonDays`,
// deduped + sorted + capped. `nowMs` = Date.now(). These get UNIONed with the live yesterday/today
// window so ESPN's resolution is mirrored as soon as it lands.
//
// ESPN's scoreboard?dates= buckets events by US-EASTERN day, not UTC day: an early-UTC kickoff
// (00:00–~04:00Z = previous evening ET) files under the PREVIOUS day's board. n92 RCA 2026-07-02:
// kickoff 2026-07-06T00:00Z → resolved event 760505 sat on board 20260705; this function fetched
// only 20260706, so the identity stranded for days. So each kickoff now contributes BOTH its UTC
// date AND its -6h "shadow" date — 6h covers EDT (UTC-4) and EST (UTC-5) with margin for ESPN's
// unprobed exact boundary hour; for kickoffs ≥06:00Z the two collapse to the same date.
//
// `cap` bounds the extra ESPN scoreboard fetches per poll (worker/poll.mjs unions these with the
// live yesterday/today window; one HTTP GET per date). Truncation is PAIR-ATOMIC on nearest-
// kickoff-first order: a kickoff either contributes BOTH its boards or NEITHER, so a tight cap can
// only make the furthest fixtures wait (they re-enter as the horizon advances) — never leave a
// fixture looking covered while its real board is silently missing (the miss-class of the n92 bug).
// The default cap 12 exceeds the provable maximum distinct dates, horizonDays + 2 = 10 (at most 9
// UTC days intersect an 8-day window incl. both partial end days, +1 for the earliest shadow), so
// with defaults nothing is ever dropped.
export function upcomingUnresolvedDates(matchRows, nowMs, { horizonDays = 8, cap = 12 } = {}) {
  const horizonMs = horizonDays * 86400000;
  const byKickoff = new Map();                       // kickoff ms → its deduped board-date pair
  for (const r of matchRows) {
    if (r.status !== 'scheduled') continue;
    if (r.home_team && r.away_team) continue;        // already fully resolved
    if (!r.kickoff_utc) continue;
    const t = Date.parse(r.kickoff_utc);
    if (Number.isNaN(t) || t < nowMs || t > nowMs + horizonMs) continue;
    const main = utcDate(new Date(t));
    const shadow = utcDate(new Date(t - 6 * 3600000));
    byKickoff.set(t, shadow === main ? [main] : [shadow, main]);
  }
  const set = new Set();
  for (const t of [...byKickoff.keys()].sort((a, b) => a - b)) {
    const add = byKickoff.get(t).filter((d) => !set.has(d));
    if (set.size + add.length > cap) continue;       // pair-atomic: never split a kickoff's boards
    for (const d of add) set.add(d);
  }
  return [...set].sort();
}

// Decide the team-name fills for one matched event. `stored` = the matches row {status, home_team,
// away_team}; `espn` = {home, away} ESPN display names from normalize(); `known` = knownTeamSet();
// `isManual(field)` = true if a manual override holds that field. Returns
//   { fills: [{field, value}], gaps: [espnName, …] }.
// Canonicalizes ESPN's name to ours via the shared TEAM_ALIAS (single source of truth), then
// FILL-BLANK-ONLY: never overwrites an existing real name, never writes a placeholder, never touches
// a manual override. We write ESPN's home/away ORIENTATION verbatim — ESPN is canon for identity, so
// its side ordering is what we mirror (asserted by the inversion test).
//
// `gaps` = ESPN names that look like a REAL team (NOT a bracket placeholder) but aren't in `known`
// after aliasing — a MISSING ALIAS. The caller MUST log these loudly: a missing alias otherwise
// fails silent-to-placeholder, the exact bug class this release kills (an internal review — South Korea / Iran
// were missing from the old hand-curated subset, un-bitten only because both were eliminated).
// `feederFinished(side)` → true iff this fixture's `side` slot is fed by a round-N match that is
//   ALREADY finished (or has no match-feeder, e.g. an R32 group-slot). Default: assume finished, so
//   callers that don't wire the bracket keep the old behaviour. See feederFinishedFor() below.
export function resolveTeamFills(stored, espn, known, isManual = () => false, feederFinished = () => true) {
  const gaps = [];
  if (!stored) return { fills: [], gaps };
  // Finished games are NOT skipped: a knockout that resolved AND played during the old bug window
  // kept NULL teams (e.g. #73), so it must still backfill. fill-blank-only (below) leaves a finished
  // game that already has real teams untouched anyway — so this never clobbers a played result.
  //
  // BUG-2 (v3.08.02): resolve BOTH sides ATOMICALLY. The old code filled each side independently, so
  // a tie with one resolved side + one still-placeholder side landed "Paraguay vs Winner Match 77" in
  // D1 (and thus on the page). We now compute a candidate fill per blank side and only COMMIT the pair
  // when EVERY blank side we were asked to fill has a real, feeder-provenance-valid team — otherwise we
  // hold the whole fixture as placeholders until ESPN fully resolves it. Provenance guard: a side is
  // never promoted while its round-N feeder match is unfinished (the "Paraguay in R16 #89 while its
  // R32 #74 hasn't finished" smell), even if ESPN speculatively labels the slot.
  const candidates = [];        // {field, value} we would write if the whole tie clears
  let blankSides = 0;           // sides that are currently blank (i.e. need resolving)
  let resolvedSides = 0;        // of those, how many produced a valid real-team candidate
  for (const side of ['home', 'away']) {
    const field = `${side}_team`;
    if (stored[field]) continue;               // already a real team → never clobber, not a blank
    if (isManual(field)) continue;             // a human entry always wins → treat as settled, skip
    blankSides++;
    const raw = espn?.[side];
    if (!raw) continue;                         // ESPN gave nothing for this side → unresolved
    const name = canonTeam(raw);               // canonicalize ESPN variant → our spelling
    if (!known.has(name)) {
      // Not a known participant: an ESPN bracket placeholder (expected — skip silently) OR a real
      // team we lack an alias for (silent-to-placeholder bug — surface it as a gap canary).
      if (!ESPN_PLACEHOLDER_RE.test(raw)) gaps.push(raw);
      continue;                                 // still a placeholder → tie not fully resolved
    }
    if (!feederFinished(side)) continue;        // provenance guard: feeder match not finished → hold
    candidates.push({ field, value: name });
    resolvedSides++;
  }
  // Atomic gate: commit only when every blank side we needed cleared. Any shortfall → hold all.
  const fills = (blankSides > 0 && resolvedSides === blankSides) ? candidates : [];
  return { fills, gaps };
}

// Parse a knockout feeder pointer to its feeder match number, or null when the slot has no
// match-feeder (group-slot like "1A", "3C/D/F/G/H" — R32 seeds resolved by group standings, not by a
// knockout result). Two match-feeder forms exist (see scripts/build-matches.mjs openfootball parse):
//   "W74"  → WINNER of match 74  (the normal knockout advance)
//   "L101" → LOSER  of match 101 (the THIRD-PLACE match's two feeders = the semi-final losers)
// Both carry a real unfinished-match dependency, so both must be gated; only "L" was previously
// unparsed and fell through to default-allow like a legit group seed (an internal review, gap b).
export function feederMatchNo(placeholder) {
  const m = /^[WL](\d+)$/.exec(String(placeholder || ''));
  return m ? Number(m[1]) : null;
}

// A finished feeder result (either provisional or confirmed) — the only states from which a
// downstream slot may legitimately be promoted. Mirrors the D1 status CHECK constraint
// (migrations/0001_schema.sql): status ∈ scheduled | in_play | finished_provisional |
// finished_confirmed | postponed.
const isFinishedStatus = (s) => /^finished/.test(String(s || ''));
// A "live/pending" feeder that is simply not finished YET — the slot correctly holds and will clear
// on a later poll once the feeder finishes. These do NOT hang: the tournament advances through them.
const isPendingStatus = (s) => { const v = String(s || ''); return v === '' || v === 'scheduled' || v === 'in_play'; };

// Build a feederFinished(side) predicate for one fixture from the D1 matches map. A side whose feeder
// match isn't finished_* holds; a side with no match-feeder (group seed) is always allowed.
//
// CANARY (an internal review, gap a): a feeder in a TERMINAL non-finished status — `postponed` (the sole such
// value in the D1 CHECK constraint) — never becomes finished on its own, so the naive /^finished/ gate
// would hold the downstream slot INDEFINITELY and SILENTLY. We keep holding (never promote off an
// unplayed feeder) but WARN loudly, mirroring the aliasGaps canary in worker/poll.mjs, so a postponed
// knockout feeder surfaces instead of stalling promotion in silence. `onGap(msg)` lets the caller
// collect the canary alongside its other warnings; it defaults to console.warn.
export function feederFinishedFor(fixtureMeta, byNo, onGap = (msg) => console.warn(msg)) {
  return (side) => {
    const fno = feederMatchNo(fixtureMeta?.[`${side}_placeholder`]);
    if (fno == null) return true;               // group-slot feeder → not gated on a match result
    const row = byNo.get?.(fno) ?? byNo[fno];
    const status = row?.status;
    if (isFinishedStatus(status)) return true;
    if (!isPendingStatus(status)) {
      // Terminal-but-not-finished (postponed): would hang forever. Hold, but do not do so silently.
      onGap(`FEEDER-STUCK match ${fno} (feeds ${side} slot) status='${status}' is terminal-non-finished — downstream promotion is BLOCKED until this feeder is replayed/rescheduled or resolved manually`);
    }
    return false;                               // feeder not finished (pending OR stuck) → hold slot
  };
}

// Build-time merge: fill a fixture's blank home/away team from the live-state export (D1, where the
// poll already wrote ESPN-resolved + canonicalized teams). FILL-BLANK-ONLY — a team matches.json
// already knows (the group stage) is left untouched, so this can only resolve a knockout placeholder
// and never clobbers. Mutates + returns `match`. This is the second mutation site (mirror of the
// poll's resolveTeamFills); build.mjs calls it so the logic is unit-tested here, not only in the bake.
export function mergeResolvedTeams(match, liveRow) {
  if (!match || !liveRow) return match;
  // BUG-2 (v3.08.02): fill BOTH blank sides or NEITHER — mirror resolveTeamFills' atomic gate so the
  // bake can never render "Real vs Winner Match 77" out of a D1 row that is itself half-resolved (a
  // belt-and-braces guard: the poll now writes both-or-neither, but the export could still catch a row
  // mid-resolution, and a manual single-side override is a legitimate case the bake must not split).
  // A side that matches.json ALREADY knows (group stage) is not "blank", so those fill as before.
  const homeBlank = !match.home?.team, awayBlank = !match.away?.team;
  const homeReady = !homeBlank || !!liveRow.home_team;   // resolved already, or D1 has a name
  const awayReady = !awayBlank || !!liveRow.away_team;
  if (!homeReady || !awayReady) return match;            // some blank side still unresolved → hold all
  if (homeBlank && liveRow.home_team) match.home = { ...match.home, team: liveRow.home_team };
  if (awayBlank && liveRow.away_team) match.away = { ...match.away, team: liveRow.away_team };
  return match;
}
