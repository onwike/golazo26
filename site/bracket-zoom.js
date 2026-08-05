// Telescoping bracket (v3.10). Zooming to a stage shows that stage AND every later stage; earlier
// stages fly off-screen and the rest expand to fill the window — NO scrollbars, and because it
// re-lays-out at native size (rather than magnifying a bitmap) the text stays crisp at every level.
// Also: a 5-second hover on a box reveals match detail, and the final fires a random heat climax
// (capped at 2 per rolling 10s). Connectors live in bracket-connectors.js and redraw on bk:relayout.
(function () {
  const win = document.querySelector('.bracket-window');
  if (!win) return;
  const bracket = win.querySelector('.bracket.halves');
  if (!bracket) return;
  const cols = Array.prototype.slice.call(bracket.querySelectorAll('.bcol'));
  const wrap = win.closest('.bracket-wrap') || win.parentNode;
  const stageBtns = Array.prototype.slice.call(wrap.querySelectorAll('[data-bk-stage]'));
  const zoomBtn = win.querySelector('[data-bk-zoom]');
  const RANK = { group: 0, r32: 1, r16: 2, qf: 3, sf: 4, final: 5 };
  const FS = { group: 0.78, r32: 0.86, r16: 1.0, qf: 1.16, sf: 1.42, final: 1.9 };
  const rankOf = (c) => RANK[(c.className.match(/\bb-(group|r32|r16|qf|sf|final)\b/) || [])[1]] ?? 1;
  let stage = win.getAttribute('data-stage') || 'r32';
  const widest = stageBtns.length ? stageBtns[0].getAttribute('data-bk-stage') : 'group';

  const relayout = () => bracket.dispatchEvent(new CustomEvent('bk:relayout'));
  // On narrow screens the bracket overflows (readable columns + horizontal scroll), so bring the
  // focused stage's leftmost visible column into view; on desktop it fits and this is a no-op.
  function scrollToFocus() {
    const vis = cols.find((c) => !c.classList.contains('off'));
    win.scrollLeft = (vis && win.scrollWidth > win.clientWidth + 4) ? Math.max(0, vis.offsetLeft - 8) : 0;
  }
  // On a narrow screen a focused stage can overflow with fixtures fully off-canvas and no way
  // to reach them by touch (the window clips). AFTER each fly-off settles, if the view overflows on
  // mobile, the window becomes a swipeable snap strip (bk-swipe) and edge fades flag hidden columns
  // (bk-more-l/r on the wrap). Desktop and in-transition behavior keep the certified clip untouched.
  function updateFades() {
    const more = win.scrollWidth > win.clientWidth + 4;
    wrap.classList.toggle('bk-more-l', more && win.scrollLeft > 8);
    wrap.classList.toggle('bk-more-r', more && win.scrollLeft < win.scrollWidth - win.clientWidth - 8);
  }
  function applySwipe() {
    const mobile = window.matchMedia && matchMedia('(max-width: 640px)').matches;
    const overflowing = win.scrollWidth > win.clientWidth + 4;
    win.classList.toggle('bk-swipe', !!(mobile && overflowing));
    updateFades();
  }
  win.addEventListener('scroll', updateFades, { passive: true });
  function apply() {
    const lvl = RANK[stage] ?? 1;
    win.classList.remove('bk-swipe'); wrap.classList.remove('bk-more-l', 'bk-more-r'); // clip during fly-off
    cols.forEach((c) => c.classList.toggle('off', rankOf(c) < lvl));
    bracket.style.setProperty('--bk-fs', FS[stage] || 1);
    stageBtns.forEach((b) => b.classList.toggle('on', b.getAttribute('data-bk-stage') === stage));
    if (zoomBtn) zoomBtn.disabled = (stage === widest);
    requestAnimationFrame(relayout);
    setTimeout(() => { relayout(); scrollToFocus(); applySwipe(); }, 600); // after the fly-off transition settles
  }
  // Interactivity is a progressive enhancement: the bake already ships the bracket collapsed to curStage
  // (build.mjs offCls — the readable no-JS floor, cert v3.09 A1), so if anything here throws the page is
  // still the correct current-stage telescope rather than a clipped wall.
  try {
    stageBtns.forEach((b) => b.addEventListener('click', () => { stage = b.getAttribute('data-bk-stage'); apply(); }));
    if (zoomBtn) zoomBtn.addEventListener('click', () => { stage = widest; apply(); });

    // (Bracket Monument, the maintainer 0532): the expanded tie card must be DISCOVERABLE — the old
    // 5s dwell was effectively dead and never worked on touch. Desktop: 650ms hover dwell.
    // Touch: first tap EXPANDS the card, second tap follows the link (classic disclosure —
    // no extra element; a <button> inside the .bbox <a> would be invalid HTML). Tapping another
    // leaf or elsewhere collapses. Keyboard parity is CSS (:focus-visible shows the card).
    const collapseAll = (except) => cols.forEach((c) => Array.prototype.forEach.call(
      c.querySelectorAll('.bbox.bk-reveal'), (o) => { if (o !== except) o.classList.remove('bk-reveal'); }));
    cols.forEach((c) => Array.prototype.forEach.call(c.querySelectorAll('.bbox'), (b) => {
      let t;
      b.addEventListener('mouseenter', () => { t = setTimeout(() => b.classList.add('bk-reveal'), 650); });
      b.addEventListener('mouseleave', () => { clearTimeout(t); b.classList.remove('bk-reveal'); });
      b.addEventListener('touchend', (e) => {
        if (!b.classList.contains('bk-reveal')) { e.preventDefault(); collapseAll(b); b.classList.add('bk-reveal'); }
        // already revealed: let the tap through -> navigates to the match page
      }, { passive: false });
      // A6 keyboard parity (an internal review M1): tab-focus adds .bk-reveal too — that's what drops the
      // .bcol clip (.bcol:has(.bk-reveal){overflow:visible}); a CSS-only :focus-visible reveal was
      // clipped. :focus-visible so a mouse click (which also focuses) doesn't pop the card.
      b.addEventListener('focus', () => { if (b.matches(':focus-visible')) { collapseAll(b); b.classList.add('bk-reveal'); } });
      b.addEventListener('blur', () => b.classList.remove('bk-reveal'));
    }));
    document.addEventListener('touchend', (e) => { if (!e.target.closest('.bbox')) collapseAll(null); }, { passive: true });

    apply();
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { relayout(); applySwipe(); }, 150); });
  } catch (e) { /* baked no-JS floor stands; enhancement skipped */ }

  // Heat climax: a violent red->white-hot/blue spike on the final, at most 2 per rolling 10s, fired on
  // a true Poisson (exponential-interval) schedule so it reads as genuinely random, not metronomic.
  const finalBox = bracket.querySelector('.b-final .bcol-in > .bbox');
  if (finalBox && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    const recent = [];
    const ramp = () => {
      const now = Date.now();
      while (recent.length && now - recent[0] > 10000) recent.shift();
      // skip the climax (and its forced reflow) while the tab is hidden — no work on a backgrounded
      // homepage (an internal review follow-up); the loop keeps rescheduling so it resumes when visible.
      if (document.visibilityState !== 'hidden' && recent.length < 2) { finalBox.classList.remove('bk-ramp'); void finalBox.offsetWidth; finalBox.classList.add('bk-ramp'); recent.push(now); }
      setTimeout(ramp, Math.max(1200, -Math.log(1 - Math.random()) * 5200));
    };
    setTimeout(ramp, 2500 + Math.random() * 3000);
  }
})();
