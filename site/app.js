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

// 1) visitor-local kickoff times — idempotent + re-invocable (i18n re-enhancement contract,
// v3.14 a later change): the ORIGINAL baked ET text lives in el.title (the same slot the old one-shot
// pass used, so the en/unset output stays byte-identical to the old behavior) and every run
// recomputes from data-utc + that stored original — re-running on an i18n-swapped subtree can
// never nest wrappers. data-lang ≠ en runs REGARDLESS of visitor timezone and formats with the
// mapped SITE locale (tw→ak: ICU carries Akan, not Twi); en/unset keeps the old behavior — ET
// visitors keep the baked ET text, everyone else gets browser-locale local time + ET original.
const I18N_LOCALES = { es: 'es', fr: 'fr', de: 'de', ig: 'ig', tw: 'ak' };
function localizeKickoffTimes(root) {
  const lang = document.documentElement.dataset.lang;
  const locale = I18N_LOCALES[lang]; // undefined for en/unset → browser locale + the old ET skip
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!locale && tz === 'America/New_York') {
    // en/unset for an ET visitor: the baked ET text is already right — undo any prior lang pass
    for (const el of root.querySelectorAll('.local-time[data-utc]')) {
      if (el.title) { el.textContent = el.title; el.removeAttribute('title'); }
    }
    return;
  }
  const fmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  for (const el of root.querySelectorAll('.local-time[data-utc]')) {
    const orig = el.title || el.textContent;
    el.title = orig;
    el.textContent = fmt.format(new Date(el.dataset.utc)) + ' (' + orig + ')';
  }
}
localizeKickoffTimes(document); // app.js is deferred, so this IS the DOMContentLoaded pass
document.addEventListener('g26:lang', () => localizeKickoffTimes(document)); // re-enhance swapped subtrees
// (a later review round): a client re-render (today.js's async home-card render lands AFTER the
// synchronous g26:lang pass above, and again on initial load) replaces .local-time nodes with fresh
// raw-ET cards this never re-localized. today.js fires g26:rerender after each render so we re-enhance
// the new subtree; distinct from g26:lang (today.js listens to that — re-firing it would self-loop).
document.addEventListener('g26:rerender', () => localizeKickoffTimes(document));

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
// ESPN's REAL clock (dc, e.g. "47'"), observed at the bake's as_of and ticked forward.
// Anchored to ESPN's actual minute so it can't drift when a match kicks off late (the
// scheduled-kickoff estimate above was ~8 min off once). Stoppage/HT shown verbatim.
function liveMin(dc, asofMs) {
  if (!dc) return null;
  if (/half|^ht$/i.test(dc)) return 'HT';
  if (dc.indexOf('+') >= 0) return dc.replace(/\s/g, ''); // stoppage ("90'+5'"): show ESPN's value as-is
  const m = /^(\d+)/.exec(dc);
  if (!m) return dc;
  const base = +m[1];
  const ticked = base + Math.max(0, Math.floor((Date.now() - asofMs) / 60000));
  if (base < 45 && ticked >= 45) return "45+'";
  if (base < 90 && ticked >= 90) return "90+'";
  return ticked + "'";
}
// SECURITY (cert SIG-1, defense-in-depth): the score-tick below assigns el.innerHTML from a
// string that interpolates remote /api/v1/live fields (m.status, m.k, m.dc). It's mitigated
// upstream (D1 status CHECK-enum + poll-side displayClock allowlist), so this is not an open
// XSS — but the identity-heal path already keeps textContent-only discipline and this path
// didn't. esc() applies the same escape the bakers use (render.mjs) to any remote field before
// it enters the innerHTML string, so a malformed field can never inject markup. Mirrors
// render.mjs's esc exactly (app.js has no build-time import).
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function tickClocks() {
  for (const el of document.querySelectorAll('.match-min[data-k]')) {
    const t = el.dataset.dc ? liveMin(el.dataset.dc, +el.dataset.asof) : matchMinute(el.dataset.k);
    if (el.textContent !== t) el.textContent = t;
  }
}

// v3.08.02 / v3.09.01 — self-heal a baked knockout placeholder leaf to a live-resolved team name.
// `container[data-match-teams=N]` holds a placeholder leaf `.tbd[data-side=home|away]` — the DOM the
// bakers emit (scripts/lib/render.mjs sideHTML uses `.team.tbd`; the front-page bracket / Today strip /
// static /standings bracket / match-page h1 mark up their own leaf spans the same way). The match is
// keyed on `.tbd[data-side]` (NOT `.team.tbd`) so all five surfaces share ONE heal path without forcing
// the `.team` class onto spans that must not inherit its styling. Only a `.tbd` placeholder is rewritten,
// only when `name` is a non-empty resolved identity, and only via textContent — so a real (already-
// resolved) leaf and its flag-chip/link survive, and there is no HTML-injection surface. Idempotent:
// once the class is dropped the leaf is no longer `.tbd`, so subsequent ticks skip it.
function healIdentity(side, name, n) {
  if (!name) return; // payload carries no resolved name for this side → baked placeholder is still truth
  for (const c of document.querySelectorAll('[data-match-teams="' + n + '"]')) {
    for (const leaf of c.querySelectorAll('.tbd[data-side="' + side + '"]')) {
      if (leaf.textContent !== name) { leaf.textContent = name; leaf.classList.remove('tbd'); }
    }
  }
}

