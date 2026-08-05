// Site-wide goal celebration (v3.09). A PURE g26:goal CONSUMER — like confetti.js, it owns NO poller.
// app.js's live tick is the ONLY score poller (gated to data-live pages, tournament-window guarded); on a
// score increment it emits `g26:goal` with { n, side, teamGoals, goalDiff, score }. This overlay listens for
// that event and slides a ~6s band over the page: ticker + confetti + the scoring nation sprinting off with
// the World Cup trophy, the OPPONENT leading the chase, and the other still-alive teams behind. Teams/colours/
// alive resolve from the baked /data/goal-context.json. build.mjs injects this ONLY on live pages except the
// match page (which runs confetti.js). Honours prefers-reduced-motion (ticker band only, no motion).
(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let ctx = null, busy = false;

  const root = document.createElement('div');
  root.className = 'goalcel';
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = '<div class="gc-band"><div class="gc-tick"><span class="gc-tickin"></span></div><div class="gc-track"></div><div class="gc-conf"></div></div>';
  const tickin = root.querySelector('.gc-tickin'), track = root.querySelector('.gc-track'), confl = root.querySelector('.gc-conf');

  const el = (cls, txt) => { const e = document.createElement('div'); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const codeOf = (n) => (ctx && ctx.t[n]) ? ctx.t[n][0] : n.slice(0, 3).toUpperCase();
  const colOf = (n) => (ctx && ctx.t[n]) ? ctx.t[n][1] : '#888';
  function chip(name, opts) {
    const w = el('gc-chip'); const f = el('gc-fl'); f.style.background = colOf(name); w.appendChild(f);
    w.appendChild(el('gc-code', codeOf(name)));
    if (opts && opts.trophy) { const t = document.createElement('i'); t.className = 'ti ti-trophy gc-trophy'; t.setAttribute('aria-hidden', 'true'); w.appendChild(t); }
    if (opts && opts.tag) { const g = el('gc-tag ' + (opts.tagcls || ''), opts.tag); w.appendChild(g); }
    return w;
  }
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  function confetti() {
    confl.textContent = '';
    const cols = ['#1f9d55', '#f5c518', '#c0533a', '#4285f4', '#e24b4a', '#ffffff', '#9333ea'];
    for (let i = 0; i < 54; i++) { const p = el('gc-confp'); p.style.left = (24 + Math.random() * 52) + '%'; p.style.background = cols[i % cols.length]; p.style.setProperty('--tx', ((Math.random() * 2 - 1) * 260).toFixed(0) + 'px'); p.style.setProperty('--ty', (-(70 + Math.random() * 180)).toFixed(0) + 'px'); p.style.setProperty('--r', (Math.random() * 820 - 410).toFixed(0) + 'deg'); p.style.animationDelay = (Math.random() * 0.3).toFixed(2) + 's'; confl.appendChild(p); }
  }
  function runner(name, opts, startPct, dist, z) { const r = el('gc-runner'); if (opts && opts.scorer) r.classList.add('gc-scorer'); if (opts && opts.opp) r.classList.add('gc-opp'); r.style.setProperty('--start', startPct + '%'); r.style.setProperty('--dist', dist + 'px'); r.style.zIndex = z; r.appendChild(chip(name, opts)); return r; }

  function celebrate(n, side, score) {
    if (busy || !ctx) return;
    const pair = ctx.m[n]; if (!pair) return;
    const scorer = side === 'home' ? pair[0] : pair[1];
    const opp = side === 'home' ? pair[1] : pair[0];
    busy = true;
    const sc = score ? (' ' + score.home + '–' + score.away + ' ') : ' ';
    tickin.textContent = '⚽  GOAL!  ' + codeOf(pair[0]) + sc + codeOf(pair[1]) + '  —  ' + codeOf(scorer) + ' score!  ·  GOOOOOL  ·  ⚽  GOAL!  ' + codeOf(scorer) + '  ·';
    track.textContent = '';
    if (!REDUCED) {
      const pool = shuffle((ctx.alive || []).filter((x) => x !== scorer && x !== opp)).slice(0, 6);
      pool.forEach((nm, i) => track.appendChild(runner(nm, {}, 1 + i * 4, 360 + Math.random() * 40, 2)));
      track.appendChild(runner(opp, { opp: true, tag: 'chasing', tagcls: 'gc-tag-opp' }, 24, 470, 3));
      track.appendChild(runner(scorer, { scorer: true, trophy: true, tag: 'scored', tagcls: 'gc-tag-scorer' }, 34, 540, 4));
      confetti();
    }
    root.classList.remove('go'); void root.offsetWidth; root.classList.add('go');
    setTimeout(() => { root.classList.remove('go'); busy = false; }, 6200);
  }

  function init() {
    document.body.appendChild(root);
    // teams / colours / still-alive — baked once, cached
    fetch('/data/goal-context.json', { cache: 'force-cache' }).then((r) => r.json()).then((j) => { ctx = j; }).catch(() => {});
    // app.js's live poller is the single source of goal events (it already dedupes + tournament-window-gates);
    // this overlay just reacts — no own poller, no duplicate fetch, nothing on the ~1,370 static pages.
    document.addEventListener('g26:goal', (e) => { const d = e.detail || {}; celebrate(d.n, d.side, d.score); });
    window.__g26GoalCelebrate = celebrate; // manual trigger for verification/demos
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
