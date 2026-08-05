// Pure view-helpers for the match-page blow-by-blow (site/match.js hydrator + Node tests share these,
// so the escaping + ordering invariants are covered without a DOM). ESPN commentary is verbatim
// third-party copy, so every interpolated field is HTML-escaped before it ever reaches innerHTML.

export const escHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Build the newest-first <li> list for a commentary payload. The API returns sequence-ascending; the
// blow-by-blow shows the latest entry at the top. Key events carry their type as a class
// (goal/yellow/red) for styling. Pure + deterministic: same input → same HTML, so the live poll can
// re-render on every new entry safely.
export const commentaryRowsHTML = (commentary, esc = escHTML) =>
  (Array.isArray(commentary) ? commentary : []).slice().reverse().map((c) =>
    // data-seq / data-min: the match-time alignment hooks for the blow-by-blow ↔ Watch-Along sync
    // (site/match.js). Watch-Along rows carry data-src-seq === this seq (fallback: nearest minute).
    `<li class="cmt${c.key ? ' key ' + esc(c.type || '') : ''}" data-seq="${esc(c.seq ?? '')}" data-min="${esc(c.minute || '')}">` +
    `<span class="cmt-min">${esc(c.minute || '')}</span>` +
    `<span class="cmt-text">${esc(c.text)}</span></li>`).join('');
