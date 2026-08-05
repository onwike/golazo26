// Pure view-helpers for the match-page stats comparison (Phase 2.5, the design plan1).
// Convention mirrors commentary-view.mjs / timeline-view.mjs: import-free, data in -> string out,
// shared by the Node bake (scripts/build.mjs bakes an empty/hidden shell) and the browser hydrator
// (site/match.js, which fills it from /api/v1/match-stats). ESPN boxscore values are third-party
// copy, so every interpolated field is HTML-escaped before it ever reaches innerHTML.

export const escST = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The curated subset shown as comparison bars (plan item 4: "possession/shots/on-target/corners/
// fouls comparison bars"), in display order. key = the camelCase field the /api/v1/match-stats
// endpoint returns (scripts/lib/espn-stats.mjs FIELD_MAP); pct: true renders the raw value as a
// percentage bar (0-100) rather than a max-of-two-values bar.
const ROWS = [
  { key: 'possessionPct', label: 'Possession', pct: true, suffix: '%' },
  { key: 'totalShots', label: 'Shots' },
  { key: 'shotsOnTarget', label: 'Shots on target' },
  { key: 'wonCorners', label: 'Corners' },
  { key: 'foulsCommitted', label: 'Fouls' },
  { key: 'yellowCards', label: 'Yellow cards' },
  { key: 'redCards', label: 'Red cards' },
  { key: 'totalPasses', label: 'Passes' },
  { key: 'passPct', label: 'Pass accuracy', pct: true, suffix: '%' },
];

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// one comparison row: home value — bar — away value. Bar widths are proportional to each side's
// share of (home+away); a null on either side renders that side as a dash, never NaN/0-fabrication,
// and the bar falls back to a 50/50 split (never divide by zero).
const row = (r, home, away, esc) => {
  const h = numOrNull(home?.[r.key]);
  const a = numOrNull(away?.[r.key]);
  const total = (h ?? 0) + (a ?? 0);
  const hPct = h == null && a == null ? 50 : total > 0 ? (h ?? 0) / total * 100 : 50;
  const aPct = 100 - hPct;
  const fmt = (v) => v == null ? '—' : `${esc(String(v))}${r.suffix ?? ''}`;
  return `<div class="mst-row"><span class="mst-val mst-home">${fmt(h)}</span>` +
    `<span class="mst-bar"><span class="mst-bar-h" style="width:${hPct}%"></span><span class="mst-bar-a" style="width:${aPct}%"></span></span>` +
    `<span class="mst-val mst-away">${fmt(a)}</span><span class="mst-label">${esc(r.label)}</span></div>`;
};

// statsRowsHTML(home, away) — the row list only (no wrapping section/heading), so both the bake
// (empty shell) and the hydrator (fills an existing shell) can reuse the exact same markup. '' when
// both sides are null/absent — never a section of dashes.
export const statsRowsHTML = (home, away, esc = escST) => {
  const e = typeof esc === 'function' ? esc : escST; // Array.map-callback safety
  if (!home && !away) return '';
  return ROWS.map((r) => row(r, home, away, e)).join('');
};
