// SVG connector layer for the knockout bracket (v3.09). Draws Google-style elbow arrows from each
// match box to the next, BEHIND the boxes, coloured by the FEEDER match's state of play:
//   • upcoming  → neutral hairline
//   • finished  → green (the result is in, advancing)
//   • in-play   → live colour + a pulsating neon glow (CSS .bk-live animation)
// State is read live from each box's own .pill, so it tracks the 60s hydrator (app.js) and the bake.
// Geometry is MEASURED from the rendered boxes, so it survives any flex/layout/responsive change; the
// SVG lives inside .bracket (the scrolling content), so it pans with the bracket — no scroll handler.
(function () {
  const bracket = document.querySelector('.bracket.halves');
  if (!bracket) return;
  const NS = 'http://www.w3.org/2000/svg';
  bracket.style.position = 'relative';
  let svg = null;

  const stateOf = (box) => {
    const pill = box.querySelector('.bbst .pill');
    if (!pill) return 'sched';
    if (pill.classList.contains('live')) return 'live';
    if (pill.classList.contains('ft')) return 'ft';
    return 'sched';
  };

  function ensureSvg() {
    if (svg) return;
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'bk-conn');
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(NS, 'defs');
    const mk = document.createElementNS(NS, 'marker');
    mk.setAttribute('id', 'bk-arrow');
    mk.setAttribute('viewBox', '0 0 8 8');
    mk.setAttribute('refX', '7'); mk.setAttribute('refY', '4');
    mk.setAttribute('markerWidth', '5'); mk.setAttribute('markerHeight', '5');
    mk.setAttribute('orient', 'auto');
    const mp = document.createElementNS(NS, 'path');
    mp.setAttribute('d', 'M0 0 L8 4 L0 8 Z');
    mp.setAttribute('fill', 'context-stroke');
    mk.appendChild(mp); defs.appendChild(mk); svg.appendChild(defs);
    bracket.prepend(svg);
  }

  function draw() {
    ensureSvg();
    // The telescoping bracket re-lays-out at native size (no transform), so getBoundingClientRect is
    // direct. The arrows re-stretch to whatever's visible: skip any box in a flown-off (.off) column.
    const W = bracket.offsetWidth, H = bracket.offsetHeight;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    Array.prototype.forEach.call(svg.querySelectorAll('path.bk-line'), (p) => p.remove());
    const brect = bracket.getBoundingClientRect();
    const boxes = Array.prototype.slice.call(bracket.querySelectorAll('.bbox[data-mno]'));
    const byMno = new Map(boxes.map((b) => [b.getAttribute('data-mno'), b]));
    const rel = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - brect.left, t: r.top - brect.top, w: r.width, h: r.height }; };
    for (const child of boxes) {
      const pMno = child.getAttribute('data-feeds');
      if (!pMno) continue;
      const parent = byMno.get(pMno);
      if (!parent) continue;
      if (child.closest('.bcol.off') || parent.closest('.bcol.off')) continue; // a flown-off stage
      if (child.getBoundingClientRect().width < 2 || parent.getBoundingClientRect().width < 2) continue;
      const rightSide = !!child.closest('.side-r');
      const c = rel(child), p = rel(parent);
      const y1 = c.t + c.h / 2, y2 = p.t + p.h / 2;
      let x1, x2;
      if (rightSide) { x1 = c.l; x2 = p.l + p.w + 2; } else { x1 = c.l + c.w; x2 = p.l - 2; }
      const midX = (x1 + x2) / 2;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', 'bk-line bk-' + stateOf(child));
      path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' H ' + midX + ' V ' + y2 + ' H ' + x2);
      path.setAttribute('marker-end', 'url(#bk-arrow)');
      svg.appendChild(path);
    }
  }

  let st = 0;
  const schedule = () => { clearTimeout(st); st = setTimeout(draw, 40); };
  schedule();
  window.addEventListener('load', schedule);
  window.addEventListener('resize', schedule);
  bracket.addEventListener('bk:relayout', schedule); // stage changed -> stages flew off, re-stretch arrows
  bracket.addEventListener('transitionend', schedule); // redraw once the fly-off columns settle
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(bracket);
  // pick up live-state changes the 60s hydrator writes into the .pill; skip the redraw while the tab
  // is hidden (cert v3.09 A4: no redundant work on a backgrounded long-open homepage).
  setInterval(() => { if (document.visibilityState !== 'hidden') draw(); }, 20000);
})();
