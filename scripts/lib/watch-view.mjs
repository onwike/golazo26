// Pure view-helpers for the match-page AI Watch-Along (site/match.js hydrator + Node tests share these, so
// the escaping + ordering invariants are covered without a DOM). The lines are AI-generated comedy grounded
// in the real key-events; every interpolated field is HTML-escaped before it reaches innerHTML. congrats=true
// is the director-mandated FT congratulation → a green left-border (.wa.congrats) in the renderer; provider
// drives the per-AI colour accent (data-provider).

export const escWA = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Build the newest-first <li> list for a watch payload. The API returns seq-ascending; the Watch-Along shows
// the latest line at the top (mirrors the blow-by-blow). Pure + deterministic — same input → same HTML — so
// the live poll can re-render on every new line safely.
export const watchRowsHTML = (watch, esc = escWA) =>
  (Array.isArray(watch) ? watch : []).slice().reverse().map((w) =>
    // data-src-seq: the blow-by-blow seq this AI line reacts to (data-min = its minute) — the match-time
    // alignment hooks for the blow-by-blow ↔ Watch-Along sync (site/match.js). Sparse vs the dense feed.
    `<li class="wa${w.congrats ? ' congrats' : ''}" data-provider="${esc(w.provider || '')}" data-src-seq="${esc(w.src_seq ?? '')}" data-min="${esc(w.minute || '')}">` +
    `<span class="wa-min">${esc(w.minute || '')}</span>` +
    `<span class="wa-who">${esc(w.speaker || '')}</span>` +
    `<span class="wa-line">${esc(w.line)}</span></li>`).join('');
