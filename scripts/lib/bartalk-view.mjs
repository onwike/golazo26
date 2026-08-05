// Shared Bar Talk renderer — build.mjs bakes shells with it; site/bartalk.js hydrates with it
// (served as /bartalk-view.mjs). Pure + import-free so it runs in Node + the browser and is
// node-testable. One renderer → baked + hydrated shells never drift.
export const BARTALK_NAMES = { grok: 'Grok', claude: 'Claude', gemini: 'Gemini', gpt: 'ChatGPT' };

// API base for Bar Talk fetches ONLY. On dev the bake sets __G26_BARTALK_API__ to the dev data
// worker (golazo26-data-dev) so episodes preview on dev WITHOUT touching prod.
export const bartalkApiBase = (g = globalThis) =>
  g.__G26_BARTALK_API__ || g.__G26_API__ || 'https://golazo26-data.onwike.workers.dev';

export const escBT = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Accent color CSS vars per persona (defined in styles.css bt-redesign block).
export const PERSONA_ACCENT = {
  grok:   'var(--bt-grok)',
  claude: 'var(--bt-claude)',
  gemini: 'var(--bt-gemini)',
  gpt:    'var(--bt-gpt)',
};

// One teaser slot: [persona art-chip + name] + the line.
export const bartalkSlotHTML = (s, esc = escBT) => {
  const name    = BARTALK_NAMES[s.provider] || s.speaker || '';
  const initial = (BARTALK_NAMES[s.provider] || s.speaker || '?').slice(0, 1);
  // Attribution pill (the maintainer pick C, 2026-07-03): a leading "M<match_no>" chip that deep-links to the
  // full episode (/bar-talk#ep-<episode_no>). Gated on BOTH fields; the href is built from episode_no
  // (never a trusted payload href), match_no is escaped. Absent fields → no pill (older payload / graceful).
  const pill = (s.match_no != null && s.episode_no != null)
    ? `<a class="bt-src" href="/bar-talk#ep-${encodeURIComponent(s.episode_no)}" aria-label="Bar Talk from match ${esc(String(s.match_no))}">M${esc(String(s.match_no))}</a>`
    : '';
  return `<li class="bt-slot">${pill}<span class="bt-persona" data-provider="${esc(s.provider)}">` +
    `<span class="bt-art" aria-hidden="true">${esc(initial)}</span>` +
    `<span class="bt-name">${esc(name)}</span></span>` +
    `<span class="bt-line">${esc(s.line)}</span></li>`;
};

// ── Redesign renderers ────────────────────────────────────────────────────────

// Avatar <img> tag — /personas/<provider>.webp; graceful initial-chip fallback on error.
export const bartalkAvatarHTML = (provider, size = 56, esc = escBT) => {
  const name = BARTALK_NAMES[provider] || provider;
  const init = esc(name.slice(0, 1));
  return `<img class="bt-avatar" src="/personas/${esc(provider)}.webp" ` +
    `width="${size}" height="${size}" alt="${esc(name)}" loading="lazy" decoding="async" ` +
    `onerror="this.replaceWith(Object.assign(document.createElement('span'),` +
    `{className:'bt-art bt-avatar-fallback',textContent:'${init}'}))">`;
};

// One turn in a full episode: speech bubble, action beat, or ambient line.
// turn = { seq, actor: 'grok'|'claude'|'gemini'|'gpt'|null, type: 'speech'|'action'|'ambient', text }
// esc defaults to escBT; guard against Array.map passing index as 2nd arg.
export const bartalkTurnHTML = (turn, esc = escBT) => {
  if (typeof esc !== 'function') esc = escBT;
  const { type, actor, text } = turn;
  const safeText = esc(text ?? '');
  if (type === 'speech') {
    const name  = actor ? (BARTALK_NAMES[actor] || actor) : '';
    const acVar = actor ? (PERSONA_ACCENT[actor] || 'var(--muted)') : 'var(--muted)';
    return `<div class="bt-bubble" data-actor="${esc(actor || '')}" style="--bt-accent:${acVar}">` +
      `<div class="bt-bubble-head">` +
      (actor ? bartalkAvatarHTML(actor, 28, esc) : '') +
      `<span class="bt-bubble-name" style="color:${acVar}">${esc(name)}</span>` +
      `</div>` +
      `<p class="bt-bubble-text">${safeText}</p>` +
      `</div>`;
  }
  if (type === 'action') {
    const name  = actor ? (BARTALK_NAMES[actor] || actor) : '';
    const acVar = actor ? (PERSONA_ACCENT[actor] || 'var(--muted)') : 'var(--muted)';
    return `<div class="bt-beat" data-actor="${esc(actor || '')}">` +
      `<span class="bt-beat-rule"></span>` +
      `<span class="bt-beat-text">` +
      (actor ? `<span class="bt-beat-actor" style="color:${acVar}">${esc(name)}</span> ` : '') +
      `<em>${safeText}</em>` +
      `</span>` +
      `<span class="bt-beat-rule"></span>` +
      `</div>`;
  }
  // ambient — no actor, centered, full-width
  return `<div class="bt-ambient"><em>${safeText}</em></div>`;
};

