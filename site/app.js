// Golazo 26 — under 10KB of vanilla JS: visitor-local times, schedule filters,
// honest live.json polling (static asset; only while matches could be live).

// 0) sticky thead offset = real header height (header wraps; display font swaps in)
const hdr = document.querySelector('header.site');
if (hdr) {
  const setH = () => document.documentElement.style.setProperty('--g26-header-h', hdr.offsetHeight + 'px');
  setH();
  addEventListener('resize', setH);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(setH);
}

// 1) visitor-local kickoff times — tz + formatter hoisted out of the loop (was
// one Intl.DateTimeFormat construction per element); skip entirely for ET visitors
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (tz !== 'America/New_York') {
  const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  for (const el of document.querySelectorAll('.local-time[data-utc]')) {
    el.title = el.textContent;
    el.textContent = fmt.format(new Date(el.dataset.utc)) + ' (' + el.textContent + ')';
  }
}

// 2) schedule filters — v2 day-grouped rows; count derived, day sections collapse when empty
const srows = document.querySelectorAll('[data-srow]');
if (srows.length && document.getElementById('f-text')) {
  const f = (id) => document.getElementById(id);
  const apply = () => {
    const q = f('f-text').value.toLowerCase(), st = f('f-stage').value, g = f('f-group').value, net = f('f-net').value;
    let n = 0;
    for (const r of srows) {
      const ok = (!q || r.dataset.teams.toLowerCase().includes(q))
        && (!st || r.dataset.stage === st) && (!g || r.dataset.group === g) && (!net || r.dataset.net === net);
      r.style.display = ok ? '' : 'none';
      if (ok) n++;
    }
    for (const sec of document.querySelectorAll('.daysec[data-day]')) {
      const any = [...sec.querySelectorAll('[data-srow]')].some((r) => r.style.display !== 'none');
      sec.style.display = any ? '' : 'none';
    }
    f('f-count').textContent = n + ' of ' + srows.length + ' matches';
  };
  for (const id of ['f-text', 'f-stage', 'f-group', 'f-net']) f(id).addEventListener('input', apply);
  apply();
}

// Honest approximate match minute, from the (exact, scheduled) kickoff + the
// visitor's own clock — ticks every second with ZERO server cost, and is
// actually more current than the delayed free-tier score. Deliberately
// approximate: free data carries no real clock or stoppage, so clamp at
// 45+'/90+', show HT across the nominal break, mark it "≈". Only rendered while
// the feed says in_play; a late/delayed start just stays on the kickoff time.
function matchMinute(kISO) {
  if (!kISO) return 'LIVE';
  const e = (Date.now() - Date.parse(kISO)) / 60000;
  if (e < 0) return 'LIVE';
  if (e < 45) return '≈' + (Math.floor(e) + 1) + "'";
  if (e < 50) return "45+'";
  if (e < 63) return 'HT';
  if (e < 108) return '≈' + Math.min(90, 46 + Math.floor(e - 63)) + "'";
  return "90+'";
}
function tickClocks() {
  for (const el of document.querySelectorAll('.match-min[data-k]')) {
    const t = matchMinute(el.dataset.k);
    if (el.textContent !== t) el.textContent = t;
  }
}

// 3) live score polling — static /data/live.json, 60s + jitter, only on pages
// that opted in AND only when a match could plausibly be live (±3h window).
if (document.body.hasAttribute('data-live')) {
  const banner = document.getElementById('stale-banner'); // unobtrusive footer note
  const tick = async () => {
    try {
      const res = await fetch('/data/live.json', { cache: 'no-cache' });
      const live = await res.json();
      if (banner) {
        const ageMin = (Date.now() - new Date(live.as_of).getTime()) / 60000;
        const anyLive = live.matches.some((m) => m.status === 'in_play');
        banner.hidden = !(anyLive && ageMin > 10);
        const asof = document.getElementById('stale-asof');
        if (asof) asof.textContent = new Date(live.as_of).toLocaleTimeString();
      }
      for (const m of live.matches) {
        if (!m.score || m.status === 'scheduled') continue;
        // goal detection: emit g26:goal on a live score increment — never on the
        // first observed value (no replay on load), never on a revert (decrease = no emit).
        const prevG = tickClocks._g || (tickClocks._g = {});
        const was = prevG[m.n];
        if (was && m.status === 'in_play') {
          const side = m.score.home > was.h ? 'home' : m.score.away > was.a ? 'away' : null;
          if (side) document.dispatchEvent(new CustomEvent('g26:goal', { detail: {
            n: m.n, side,
            teamGoals: side === 'home' ? m.score.home : m.score.away,
            goalDiff: Math.abs(m.score.home - m.score.away),
          } }));
        }
        prevG[m.n] = { h: m.score.home, a: m.score.away };
        // idempotent, structure-stable write: [data-match] containers hold ONLY the
        // time/score cluster, so replacing el.innerHTML wholesale is safe on every tick
        // and on baked mid-match pages alike — no nested re-injection.
        const html = '<span class="score">' + m.score.home + '&nbsp;:&nbsp;' + m.score.away + '</span>' +
          (m.status === 'finished_provisional' ? ' <span class="pill warn">FT (provisional)</span>' :
           m.status === 'in_play' ? ' <span class="pill live"><span class="match-min" data-k="' + (m.k || '') + '">' + matchMinute(m.k) + '</span></span>' :
           m.status === 'finished_confirmed' ? ' <span class="pill ft">FT ✓</span>' :
           ' <span class="pill warn">' + m.status.replace(/_/g, ' ') + '</span>'); // suspended/postponed: honest neutral label
        for (const el of document.querySelectorAll('[data-match="' + m.n + '"]')) {
          if (el.innerHTML !== html) el.innerHTML = html;
          const host = el.closest('.mcard, .cluster');
          if (host) {
            if (m.status === 'in_play') host.dataset.state = 'live';
            else if (m.status === 'finished_provisional' || m.status === 'finished_confirmed') host.dataset.state = 'ft';
            else delete host.dataset.state; // unknown status: no register claim
            const bar = host.querySelector('.cl-bar');
            if (bar) bar.textContent = m.status === 'in_play'
              ? 'LIVE · SCORE AS OF ' + new Date(live.as_of).toLocaleTimeString()
              : m.status === 'finished_provisional' ? 'FULL TIME — PROVISIONAL'
              : m.status === 'finished_confirmed' ? 'FULL TIME ✓ CONFIRMED'
              : m.status.replace(/_/g, ' ').toUpperCase() + ' — SCORE AS OF ' + new Date(live.as_of).toLocaleTimeString();
          }
        }
      }
    } catch (e) { /* network hiccup: keep last render */ }
    setTimeout(tick, 60000 + Math.random() * 10000);
  };
  // only start polling within the tournament window
  const t0 = Date.parse('2026-06-11T00:00:00Z'), t1 = Date.parse('2026-07-20T12:00:00Z');
  if (Date.now() > t0 - 6 * 3600e3 && Date.now() < t1) tick();
}
// fill any baked-in-play minute placeholders immediately, then tick every second
// (cheap: just rewrites short text in existing .match-min spans, no fetch)
tickClocks();
// only arm the 1s ticker on pages with a live-minute element (or that may inject
// one via the poller) — most of the ~1,375 baked pages are static and need none
if (document.querySelector('.match-min[data-k]') || document.body.hasAttribute('data-live'))
  setInterval(tickClocks, 1000);