// 3) live score polling — static /data/live.json, 60s + jitter, only on pages
// that opted in AND only when a match could plausibly be live (±3h window).
if (document.body.hasAttribute('data-live')) {
  const banner = document.getElementById('stale-banner'); // unobtrusive footer note
  // v3 dynamic delivery: prefer the live data API (scores update with no rebuild);
  // fall back to the baked static snapshot so a cutover — or a worker hiccup / the
  // 100k/day cap — never breaks the page. Same {as_of, matches:[…]} shape either way.
  const API = self.__G26_API__ || 'https://golazo26-data.onwike.workers.dev';
  // cert SIG-7 (Silver code-review): show a visible staleness signal whenever the displayed
  // scores are NOT current. Two triggers: (a) the live API failed and we're serving the baked
  // /data/live.json snapshot (up to ~24h old — the exact CRIT-2 cron-outage scenario), OR (b)
  // live.as_of is > STALE_MIN old while a match is in_play. STALE_MIN=5: the architecture's own
  // worst-case freshness bound is ~4–5 min (upstream ESPN poll ~1–3 min + our ~60s tick, additive),
  // so >5 min during an active match means the pipeline is genuinely behind, not mid-cycle jitter.
  const STALE_MIN = 5;
  const fetchLive = async () => {
    try { const r = await fetch(API + '/api/v1/live', { cache: 'no-cache' }); if (r.ok) { const j = await r.json(); j._fellBack = false; return j; } } catch (e) { /* fall through */ }
    const r = await fetch('/data/live.json', { cache: 'no-cache' }); // baked static snapshot (SIG-7 trigger a)
    const j = await r.json();
    j._fellBack = true;
    return j;
  };
  const tick = async () => {
    try {
      const live = await fetchLive();
      if (banner) {
        const ageMin = (Date.now() - new Date(live.as_of).getTime()) / 60000;
        const anyLive = live.matches.some((m) => m.status === 'in_play');
        // (a) serving the baked fallback → always signal (the live feed is down); (b) as_of stale during an active match.
        banner.hidden = !(live._fellBack || (anyLive && ageMin > STALE_MIN));
        const asof = document.getElementById('stale-asof');
        if (asof) asof.textContent = new Date(live.as_of).toLocaleTimeString();
      }
      for (const m of live.matches) {
        // v3.08.02 — knockout identity self-heal (runs BEFORE the score gate below: identity
        // resolves while a match is still `scheduled`). Rewrite a baked "Winner Match N"
        // placeholder from the live payload's resolved team name so the page corrects on the
        // 60s tick without a rebake, mirroring the certified score path. Guards:
        //  - only act when the payload actually carries a resolved name for that side (else the
        //    baked placeholder is still the truth — never blank a real slot);
        //  - only overwrite a `.team.tbd` placeholder leaf (a resolved leaf is left untouched, so
        //    the next bake's flag-chip + /teams/ link are never clobbered by this text-only heal);
        //  - textContent only (no innerHTML) → zero XSS surface even though names are trusted.
        healIdentity('home', m.home, m.n);
        healIdentity('away', m.away, m.n);
        // v3.09.01 — match-page <title> heal. A <title> has no child leaf to rewrite via healIdentity,
        // so on the match page (its unique `h1.matchup[data-match-teams=N]` identifies which match this
        // page is) set document.title from the resolved names once BOTH sides are known. Guarded on both
        // names present so a half-resolved knockout tie ("Brazil vs Winner Match 77") never mislabels the
        // tab; leaves the baked "Match N: … vs …" title untouched until identity fully resolves.
        if (m.home && m.away) {
          const h1 = document.querySelector('h1.matchup[data-match-teams="' + m.n + '"]');
          if (h1) { const t = m.home + ' vs ' + m.away + ' · Golazo 26'; if (document.title !== t) document.title = t; }
        }
        // Bracket Monument B1 — today-green on the bracket leaf, computed CLIENT-SIDE (a baked
        // is-today class would rot at ET midnight: the bake is content-triggered, not daily).
        // Runs BEFORE the scheduled/score skip below so it covers EVERY status on every tick —
        // incl. bk-live (an internal review NEW-1: keying B2 on status, not score, so a just-kicked-off
        // in_play match with a null 0-0 score still glows immediately, not a tick late). B3
        // precedence: in_play → bk-live, scheduled+today → bk-today, mutually exclusive by status.
        // Class-only + idempotent; leaves that aren't .bbox (e.g. .tchip) simply don't match.
        if (m.k) {
          const etDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
          const isToday = m.status === 'scheduled' && etDay(m.k) === etDay(Date.now());
          const isLive = m.status === 'in_play';
          for (const b of document.querySelectorAll('.bbox[data-mno="' + m.n + '"]')) {
            b.classList.toggle('bk-live', isLive);
            b.classList.toggle('bk-today', isToday);
          }
        }
        if (!m.score || m.status === 'scheduled') continue;
        // goal detection (v2.06.00): emit g26:goal on a live score increment — never on the
        // first observed value (no replay on load), never on a revert (decrease = no emit).
        const prevG = tickClocks._g || (tickClocks._g = {});
        const was = prevG[m.n];
        if (was && m.status === 'in_play') {
          const side = m.score.home > was.h ? 'home' : m.score.away > was.a ? 'away' : null;
          if (side) document.dispatchEvent(new CustomEvent('g26:goal', { detail: {
            n: m.n, side,
            teamGoals: side === 'home' ? m.score.home : m.score.away,
            goalDiff: Math.abs(m.score.home - m.score.away),
            score: { home: m.score.home, away: m.score.away }, // for the site-wide goal-celebration ticker (pure g26:goal consumer)
          } }));
        }
        prevG[m.n] = { h: m.score.home, a: m.score.away };
        // idempotent, structure-stable write (cert v2.00.00 C1): [data-match] containers
        // hold ONLY the time/score cluster, so replacing el.innerHTML wholesale is safe on
        // every tick and on baker-baked mid-match pages alike — no nested re-injection.
        // remote fields (m.status/m.k/m.dc) are esc()'d before entering this innerHTML string (SIG-1);
        // liveMin/matchMinute returns are esc()'d too since they carry m.dc through verbatim.
        const html = '<span class="score">' + m.score.home + '&nbsp;:&nbsp;' + m.score.away + '</span>' +
          (m.status === 'in_play' ? ' <span class="pill live"><span class="match-min" data-k="' + esc(m.k || '') + '"' + (m.dc ? ' data-dc="' + esc(m.dc) + '" data-asof="' + new Date(live.as_of).getTime() + '"' : '') + '">' + esc(m.dc ? liveMin(m.dc, new Date(live.as_of).getTime()) : matchMinute(m.k)) + '</span></span>' :
           (m.status === 'finished_provisional' || m.status === 'finished_confirmed') ? ' <span class="pill ft">FT ✓</span>' :
           ' <span class="pill warn">' + esc(m.status.replace(/_/g, ' ')) + '</span>') + // suspended/postponed: honest neutral label
          (m.so ? ' <span class="pens">' + m.so.home + '–' + m.so.away + '&nbsp;pens</span>' : (m.aet ? ' <span class="pens">aet</span>' : '')); // penalty-shootout / AET badge (migrations 0021/0022) — MUST stay byte-identical to render.mjs scoreHTML (cert OM2: baked == injected)
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
              : (m.status === 'finished_provisional' || m.status === 'finished_confirmed') ? 'FULL TIME ✓'
              : m.status.replace(/_/g, ' ').toUpperCase() + ' — SCORE AS OF ' + new Date(live.as_of).toLocaleTimeString();
          }
          // (Bracket Monument B2 bk-live toggle moved UP, before the score gate — an internal review NEW-1,
          // so a scoreless just-kicked-off in_play match glows immediately. See the bk-today/bk-live
          // block above.)
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

// 4) photo lightbox with full attribution (Phase 2.5A) — required at detail size.
// v2.00.00 (cert M7): dialog semantics + focus moves to Close on open, returns on close.
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
  // SECURITY (cert MEDIUM, stored DOM-XSS): build attribution with textContent + createElement —
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

// 6) card-shine contrast picker (persisted; 'auto' = owner default light 8 / dark 5)
// Hidden from public view (CSS display:none). The owner reveals it for visual debugging with
// ?contrast (sticky in localStorage across pages); ?contrast=off hides it again. Saved values
// still apply on every page (pre-paint script + apply() below) regardless of visibility.
const contrastSel = document.getElementById('contrast-sel');
if (contrastSel) {
  const cdbg = new URLSearchParams(location.search).get('contrast');
  if (cdbg === 'off') localStorage.removeItem('contrast-debug');
  else if (cdbg !== null) localStorage.setItem('contrast-debug', '1');
  if (localStorage.getItem('contrast-debug') === '1') document.documentElement.setAttribute('data-cdbg', '');
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
