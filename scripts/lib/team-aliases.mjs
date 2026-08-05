// team-aliases.mjs — THE single canonical map from an external provider's team name (ESPN display
// name, football-data, openfootball) to OUR canonical FIFA-style spelling used across the site +
// data/matches.json. One source of truth: this was duplicated as `ALIAS` in poll-and-bake.mjs and a
// hand-curated 4-entry subset in poll-fixtures.mjs — the subset silently omitted South Korea / Iran,
// which would fail SILENT-TO-PLACEHOLDER (the exact bug this release kills). Cert: ledger 0378.
// Idempotent: every canonical name is also a key mapping to itself, and unknown names pass through.
export const TEAM_ALIAS = new Map([
  ['South Korea', 'Korea Republic'], ['Korea Republic', 'Korea Republic'], ['Czech Republic', 'Czechia'], ['Czechia', 'Czechia'],
  ['Bosnia-Herzegovina', 'Bosnia and Herzegovina'], ['Bosnia and Herzegovina', 'Bosnia and Herzegovina'],
  ['Turkey', 'Türkiye'], ['Türkiye', 'Türkiye'], ['Ivory Coast', "Côte d'Ivoire"], ["Côte d'Ivoire", "Côte d'Ivoire"],
  ['Iran', 'IR Iran'], ['IR Iran', 'IR Iran'], ['Cape Verde', 'Cabo Verde'], ['Cape Verde Islands', 'Cabo Verde'], ['Cabo Verde Islands', 'Cabo Verde'], ['Cabo Verde', 'Cabo Verde'],
  ['DR Congo', 'Congo DR'], ['Congo DR', 'Congo DR'], ['United States', 'USA'], ['USA', 'USA'],
  ['Curacao', 'Curaçao'], ['Curaçao', 'Curaçao'],
]);

// canonTeam(name) → our canonical spelling (idempotent; unknown names pass through unchanged).
// NFC-normalizes the input first so an ESPN displayName delivered in decomposed (NFD) form —
// 'Türkiye'/'Curaçao'/"Côte d'Ivoire" — still matches the (NFC) alias keys (an internal review minor).
export const canonTeam = (s) => (s == null ? s : (TEAM_ALIAS.get(s.normalize('NFC')) ?? s));

// ESPN labels an UNRESOLVED knockout slot with a placeholder "team" ("Group C Winner",
// "Quarterfinal 1 Winner", "Round of 32 3 Winner", abbr QFW1, "TBD"). These must be skipped
// silently; a REAL ESPN team name we just lack an alias for must NOT be (it's the silent-to-
// placeholder bug). This RE distinguishes the two so the caller can canary the real-but-unknown.
export const ESPN_PLACEHOLDER_RE = /winner|runner|\bplace\b|\bgroup\b|round of|quarter|semi|\bfinal\b|tbd|to be determined/i;
