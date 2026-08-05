// (Bracket Monument) — pens/shootout winner derivation for the knockout bracket.
//
// A level-score knockout tie is decided by a penalty shootout, but the shootout winner and
// score are NOT present in the baked match data: ESPN marks a shootout only via
// `period.number` / `competitor.shootoutScore`, neither of which is captured at bake time
// (see scripts/lib/espn.mjs — per-event mapping can't see shootout context), and the live
// worker (worker/data.mjs) exposes only status + home/away score + resolved team names. So
// koWin() returns '' for a 1:1 finished tie and the advancing side shows no winner signal at all.
//
// We recover the advancer WITHOUT any new data by reading the DOWNSTREAM fixture: the feeder's
// winner is whichever of its two teams the PARENT match now shows as a resolved team (the poll
// resolves the parent's slot from ESPN once the feeder finishes). This is DISPLAY-only and is
// complementary to WP's shootout DATA capture (ledger 0509/0511) — it does not depend on it.
//
// Returns 'home' | 'away' | '' — '' when not derivable: not a decided level-score tie, no parent
// (the Final / third-place match feed nothing), or the parent slot isn't resolved yet (graceful:
// the leaf simply shows no winner until the next bake resolves it, exactly as today).

const FINISHED = new Set(['finished_confirmed', 'finished_provisional']);

export function pensWinnerSide(match, parent) {
  if (!match || !match.score || !FINISHED.has(match.status)) return '';
  const { home, away } = match.score;
  if (home == null || away == null) return '';
  if (home !== away) return '';                 // decided in normal/extra time — koWin handles it
  if (!parent) return '';                        // Final / third-place / no downstream fixture
  const resolved = new Set([parent.home?.team, parent.away?.team].filter(Boolean));
  if (match.home?.team && resolved.has(match.home.team)) return 'home';
  if (match.away?.team && resolved.has(match.away.team)) return 'away';
  return '';                                     // parent not yet resolved to the advancing team
}