// Wavy flag-clash SVG — two flag sprites with feTurbulence wave + VS impact burst.
// slug1/slug2 = team slugs for the /brand/flags.svg sprite (#f-{slug}); empty = placeholder rect.
// size: 'sm' (guide thumb, 72×40) | 'lg' (episode header, 340×120)
export const bartalkFlagClashSVG = (slug1, slug2, label1, label2, size = 'sm', esc = escBT) => {
  const SPRITE = '/brand/flags.svg?v=4';
  const isLg   = size === 'lg';
  const W      = isLg ? 340 : 72;
  const H      = isLg ? 120 : 40;
  const flagW  = isLg ? 76  : 20;
  const flagH  = isLg ? 76  : 20;
  const filtId = `btw${isLg ? 'L' : 'S'}`;
  const scale  = isLg ? 5 : 2.5;
  const freq   = isLg ? '0.04 0.06' : '0.06 0.08';
  const cx = W / 2;
  const fy = (H - flagH) / 2;
  // flag positions: home left of center, away right
  const f1x = isLg ? cx - 110 : cx - 24;
  const f2x = isLg ? cx + 34  : cx + 4;
  // VS burst star (8-point)
  const r1 = isLg ? 20 : 7, r2 = isLg ? 11 : 4, N = 8, vsY = H / 2;
  let burst = '';
  for (let i = 0; i < N * 2; i++) {
    const angle = (Math.PI / N) * i - Math.PI / 2;
    const r = i % 2 === 0 ? r1 : r2;
    burst += `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(angle) * r).toFixed(1)},${(vsY + Math.sin(angle) * r).toFixed(1)}`;
  }
  burst += 'Z';

  return `<svg class="bt-clash bt-clash-${size}" viewBox="0 0 ${W} ${H}" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-label="${esc(label1)} vs ${esc(label2)}">` +
    `<defs>` +
    `<filter id="${filtId}" x="-20%" y="-30%" width="140%" height="160%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="7" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>` +
    `</defs>` +
    // speed lines (lg only)
    (isLg
      ? `<g stroke="var(--line)" stroke-width="0.8" opacity="0.4">${
          [-70,-55,-40,40,55,70].map(deg => {
            const rad = deg * Math.PI / 180;
            return `<line x1="${cx}" y1="${vsY}" x2="${(cx + Math.cos(rad)*160).toFixed(0)}" y2="${(vsY + Math.sin(rad)*90).toFixed(0)}"/>`;
          }).join('')
        }</g>`
      : '') +
    // home flag
    (slug1
      ? `<svg x="${f1x}" y="${fy}" width="${flagW}" height="${flagH}" viewBox="0 0 36 36" filter="url(#${filtId})">` +
        `<use href="${SPRITE}#f-${esc(slug1)}"/></svg>`
      : `<rect x="${f1x}" y="${fy}" width="${flagW}" height="${flagH}" rx="2" fill="var(--line)" filter="url(#${filtId})"/>`) +
    // away flag
    (slug2
      ? `<svg x="${f2x}" y="${fy}" width="${flagW}" height="${flagH}" viewBox="0 0 36 36" filter="url(#${filtId})">` +
        `<use href="${SPRITE}#f-${esc(slug2)}"/></svg>`
      : `<rect x="${f2x}" y="${fy}" width="${flagW}" height="${flagH}" rx="2" fill="var(--line)" filter="url(#${filtId})"/>`) +
    // impact burst
    `<path d="${burst}" fill="var(--bt-burst)" opacity="0.88"/>` +
    // VS label
    `<text x="${cx}" y="${vsY + (isLg ? 5 : 2.5)}" text-anchor="middle" dominant-baseline="middle" ` +
    `font-family="'Barlow Condensed',sans-serif" font-weight="900" ` +
    `font-size="${isLg ? 12 : 5.5}" fill="var(--ink)" letter-spacing="0.06em">VS</text>` +
    `</svg>`;
};

