// Pure view-helpers for the match-page redesign, phase 1 (the design plan1).
// Convention mirrors commentary-view.mjs: import-free, data in → string out, shared by the Node
// bake (scripts/build.mjs) and — once Phase 2's events endpoint lands — the browser hydrator, so
// the escaping + rendering invariants are unit-covered without a DOM. ESPN match-details fields
// (player/assist/minute/on/off) are third-party copy: every interpolated field is HTML-escaped.
//
// Every renderer takes an optional escape helper but GUARDS it (typeof esc !== 'function' →
// fall back to escTL), so each stays safe when used directly as an Array.map callback, where
// the 2nd argument is the numeric index.

export const escTL = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TL_TYPES = {
  goal:        { cls: 'tl-goal',   icon: '⚽', label: 'goal' },
  yellow:      { cls: 'tl-yellow', icon: '🟨', label: 'yellow card' },
  red:         { cls: 'tl-red',    icon: '🟥', label: 'red card' },
  sub:         { cls: 'tl-sub',    icon: '⇄', label: 'substitution' },
  // Penalty kicks (in-play or shootout — espn.mjs mapType() cannot tell them apart; see its
  // comment) get their own rows, never folded into 'goal' — a shootout decider must render, but
  // must not look like a scoreline-changing goal on the timeline.
  'pen-scored': { cls: 'tl-pen',    icon: '⚽', label: 'penalty scored' },
  'pen-missed': { cls: 'tl-pen',    icon: '❌', label: 'penalty missed' },
  'pen-saved':  { cls: 'tl-pen',    icon: '🧤', label: 'penalty saved' },
};

// timelineHTML(events) — the merged narrative timeline ("The Story"): goals / subs / cards from
// ESPN's match-details events, home events on the left, away on the right, a center spine between.
// Unknown event types are skipped (fail-safe against new ESPN incident kinds). '' when no rows.
export const timelineHTML = (events, esc = escTL) => {
  const e = typeof esc === 'function' ? esc : escTL; // Array.map-callback safety (2nd arg = index)
  const rows = (Array.isArray(events) ? events : []).filter((ev) => ev && TL_TYPES[ev.type]);
  if (!rows.length) return '';
  const row = (ev) => {
    const t = TL_TYPES[ev.type];
    const side = ev.team === 'away' ? 'away' : 'home';
    const min = e(ev.minute ?? '');
    const body = ev.type === 'sub'
      ? `${min} ${e(ev.on ?? '')} <span class="muted">for ${e(ev.off ?? '')}</span>`
      : ev.type === 'goal'
        ? `${min} <b>${e(ev.player ?? '')}</b>${ev.og ? ' <span class="muted">(o.g.)</span>' : ''}${(ev.assist && !ev.og) ? ` <span class="muted">— assist ${e(ev.assist)}</span>` : ''}`
        : ev.type === 'pen-scored' || ev.type === 'pen-missed' || ev.type === 'pen-saved'
          ? `${min} <b>${e(ev.player ?? '')}</b> ${t.label}`
          : `${min} <b>${e(ev.player ?? '')}</b> ${ev.type === 'red' ? 'sent off' : 'booked'}`;
    const card = `<div class="tl-ev">${body}</div>`;
    return `<div class="tl-row ${side} ${t.cls}">` +
      `<div class="tl-cell">${side === 'home' ? card : ''}</div>` +
      `<div class="tl-ico" role="img" aria-label="${t.label}">${t.icon}</div>` +
      `<div class="tl-cell">${side === 'away' ? card : ''}</div></div>`;
  };
  return `<div class="mtl">${rows.map(row).join('')}</div>`;
};

// keyMomentsHTML(events, codes) — the key-moment chip strip under the score cluster: goals + cards
// ONLY (no subs), each chip = icon + minute + player + team code, with one trailing muted
// "via espn" provenance pill. codes = { home: 'GER', away: 'PAR' } (FIFA codes; either may be '').
// '' when there are no goal/card events — the strip is omitted entirely.
export const keyMomentsHTML = (events, codes, esc = escTL) => {
  const e = typeof esc === 'function' ? esc : escTL; // Array.map-callback safety
  const KM = { goal: '⚽', yellow: '🟨', red: '🟥', 'pen-scored': '⚽', 'pen-missed': '❌', 'pen-saved': '🧤' };
  // shootout kicks (ev.shootout) are excluded here — a 10+ kick shootout would flood the quick-glance
  // strip; they render in the full timeline ("The Story") instead. In-play penalties (no shootout flag) stay.
  const moments = (Array.isArray(events) ? events : []).filter((ev) => ev && KM[ev.type] && !ev.shootout);
  if (!moments.length) return '';
  const chip = (ev) => {
    const code = codes && typeof codes === 'object' ? codes[ev.team === 'away' ? 'away' : 'home'] : '';
    return `<span class="chip kmo">${KM[ev.type]} ${e(ev.minute ?? '')} ${e(ev.player ?? '')}${ev.og ? ' (o.g.)' : ''}${code ? ` · ${e(code)}` : ''}</span>`;
  };
  return `<div class="kmoments">${moments.map(chip).join('')}<span class="kmo-src">via espn</span></div>`;
};

// anchorStripHTML(sections) — the in-page anchor chip strip. sections = [{ href: '#lineups',
// label: 'lineups' }, …], pre-filtered by the bake to sections that actually rendered.
// '' when fewer than 2 targets exist (a one-link strip is noise, not navigation).
export const anchorStripHTML = (sections, esc = escTL) => {
  const e = typeof esc === 'function' ? esc : escTL; // Array.map-callback safety
  const list = (Array.isArray(sections) ? sections : []).filter((s) => s && s.href && s.label);
  if (list.length < 2) return '';
  return `<nav class="anchors" aria-label="On this page">${list.map((s) => `<a class="chip" href="${e(s.href)}">${e(s.label)}</a>`).join('')}</nav>`;
};
