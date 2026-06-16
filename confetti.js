// Goal celebration — team-coloured ticker-tape burst on the match page.
// Zero-dep. Pure helpers are exported for `node --test`; the DOM/canvas layer is
// guarded so importing this module under Node never touches a browser API.
//
// Behaviour:
//   • force  = floor + |goal difference|  (every goal pops; a lead amplifies)
//   • origin = left=home / right=away on ALL devices (matches the wrapping header)
//   • length = 5–10s by the SCORING TEAM'S running tally

// ---------- pure helpers (unit-tested, no DOM) ----------

// 5s for a team's 1st goal, +1.25s each, clamped at 10s.
export function durationMs(teamGoals) {
  const g = Math.max(1, Math.floor(teamGoals || 1));
  return Math.round(Math.min(10, 5 + (g - 1) * 1.25) * 1000);
}

// Floor so a 0-diff equaliser still erupts; scales with |diff|, capped at 5.
export function forceFor(goalDiff) {
  const t = Math.min(Math.abs(Math.floor(goalDiff || 0)), 5) / 5; // 0..1
  return {
    particles: Math.round(80 + t * 220), // 80 (floor) → 300 (cap)
    velocity: 9 + t * 9,                  // 9 → 18 px/frame
    spread: 35 + t * 40,                  // 35° → 75°
  };
}

// Burst anchor: home from the left edge, away from the right, every viewport.
export function originFor(side, vw) {
  const w = vw || 0;
  return side === 'home' ? { x: 0, edge: 'left', dir: 1 } : { x: w, edge: 'right', dir: -1 };
}

// ≥2 colours always; single-colour flags fall back to [primary, white] (flag-accurate).
export function resolveColors(entry) {
  const cols = ((entry && entry.colors) || []).filter(Boolean);
  if (cols.length >= 2) return cols.slice(0, 3);
  const ui = (entry && entry.ui) || {};
  const fb = [ui.primary || cols[0] || '#888888', ui.secondary || '#ffffff'].filter(Boolean);
  return fb.length >= 2 ? fb : [fb[0] || '#888888', '#ffffff'];
}

export function prefersReducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------- DOM / canvas layer (browser only) ----------

let _live; // shared polite live-region for goal announcements
function announce(text) {
  if (typeof document === 'undefined') return;
  if (!_live) {
    _live = document.createElement('div');
    _live.setAttribute('aria-live', 'polite');
    // self-contained visually-hidden (no CSS-class dependency)
    _live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;padding:0;margin:-1px';
    document.body.appendChild(_live);
  }
  _live.textContent = text;
}

// celebrateGoal({ side, colors, teamGoals, goalDiff, label })
// side: 'home'|'away'; colors: string[]; label: e.g. "Canada — 78'" for a11y.
export function celebrateGoal(opts) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const { side = 'home', colors = ['#888'], teamGoals = 1, goalDiff = 0, label = '' } = opts || {};

  // The goal is announced to everyone — the canvas is pure decoration.
  announce(label ? `Goal. ${label}.` : 'Goal scored.');

  // Honesty + a11y: no full-screen motion for reduced-motion users.
  if (prefersReducedMotion()) return;

  const dur = durationMs(teamGoals);
  const force = forceFor(goalDiff);
  // defensive: never build a 0-size canvas (some embedded/headless contexts report 0)
  const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
  const vh = window.innerHeight || document.documentElement.clientHeight || 720;
  const origin = originFor(side, vw);

  const cv = document.createElement('canvas');
  cv.width = vw; cv.height = vh;
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');

  const baseAngle = origin.dir === 1 ? -Math.PI / 4 : -Math.PI * 3 / 4; // inward + up
  const spreadRad = (force.spread * Math.PI) / 180;
  const parts = Array.from({ length: force.particles }, () => {
    const a = baseAngle + (Math.random() - 0.5) * spreadRad;
    const sp = force.velocity * (0.5 + Math.random());
    return {
      x: origin.x, y: vh * (0.45 + Math.random() * 0.2),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      w: 5 + Math.random() * 5, h: 9 + Math.random() * 7,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0], life: 1,
    };
  });

  let raf, done = false;
  const teardown = () => { if (done) return; done = true; cancelAnimationFrame(raf); cv.remove(); };

  // One simulation+paint step: paint at current positions, THEN integrate — so the
  // very first call (elapsed 0) paints the spawn burst synchronously, before any rAF tick.
  const step = (elapsed) => {
    ctx.clearRect(0, 0, vw, vh);
    let alive = false;
    for (const p of parts) {
      if (elapsed > dur - 1200) p.life -= 0.02; // fade out over the last ~1.2s
      if (p.life > 0 && p.y < vh + 40) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      p.vy += 0.22;        // gravity
      p.vx *= 0.99;        // drag
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    }
    return alive;
  };

  step(0); // instant burst — paints even before the first animation frame
  const start = performance.now();
  const frame = (now) => {
    const elapsed = now - start;
    if (step(elapsed) && elapsed < dur) raf = requestAnimationFrame(frame);
    else teardown();
  };
  raf = requestAnimationFrame(frame);
  // safety net: always tear down by the end, even if rAF is suspended (e.g. backgrounded tab)
  setTimeout(teardown, dur + 600);
}

// ---------- match-page bootstrap (loaded only on /matches/* via build.mjs) ----------
if (typeof document !== 'undefined') {
  const boot = () => {
    const el = document.querySelector('.cl-mid[data-home-colors]');
    if (!el) return; // not a match page with two known teams
    const n = el.getAttribute('data-match');
    const palette = (side) => (el.getAttribute(`data-${side}-colors`) || '').split(',').filter(Boolean);
    document.addEventListener('g26:goal', (e) => {
      const d = e.detail || {};
      if (String(d.n) !== String(n)) return; // only this page's match celebrates
      const colors = palette(d.side);
      if (!colors.length) return;
      const team = el.getAttribute(`data-${d.side}-team`) || '';
      celebrateGoal({ side: d.side, colors, teamGoals: d.teamGoals, goalDiff: d.goalDiff, label: team ? `${team} goal` : '' });
    });
  };
  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
}