// Stage filter predicates — exact match against the actual stage values in data/matches.json
// ('group','r32','r16','qf','sf','third','final'). Exported for node-testable unit coverage.
export const STAGE_FILTER = {
  all:     () => true,
  group:   (ep) => ep.stage === 'group',
  r16:     (ep) => ep.stage === 'r32' || ep.stage === 'r16',
  'qf-sf': (ep) => ep.stage === 'qf'  || ep.stage === 'sf',
  final:   (ep) => ep.stage === 'final' || ep.stage === 'third',
};

// One guide rail row: flag-clash thumb + fixture info + synopsis.
// ep = { match_no, episode_no, home, away, home_score, away_score, stage, synopsis }
// teamToSlug = (teamName: string) => slug: string
export const bartalkGuideRowHTML = (ep, teamToSlug = () => '', esc = escBT) => {
  const h   = ep.home  || '';
  const a   = ep.away  || '';
  const hs  = teamToSlug(h);
  const as_ = teamToSlug(a);
  const clash = bartalkFlagClashSVG(hs, as_, h, a, 'sm', esc);
  const score = (ep.home_score != null && ep.away_score != null)
    ? `<span class="bt-gr-score">${esc(String(ep.home_score))}–${esc(String(ep.away_score))}</span>` : '';
  const stage = ep.stage
    ? `<span class="bt-gr-stage">${esc(ep.stage)}</span>` : '';
  const synopsis = ep.synopsis
    ? `<p class="bt-gr-syn">${esc(ep.synopsis)}</p>` : '';
  const label = h && a ? `${esc(h)} vs ${esc(a)}` : `Episode ${esc(String(ep.episode_no ?? ep.match_no))}`;
  return `<button type="button" class="bt-gr" data-match="${esc(String(ep.match_no))}" ` +
    `aria-label="Load episode: ${label}">` +
    `<span class="bt-gr-thumb">${clash}</span>` +
    `<span class="bt-gr-info">` +
    `<span class="bt-gr-teams">${h && a
      ? `${esc(h)} <span class="bt-gr-vs">v</span> ${esc(a)}`
      : `Ep ${esc(String(ep.episode_no ?? ep.match_no))}`
    }</span>` +
    `<span class="bt-gr-meta">${stage}${score}</span>` +
    synopsis +
    `</span>` +
    `</button>`;
};

// Episode header: dramatic flag-clash banner + fixture/score/stage.
export const bartalkEpisodeHeaderHTML = (ep, teamToSlug = () => '', esc = escBT) => {
  const h   = ep.home  || '';
  const a   = ep.away  || '';
  const hs  = teamToSlug(h);
  const as_ = teamToSlug(a);
  const clash = bartalkFlagClashSVG(hs, as_, h, a, 'lg', esc);
  const score = (ep.home_score != null && ep.away_score != null)
    ? ` <span class="bt-ep-score">${esc(String(ep.home_score))} – ${esc(String(ep.away_score))}</span>` : '';
  const stage = ep.stage ? ` <span class="bt-ep-stage">${esc(ep.stage)}</span>` : '';
  const title = h && a
    ? `<strong>${esc(h)}</strong> <span class="bt-ep-vs">vs</span> <strong>${esc(a)}</strong>`
    : `Episode ${esc(String(ep.episode_no ?? ep.match_no))}`;
  return `<div class="bt-ep-header">` +
    `<div class="bt-ep-clash">${clash}</div>` +
    `<div class="bt-ep-fix">${title}${score}${stage}</div>` +
    `</div>`;
};

// Legacy hub episode card — still used by match-page bartalk sections.
export const bartalkEpisodeCardHTML = (ep, bodyHTML = '', esc = escBT) =>
  `<article class="bt-episode" id="ep-${esc(String(ep.match_no))}">` +
  `<h2 class="bt-ep-h">Episode ${esc(String(ep.episode_no))} <a class="muted" href="/matches/${esc(String(ep.match_no))}">match ${esc(String(ep.match_no))} →</a></h2>` +
  `<div class="bt-ep-body">${bodyHTML}</div></article>`;
