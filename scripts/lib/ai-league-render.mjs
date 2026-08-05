// ai-league-render.mjs — the ONE AI-league renderer, used by BOTH runtimes: build.mjs bakes
// the first-paint shell with it (Node import), and site/ai-league.js hydrates the live league
// with the same functions (served as /ai-league-render.mjs, browser import). One renderer, two
// runtimes — the baked page and the live overlay can never drift. Self-contained (no imports)
// so the import path resolves in both Node ('./lib/...') and the browser ('/ai-league-render.mjs').
//
// Payload shape (identical from data/ai-league.json and /api/v1/ai-league):
//   { as_of, scoring:{exact,outcome,scorer_bonus},
//     standings:[{provider,name,picks,scored,exact,outcome,scorer_bonus,pts}],
//     matches:[{match_no,home_team,away_team,kickoff_utc,status,featured,result,scorers_sourced,
//               picks:{[provider]:{home,away,depth,confidence,note,scorers?,key_players?,defense?}}}] }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NAMES = { claude: 'Claude Opus 4.8', gpt: 'ChatGPT', gemini: 'Gemini 3 Pro', grok: 'Grok 4' };
export const AI_ORDER = ['claude', 'gpt', 'gemini', 'grok'];
export const aiName = (p) => NAMES[p] ?? p;
// The official brand mark from the /brand/ai-logos.svg sprite, currentColor-tinted (theme-adaptive).
// THE single source of truth for the sprite ref — build.mjs imports this for the match-page picks table
// too, so every AI surface (standings, rail, featured cards, every-pick, match picks) shares one mark.
// Self-contained string (no DOM) so it works in both runtimes — Node bake + browser hydration.
export const aiLogo = (p) => `<svg class="ai-logo" viewBox="0 0 24 24" aria-hidden="true"><use href="/brand/ai-logos.svg#ai-${p}"/></svg>`;
// Logo + name, the label used wherever an AI is identified.
export const aiLabel = (p) => `${aiLogo(p)} ${esc(aiName(p))}`;

// Compact standings for the Today-page rail (a narrow column): a ranked list of AI + points only,
// leader highlighted. The full table lives on /ai-league.
export function aiStandingsCompact(payload) {
  const st = (payload?.standings ?? []).filter((s) => s.picks > 0);
  if (!st.length) return '<p class="muted">The live league is initializing…</p>';
  const lead = st.find((s) => s.pts > 0)?.provider ?? null;
  return `<ol class="ai-mini">${st.map((s) => `<li${s.provider === lead ? ' class="lead"' : ''}><span class="ai-mini-name">${aiLabel(s.provider)}</span><span class="ai-mini-pts">${s.pts}<small>&nbsp;pts</small></span></li>`).join('')}</ol>`;
}

export function aiStandings(payload) {
  const st = payload?.standings ?? [];
  if (!st.length) return '<p class="muted">The league is initializing — standings appear once the first picks are in.</p>';
  // an AI that has not entered yet (no picks) is shown as such, never as a ranked 0-pt competitor —
  // otherwise a provider whose API was down all round is indistinguishable from one that scored 0.
  const lead = st.find((s) => s.picks > 0 && s.pts > 0)?.provider ?? null;
  return `<div class="tablewrap2"><table class="watch ai-standings"><thead><tr><th>AI</th><th>Pts</th><th>Exact</th><th>Outcome</th><th>Scorer&nbsp;bonus</th><th>Scored</th><th>Picks</th></tr></thead><tbody>
${st.map((s) => s.picks > 0
    ? `<tr${s.provider === lead ? ' class="lead"' : ''}><th>${aiLabel(s.provider)}</th><td><strong>${s.pts}</strong></td><td>${s.exact}</td><td>${s.outcome}</td><td>${s.scorer_bonus}</td><td>${s.scored}</td><td>${s.picks}</td></tr>`
    : `<tr class="ai-noentry"><th>${aiLabel(s.provider)}</th><td colspan="6" class="muted">no picks yet — not entered this round</td></tr>`).join('')}
</tbody></table></div>`;
}

function card(provider, c) {
  const sc = (c.scorers ?? []).filter((x) => x && x.player);
  const kp = (c.key_players ?? []).filter((x) => x && x.player);
  return `<div class="ai-card">
  <div class="ai-card-h"><b>${aiLabel(provider)}</b><span class="ai-score">${c.home}–${c.away}</span>${c.confidence != null ? `<span class="ai-conf" title="confidence">${c.confidence}%</span>` : ''}</div>
  ${sc.length ? `<div class="ai-line"><span class="ai-tag">Scorers</span> ${sc.map((x) => esc(x.player) + (x.goals > 1 ? ` ×${x.goals}` : '')).join(', ')}</div>` : ''}
  ${kp.length ? `<div class="ai-line"><span class="ai-tag">Key</span> ${kp.map((x) => esc(x.player)).join(', ')}</div>` : ''}
  ${c.defense ? `<p class="ai-def">${esc(c.defense)}</p>` : ''}
</div>`;
}

export function aiFeatured(payload) {
  const feat = (payload?.matches ?? []).filter((m) => m.featured && m.status !== 'finished_confirmed');
  if (!feat.length) return '<p class="muted">No upcoming match is featured yet — in-depth picks appear before the next kickoff.</p>';
  return feat.map((m) => `<article class="ai-featured">
  <h3>${esc(m.home_team)} <span class="muted">v</span> ${esc(m.away_team)}</h3>
  <div class="ai-cards">${AI_ORDER.filter((p) => m.picks?.[p]?.depth === 'featured').map((p) => card(p, m.picks[p])).join('')}</div>
</article>`).join('');
}

export function aiEveryPick(payload) {
  const ms = payload?.matches ?? [];
  if (!ms.length) return '';
  return `<table class="watch"><thead><tr><th>Match</th>${AI_ORDER.map((p) => `<th>${aiLabel(p)}</th>`).join('')}<th>Result</th></tr></thead><tbody>
${ms.map((m) => `<tr><th><a href="/matches/${m.match_no}">${esc(m.home_team)} v ${esc(m.away_team)}</a></th>${AI_ORDER.map((p) => { const c = m.picks?.[p]; return `<td>${c ? `${c.home}–${c.away}${c.depth === 'featured' ? '<span class="ai-star" title="in-depth pick">★</span>' : ''}` : '<span class="muted">—</span>'}</td>`; }).join('')}<td>${m.result ? `<strong>${m.result.home}–${m.result.away}</strong>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
</tbody></table>`;
}
