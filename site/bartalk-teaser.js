// Bar Talk front-page teaser rotator. Sits just below the (compact) hero; rotates the best line per
// persona across the last 5 episodes. Hydrates [data-bartalk-teaser] from /api/v1/bartalk-teaser:
//   real data  → render slots + reveal + rotate
//   empty/absent → leave the baked state (hidden in prod; a DEV-mirror sample for layout preview)
// Auto-advances every 7s, pauses on hover/focus, manual dots, wraps. prefers-reduced-motion DISABLES
// auto-advance (static first slide + manual dots only). Idempotent; fails safe (any error keeps the page).
// Character art is G&D's per-persona design (placeholder initial-chip until it lands).
import { bartalkSlotHTML, escBT, bartalkApiBase } from '/bartalk-view.mjs';

const root = document.querySelector('[data-bartalk-teaser]');
if (root) {
  const API = bartalkApiBase();
  const track = root.querySelector('.bt-track');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = null, idx = 0;

  const show = (i) => {
    const lis = track.querySelectorAll('.bt-slot');
    if (!lis.length) return;
    idx = ((i % lis.length) + lis.length) % lis.length;
    lis.forEach((li, k) => li.classList.toggle('is-active', k === idx));
    root.querySelectorAll('.bt-dot').forEach((d, k) => { const on = k === idx; d.classList.toggle('is-active', on); d.setAttribute('aria-selected', on ? 'true' : 'false'); });
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  const start = () => { stop(); if (reduceMotion) return; if (track.querySelectorAll('.bt-slot').length > 1) timer = setInterval(() => show(idx + 1), 7000); };

  const wire = () => {
    const lis = track.querySelectorAll('.bt-slot');
    if (!lis.length) return false;
    let dots = root.querySelector('.bt-dots');
    if (!dots) { dots = document.createElement('div'); dots.className = 'bt-dots'; dots.setAttribute('role', 'tablist'); dots.setAttribute('aria-label', 'Bar Talk highlights'); root.appendChild(dots); }
    dots.innerHTML = [...lis].map((li, k) => `<button class="bt-dot" type="button" role="tab" aria-label="Highlight ${k + 1}: ${escBT(li.querySelector('.bt-name')?.textContent || '')}"></button>`).join('');
    dots.querySelectorAll('.bt-dot').forEach((d, k) => d.addEventListener('click', () => { show(k); start(); }));
    idx = 0; show(0);
    return true;
  };

  const load = async () => {
    try {
      const r = await fetch(`${API}/api/v1/bartalk-teaser`, { cache: 'no-cache' });
      if (!r.ok) return; // leave the baked state (prod hidden / DEV sample)
      const d = await r.json();
      if (!d || !Array.isArray(d.teaser) || !d.teaser.length) return;
      track.innerHTML = d.teaser.slice(0, 5).map((s) => bartalkSlotHTML(s)).join('');
      root.hidden = false;
      wire(); start();
    } catch (e) { /* keep the baked page */ }
  };

  if (wire()) start();                                   // baked slots (DEV sample) → rotate immediately
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', start);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', start);
  window.addEventListener('pageshow', (e) => { if (e.persisted) load(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { load(); start(); } else { stop(); } });
  load();
  // the maintainer (2026-07-03): refresh the teaser pool every 30 min so the front-page panel is never frozen
  // at the last bake. The endpoint is a live read, so a fresh fetch picks up the newer rotation (once
  // WP's endpoint randomizes/enlarges the pool). Idempotent re-render; fails safe like load() itself.
  setInterval(load, 1800000);
}