// 4) photo lightbox with full attribution — required at detail size.
// dialog semantics + focus moves to Close on open and returns to the opener on close.
let lbOpener = null;
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a.pic');
  if (!a) return;
  ev.preventDefault();
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.innerHTML = '<div class="lb-inner" role="dialog" aria-modal="true"><img alt=""><p class="lb-attr"></p><button class="lb-close" aria-label="Close">×</button></div>';
    const close = () => { lb.hidden = true; if (lbOpener) { lbOpener.focus(); lbOpener = null; } };
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target.classList.contains('lb-close')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lb.hidden) close(); });
    lb.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || lb.hidden) return;
      const f = lb.querySelectorAll('button, a[href]');
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    });
    document.body.appendChild(lb);
  }
  lbOpener = a;
  lb.querySelector('.lb-inner').setAttribute('aria-label', 'Photo: ' + a.dataset.name);
  lb.querySelector('img').src = a.getAttribute('href');
  lb.querySelector('img').alt = a.dataset.name;
  // SECURITY (stored DOM-XSS): build attribution with textContent + createElement —
  // never innerHTML — and validate link schemes, so author/license/url data can never inject
  // markup or a javascript:/data: URL even if a manifest value is malicious.
  const safeHttp = (u) => { try { const x = new URL(u, location.origin); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : '#'; } catch { return '#'; } };
  const mkLink = (href, text) => { const el = document.createElement('a'); el.href = safeHttp(href); el.rel = 'noopener'; el.textContent = text; return el; };
  const attr = lb.querySelector('.lb-attr');
  attr.replaceChildren(
    document.createTextNode(a.dataset.name + ' — photo by ' + (a.dataset.author || 'see file page') + ' · '),
    mkLink(a.dataset.licenseUrl || a.dataset.page, a.dataset.license || 'license'),
    document.createTextNode(' · '),
    mkLink(a.dataset.page, 'original on Wikimedia Commons'),
    document.createTextNode(' · resized'),
  );
  lb.hidden = false;
  lb.querySelector('.lb-close').focus();
});

// 5) theme toggle: System -> Light -> Dark (persisted; default = follow device)
const themeBtn = document.getElementById('theme-btn');
if (themeBtn) {
  const LABELS = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };
  const current = () => localStorage.getItem('theme') || 'system';
  const render = () => { themeBtn.textContent = LABELS[current()]; };
  themeBtn.addEventListener('click', () => {
    const next = { system: 'light', light: 'dark', dark: 'system' }[current()];
    if (next === 'system') { localStorage.removeItem('theme'); delete document.documentElement.dataset.theme; }
    else { localStorage.setItem('theme', next); document.documentElement.dataset.theme = next; }
    render();
  });
  render();
}

// 6) card-shine contrast picker (persisted; 'auto' = my defaults, light 8 / dark 5)
const contrastSel = document.getElementById('contrast-sel');
if (contrastSel) {
  const TOP = [6, 9, 13, 18, 24, 31, 39, 48, 58, 70], BD = [22, 29, 36, 44, 52, 60, 68, 76, 84, 92];
  const apply = (v) => {
    const d = document.documentElement, i = +v - 1;
    if (v && TOP[i] != null) { d.style.setProperty('--shine-top', TOP[i] + '%'); d.style.setProperty('--shine-bd', BD[i] + '%'); }
    else { d.style.removeProperty('--shine-top'); d.style.removeProperty('--shine-bd'); }
  };
  contrastSel.value = localStorage.getItem('contrast') || '';
  contrastSel.addEventListener('change', () => {
    const v = contrastSel.value;
    if (v) localStorage.setItem('contrast', v); else localStorage.removeItem('contrast');
    apply(v);
  });
}
