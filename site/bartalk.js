// Bar Talk hub hydrator — redesign (feat/bartalk-redesign).
// Left: scrollable episode guide rail (index endpoint, all episodes).
// Right: selected episode reading column (per-episode turns endpoint, lazy).
// Degrades gracefully: synopsis/turns null → falls back to body_md + plain header.
import {
  bartalkGuideRowHTML, bartalkEpisodeHeaderHTML, bartalkTurnHTML,
  bartalkApiBase, escBT as esc, STAGE_FILTER,
} from '/bartalk-view.mjs';
import { mdLite } from '/render.mjs';

const API       = bartalkApiBase();
const guide     = document.querySelector('[data-bt-guide]');
const reading   = document.querySelector('[data-bt-reading]');
const filterNav = document.querySelector('[data-bt-filter]');

if (!guide || !reading) { /* not the redesign page */ throw new Error('bt-redesign: no mounts'); }

// Team name → slug map baked into the page as window.__BT_TEAMS__ = { "Spain": "spain", ... }
const teamToSlug = (name) => (typeof __BT_TEAMS__ !== 'undefined' ? __BT_TEAMS__[name] : null) || '';
/* global __BT_TEAMS__ */

// i18n: current non-English site language (site/i18n.js sets data-lang pre-paint) →
// &lang= on the bar-talk endpoint (transcripts translated server-side, per-episode EN fallback).
const i18nLang = () => { const l = document.documentElement.dataset.lang; return l && l !== 'en' ? l : null; };
const langQS = () => { const l = i18nLang(); return l ? `&lang=${l}` : ''; };

// ── Guide index ───────────────────────────────────────────────────────────────
let allEpisodes = [];      // all loaded episodes
let activeMatch = null;    // currently selected match_no
let activeFilter = 'all';  // 'all' | 'group' | 'r16' | 'qf-sf' | 'final'

function renderGuide(episodes) {
  const list = guide.querySelector('[data-bt-list]');
  if (!list) return;
  const visible = episodes.filter(STAGE_FILTER[activeFilter] || STAGE_FILTER.all);
  if (!visible.length) {
    list.innerHTML = '<p class="bt-guide-empty">No episodes yet for this stage.</p>';
    return;
  }
  list.innerHTML = visible.map((ep) => bartalkGuideRowHTML(ep, teamToSlug)).join('');
  list.querySelectorAll('.bt-gr').forEach((btn) => {
    if (btn.dataset.match === String(activeMatch)) btn.classList.add('is-active');
    btn.addEventListener('click', () => selectEpisode(Number(btn.dataset.match)));
  });
}

async function loadGuide() {
  guide.querySelector('[data-bt-list]').innerHTML = skeletonRows(8);
  try {
    // Fetch all pages (hub returns 5/page by default; use page=-1 or accumulate).
    // The endpoint supports ?page=N; we loop until has_more=false.
    let page = 0, eps = [];
    while (true) {
      const r = await fetch(`${API}/api/v1/bar-talk?page=${page}${langQS()}`, { cache: 'no-cache' });
      if (!r.ok) break;
      const d = await r.json();
      if (!d?.episodes?.length) break;
      eps = eps.concat(d.episodes);
      if (!d.has_more) break;
      page++;
    }
    allEpisodes = eps;
    renderGuide(allEpisodes);
    // Auto-select: hash (#ep-N) or first episode
    const hashMatch = (location.hash || '').match(/ep-(\d+)/);
    const first = hashMatch ? Number(hashMatch[1]) : allEpisodes[0]?.match_no;
    if (first) selectEpisode(first);
  } catch { guide.querySelector('[data-bt-list]').innerHTML = '<p class="bt-guide-empty muted">Could not load episodes.</p>'; }
}

// ── Episode reading column ────────────────────────────────────────────────────
async function selectEpisode(matchNo) {
  if (activeMatch === matchNo) return;
  activeMatch = matchNo;
  // Update active state in the rail
  guide.querySelectorAll('.bt-gr').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.match === String(matchNo));
  });
  // Scroll guide row into view
  const activeRow = guide.querySelector(`.bt-gr[data-match="${matchNo}"]`);
  activeRow?.scrollIntoView({ block: 'nearest' });

  // Show skeleton in reading column while fetching
  reading.innerHTML = `<div class="bt-skeleton">${skeletonRows(6)}</div>`;

  try {
    const r = await fetch(`${API}/api/v1/bar-talk?n=${matchNo}${langQS()}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    renderEpisode(d.episode || d, matchNo);
  } catch {
    reading.innerHTML = '<p class="bt-reading-empty muted">Could not load episode.</p>';
  }
}

function renderEpisode(ep, matchNo) {
  // Find guide row data for the header (home/away/score/stage)
  const meta = allEpisodes.find((e) => e.match_no === matchNo) || ep;
  const header = bartalkEpisodeHeaderHTML(meta, teamToSlug);

  // Turns: structured JSON if available, else body_md fallback. When a TRANSLATION was served
  // (lang_served ≠ 'en'), prefer the translated body_md over the English structured turns —
  // the transcript is the translated reading surface (turns stay English in i18n_prose scope).
  let transcriptHTML;
  const translated = ep.lang_served && ep.lang_served !== 'en';
  if (Array.isArray(ep.turns) && ep.turns.length && !translated) {
    transcriptHTML = `<div class="bt-transcript">${ep.turns.map((t) => bartalkTurnHTML(t)).join('')}</div>`;
  } else if (ep.body_md) {
    transcriptHTML = `<div class="bt-transcript bt-transcript-md"><div class="bt-ep-body">${mdLite(ep.body_md)}</div></div>`;
  } else {
    transcriptHTML = '<p class="bt-reading-empty muted">No transcript yet.</p>';
  }

  // Poll (phase 1 shell — static, wired up in a follow-on PR)
  const pollHTML = `<div class="bt-poll">
    <p class="bt-poll-q">Who won this round?</p>
    <div class="bt-poll-opts">
      ${['Grok','Claude','Gemini','ChatGPT'].map((n) =>
        `<button type="button" class="bt-poll-btn" disabled>${esc(n)}</button>`).join('')}
    </div>
    <p class="bt-poll-note">Voting coming soon.</p>
  </div>`;

  reading.innerHTML = header + transcriptHTML + pollHTML;
}

// ── Stage filter ──────────────────────────────────────────────────────────────
if (filterNav) {
  filterNav.querySelectorAll('[data-bt-stage]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.btStage;
      filterNav.querySelectorAll('[data-bt-stage]').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderGuide(allEpisodes);
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function skeletonRows(n) {
  return Array.from({ length: n }, (_, i) =>
    `<div class="bt-skel-line${i % 3 === 2 ? ' w60' : i % 2 === 0 ? ' w80' : ''}"></div>`
  ).join('');
}

// language switch (site/i18n.js fires g26:lang after every selection): reload the guide in the new
// language and re-select the episode the reader was on (activeMatch reset forces the re-fetch;
// loadGuide's auto-select may already have re-fetched it, in which case selectEpisode no-ops).
document.addEventListener('g26:lang', () => {
  const cur = activeMatch;
  activeMatch = null;
  loadGuide().then(() => { if (cur && activeMatch !== cur) selectEpisode(cur); }).catch(() => {});
});

// Kick off
loadGuide();
