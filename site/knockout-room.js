/* site/knockout-room.js — THE KNOCKOUT ROOM: the 3D bracket experience behind the [2D|3D] toggle.
 *
 * A faithful port of the pixel-verified museum-preview mockup (knockout-room/an earlier revision.html) + its rig lib
 * (knockout-room-lib.js). The certified 2D "Bracket Monument" stays the DEFAULT; this Room is strictly
 * opt-in behind a [2D|3D] control (owner directive 2026-07-17). On opt-in it hides .bracket-window as a
 * unit and mounts full-bleed in its place; toggle-off restores 2D instantly and disposes all GL.
 *
 * LIVE DATA: the bracket model is hydrated by PARSING THE BAKED 2D DOM (.bbox/.bbst/.bbnm/.pill) — the
 * single source of truth, zero new network fetches. app.js's 60s hydrator mutates that DOM; a debounced
 * MutationObserver re-syncs the Room. The pulse cascade animates only the RESOLVED portion of the tree.
 *
 * three is lazy-loaded from the same-origin vendored bundle (/vendor/) ONLY on first opt-in — nothing
 * here touches WebGL or fetches a GLB on the default page path.
 */

let _mods = null;
async function loadMods() {
  if (_mods) return _mods;
  const [THREE, gltf] = await Promise.all([
    import('/vendor/three.module.min.js'),
    import('/vendor/GLTFLoader.js'),
  ]);
  const lib = await import('/knockout-room-lib.js');
  _mods = { THREE, GLTFLoader: gltf.GLTFLoader, buildCauldron: lib.buildCauldron, buildTrophy: lib.buildTrophy, SHELLS: lib.SHELLS };
  return _mods;
}

/* ---- LIVE DATA: parse the baked 2D bracket DOM into the Room's fixed-cardinality model ----
 * Produces the exact array shapes the ported scene expects (12 groups / 16 R32 / 8 R16 / 4 QF / 2 SF /
 * 1 Final / 1 third), plus a per-tie STATE ('ft'|'live'|'sched'). Winner-first for decided ties (so the
 * scene's slotMap + [winner,loser] convention holds); home-first otherwise. Unknown (.tbd) sides become
 * synthetic placeholder codes → the scene renders them tbd (empty glass) and teamColor() gives them the
 * neutral molten amber. Zero fetches.
 *
 * ---- 2D-selector scraping contract (cert R4) ----
 * This parser depends on the exact markup scripts/build.mjs bbox()/gcard() bake (which carries the
 * mirror of this comment). Renaming/restructuring ANY of these selectors breaks the Room silently —
 * change them in lockstep, and keep the source-scan pins (test/knockout-room-source.test.mjs) green:
 *   .bcol.b-r32/.b-r16/.b-qf/.b-sf .bbox   round columns    .bcol.b-final .bcol-in > .bbox  final
 *   .bracket-third .bbox                   third place      .bbox[data-mno]                 tie id
 *   .bbrow (order: home, away)             team rows        .bbrow.w                        BAKED winner (the ONLY winner truth — cert B1)
 *   .bbrow[data-color]                     audited team primary (data/team-colors.json, cert B2)
 *   .bbnm / .bbnm.tbd[data-side]           team code / unresolved slot
 *   .bbst .pill.live / .pill.ft            tie state        .bbst .score                    score "h : a"
 *   .bk-pens                               shootout resolution text (cert R3)
 *   .bcol.b-group .gcard  .gh  .grow .bbnm group cards */
function parseBracket(win) {
  const qa = (el, s) => (el ? Array.from(el.querySelectorAll(s)) : []);
  const q = (el, s) => (el ? el.querySelector(s) : null);
  const codeOf = (row) => { const nm = q(row, '.bbnm'); if (!nm || nm.classList.contains('tbd')) return null; return (nm.textContent || '').trim().toUpperCase().slice(0, 3); };
  const stateOf = (box) => q(box, '.bbst .pill.live') ? 'live' : (q(box, '.bbst .pill.ft') ? 'ft' : 'sched');
  /* cert B2 — the AUDITED team palette, read off the rows the bake stamps (data-color = the
     team's data/team-colors.json ui.primary). Collected code->hex as the rounds are walked;
     teamColor() (in the mount) resolves through THIS map, never a private colour table. */
  const COLORS = {};
  const grabColor = (row, code) => { if (!row || !code || !row.getAttribute) return; const c = row.getAttribute('data-color'); if (c) COLORS[code] = c; };
  function parseBox(box, tag, idx) {
    if (!box) return { row: ['__TBD_' + tag + '_' + idx + '_h', '__TBD_' + tag + '_' + idx + '_a', 0, 0], state: 'sched', pens: '', href: '' };
    /* R11 (owner 2026-07-18) — the baked .bbox IS an anchor (build.mjs bbox(): <a class="bbox"
       data-mno href="${matchURL(m)}">); read its href so a resolved 3D card can click through to
       the same 2D match page (cert R4 selector contract). Display truth only — never a data source. */
    const href = box.getAttribute ? (box.getAttribute('href') || '') : '';
    const rows = qa(box, '.bbrow'); const home = rows[0], away = rows[1];
    const hc = codeOf(home), ac = codeOf(away), st = stateOf(box);
    grabColor(home, hc); grabColor(away, ac);
    let hs = 0, as = 0; const sc = q(box, '.bbst .score');
    if (sc) { const nums = (sc.textContent || '').replace(/[^0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number); if (nums.length >= 2) { hs = nums[0]; as = nums[1]; } }
    const ph = (s) => '__TBD_' + tag + '_' + idx + '_' + s;
    const A = hc || ph('h'), B = ac || ph('a');
    /* cert R3 — the baked shootout resolution ("<team> won 4–2 on penalties" / "advance on
       penalties"); display truth only, NEVER a winner-resolution fallback (that stays .bbrow.w's). */
    const pensEl = q(box, '.bk-pens');
    const pens = pensEl ? (pensEl.textContent || '').trim() : '';
    const winW = q(box, '.bbrow.w');
    /* cert B1 (an earlier fix) — winner ordering derives ONLY from the baked .bbrow.w: the 2D floor's own
       honest verdict (build.mjs koWin + the pens writer). An FT tie with NO .w row — e.g. level
       after extra time with the shootout truth not yet baked — is UNRESOLVED: state 'sched', so no
       cascade past it and no trophy. The old score-derived fallback fabricated a 'home' winner on
       a level tie (a fabricated World Cup champion on the one scoreline that decides a final). */
    const winSide = winW ? ((home && home.classList.contains('w')) ? 'home' : 'away') : null;
    if (st === 'ft' && (hc || ac)) {
      if (!winSide) return { row: [A, B, 0, 0], state: 'sched', pens: '', href };
      return winSide === 'away' ? { row: [B, A, as, hs], state: 'ft', pens, href } : { row: [A, B, hs, as], state: 'ft', pens, href };
    }
    if (st === 'live') return { row: [A, B, hs, as], state: 'live', pens: '', href };
    return { row: [A, B, 0, 0], state: 'sched', pens: '', href };
  }
  const col = (cls, n, tag) => { const boxes = qa(win, '.bcol.' + cls + ' .bbox'); const out = []; for (let i = 0; i < n; i++) out.push(parseBox(boxes[i], tag, i)); return out; };
  const r32 = col('b-r32', 16, 'R32'), r16 = col('b-r16', 8, 'R16'), qf = col('b-qf', 4, 'QF'), sf = col('b-sf', 2, 'SF');
  const finalBox = q(win, '.bcol.b-final .bcol-in > .bbox');
  const thirdBox = q(win, '.bracket-third .bbox');
  const fin = parseBox(finalBox, 'FINAL', 0), third = parseBox(thirdBox, 'THIRD', 0);
  // groups A-L (12), 4 codes each, padded
  const gcards = qa(win, '.bcol.b-group .gcard'); const byL = {};
  gcards.forEach((gc) => { const h = q(gc, '.gh'); const L = ((h ? h.textContent : '') || '').replace(/[^A-La-l]/g, '').toUpperCase().slice(-1); const codes = qa(gc, '.grow .bbnm').map((n) => (n.textContent || '').trim().toUpperCase().slice(0, 3)).filter(Boolean); if (L) byL[L] = codes; });
  const GROUPS_DATA = []; for (let i = 0; i < 12; i++) { const L = String.fromCharCode(65 + i); const c = (byL[L] || []).slice(0, 4); while (c.length < 4) c.push('__TBD_G' + i + '_' + c.length); GROUPS_DATA.push(c); }
  const QUALIFIED = new Set(); r32.forEach((m) => { [m.row[0], m.row[1]].forEach((c) => { if (c && !c.startsWith('__TBD')) QUALIFIED.add(c); }); });
  const rowsOf = (a) => a.map((m) => m.row), stOf = (a) => a.map((m) => m.state), pensOf = (a) => a.map((m) => m.pens || ''), hrefOf = (a) => a.map((m) => m.href || '');
  const parsed = {
    GROUPS_DATA, QUALIFIED, COLORS,
    R32_DATA: rowsOf(r32), R32_STATE: stOf(r32), R32_PENS: pensOf(r32), R32_HREF: hrefOf(r32),
    R16_DATA: rowsOf(r16), R16_STATE: stOf(r16), R16_PENS: pensOf(r16), R16_HREF: hrefOf(r16),
    QF_DATA: rowsOf(qf), QF_STATE: stOf(qf), QF_PENS: pensOf(qf), QF_HREF: hrefOf(qf),
    SF_DATA: rowsOf(sf).map((r) => [r[0], r[1], r[2], r[3], (sf[0] ? '' : '')]), SF_STATE: stOf(sf), SF_PENS: pensOf(sf), SF_HREF: hrefOf(sf),
    FINAL_ROW: fin.row, FINAL_STATE: fin.state, FINAL_PENS: fin.pens || '', FINAL_HREF: fin.href || '',
    THIRD_ROW: third.row, THIRD_STATE: third.state, THIRD_PENS: third.pens || '', THIRD_HREF: third.href || '',
  };
  /* cert fix-before-promote (item 1) — THIRD_ROW/THIRD_STATE/THIRD_PENS are in the change-gate sig so
     the real third-place play-off result (Jul 18) triggers the live remount like every other card;
     without them a landed third-place result left the card frozen on its TBD face forever. */
  parsed.sig = JSON.stringify([parsed.R32_DATA, parsed.R32_STATE, parsed.R16_DATA, parsed.R16_STATE, parsed.QF_DATA, parsed.QF_STATE, parsed.SF_DATA, parsed.SF_STATE, parsed.FINAL_ROW, parsed.FINAL_STATE, parsed.THIRD_ROW, parsed.THIRD_STATE, parsed.THIRD_PENS, parsed.GROUPS_DATA, parsed.R32_PENS, parsed.R16_PENS, parsed.QF_PENS, parsed.SF_PENS, parsed.FINAL_PENS, parsed.COLORS]);
  return parsed;
}

const KR_CSS = `
.kr-root{position:relative;width:100%;height:min(78vh,760px);min-height:420px;background:#030510;border-radius:12px;overflow:hidden;font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;}
.kr-root .kr-stage{position:absolute;inset:0;width:100%;height:100%;display:block;}
.kr-root .kr-detflash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:3;display:none;}
.kr-root .khud{position:absolute;z-index:5;color:#cfe6ff;user-select:none;-webkit-user-select:none;}
.kr-root .ktitle{top:12px;left:14px;pointer-events:none;}
.kr-root .ktitle h1{margin:0;font-size:12px;letter-spacing:.22em;font-weight:600;color:#e8f4ff;text-shadow:0 0 18px rgba(90,170,255,.45);}
.kr-root .ktitle p{margin:2px 0 0;font-size:9px;letter-spacing:.14em;color:#6f8fb5;}
.kr-root .kpanel{top:12px;right:12px;display:flex;flex-direction:column;gap:7px;align-items:flex-end;background:rgba(7,12,26,.72);border:1px solid rgba(110,160,230,.22);border-radius:10px;padding:9px 11px;backdrop-filter:blur(6px);}
/* R12 (owner 2026-07-18) — the debug dial panel (PUMP SPEED, PAUSE, VIEW PITCH + phase/pulse
   readouts) is HIDDEN by default so fans get a clean scene; the backtick / grave-accent key toggles
   the .kr-debug class on .kr-root to reveal it. Class-scoped display (not [hidden]) so the reveal
   wins over the base display:flex above (an earlier fix). */
.kr-root:not(.kr-debug) .kpanel{display:none;}
.kr-root .kpanel label{font-size:9px;letter-spacing:.2em;color:#7fa4cf;}
.kr-root .kr-speed,.kr-root .kr-pitch{width:120px;accent-color:#ffab4a;}
.kr-root .kr-runbtn,.kr-root .kr-exit{background:rgba(20,34,62,.9);color:#cfe6ff;border:1px solid rgba(120,170,240,.35);border-radius:6px;font-size:10px;letter-spacing:.16em;padding:5px 12px;cursor:pointer;}
.kr-root .kr-runbtn:hover,.kr-root .kr-exit:hover{background:rgba(36,58,100,.95);}
.kr-root .kr-phase{font-size:10px;letter-spacing:.2em;color:#ffb45e;min-height:11px;font-weight:600;}
.kr-root .kr-pulsecount{font-size:9px;letter-spacing:.16em;color:#7fa4cf;min-height:11px;}
.kr-root .kr-stages{bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:94%;}
.kr-root .kr-stages button{background:rgba(8,14,30,.78);color:#a9c8ef;border:1px solid rgba(110,160,230,.28);border-radius:7px;font-size:10px;letter-spacing:.14em;padding:6px 10px;cursor:pointer;backdrop-filter:blur(5px);transition:all .15s;}
.kr-root .kr-stages button:hover{color:#fff;border-color:rgba(160,200,255,.6);}
.kr-root .kr-stages button.on{background:rgba(255,150,60,.16);color:#ffc98d;border-color:rgba(255,170,80,.65);box-shadow:0 0 14px rgba(255,150,50,.25);}
.kr-root .kr-exit{position:absolute;bottom:14px;right:12px;z-index:6;}
/* ===== an earlier revision championship banner + ticker-tape (ported; scoped to .kr-root and ABSOLUTE, not the
   mockup's viewport-fixed, because the site Room is an embedded panel, not a full-screen page) ===== */
.kr-root .kr-banner{position:absolute;left:50%;top:20%;transform:translate(-50%,-50%) scale(.6);z-index:7;pointer-events:none;text-align:center;opacity:0;transition:opacity .5s ease, top .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1);}
.kr-root .kr-banner .cbk{display:block;font-size:clamp(13px,1.6vw,20px);letter-spacing:.5em;font-weight:600;color:#ffe9b0;text-shadow:0 0 22px rgba(255,190,90,.7);}
.kr-root .kr-banner .cbteam{display:block;font-size:clamp(52px,8vw,96px);line-height:.95;font-weight:800;letter-spacing:.04em;text-transform:uppercase;font-stretch:condensed;margin-top:6px;text-shadow:0 0 34px rgba(255,210,120,.55),0 3px 18px rgba(0,0,0,.6);}
.kr-root .kr-banner.show{opacity:1;transform:translate(-50%,-50%) scale(1);}
.kr-root .kr-banner.corner{top:13%;transform:translate(-50%,-50%) scale(.42);opacity:.96;}
.kr-root .kr-ticker{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:4;}
.kr-root .kr-ttape{position:absolute;top:-40px;width:9px;height:26px;border-radius:2px;opacity:.95;will-change:transform;animation:kr-ttfall linear forwards;}
@keyframes kr-ttfall{0%{transform:translateY(0) rotate(0deg);}100%{transform:translateY(820px) rotate(720deg);}}
/* ===== an earlier revision#2 — third-place BRONZE chip (persists small; condensed-caps register; ABSOLUTE, not
   the mockup's viewport-fixed, because the site Room is an embedded panel) ===== */
.kr-root .kr-bronze-chip{position:absolute;right:16px;bottom:64px;z-index:6;pointer-events:none;display:flex;align-items:center;gap:7px;background:rgba(26,15,5,.82);border:1px solid rgba(205,127,50,.5);border-radius:8px;padding:6px 12px;backdrop-filter:blur(6px);box-shadow:0 0 16px rgba(205,127,50,.22);opacity:0;visibility:hidden;transition:opacity .5s ease,visibility .5s;}
.kr-root .kr-bronze-chip.show{opacity:1;visibility:visible;}
.kr-root .kr-bronze-chip .bck{font-size:11px;letter-spacing:.26em;font-weight:800;color:#e0a24a;text-transform:uppercase;font-stretch:condensed;}
.kr-root .kr-bronze-chip .bcdot{color:#a8814a;font-weight:700;font-size:12px;}
.kr-root .kr-bronze-chip .bcteam{font-size:13px;letter-spacing:.12em;font-weight:800;text-transform:uppercase;font-stretch:condensed;text-shadow:0 0 10px rgba(0,0,0,.5);}
@media (prefers-reduced-motion: reduce){
  .kr-root .kr-banner{transition:opacity .2s;}
  .kr-root .kr-ttape{display:none;}
}
@media (max-width:640px){
 .kr-root .kpanel{padding:7px 9px;gap:5px;} .kr-root .kr-speed,.kr-root .kr-pitch{width:92px;}
 .kr-root .kr-stages button{font-size:9px;padding:5px 7px;letter-spacing:.08em;}
 .kr-root .kr-bronze-chip{bottom:52px;padding:5px 9px;} .kr-root .kr-bronze-chip .bcteam{font-size:11px;} .kr-root .kr-bronze-chip .bck{font-size:9.5px;}
}`;

const KR_HUD_HTML = `
<canvas class="kr-stage"></canvas>
<div class="kr-detflash"></div>
<div class="khud ktitle"><h1>THE KNOCKOUT ROOM</h1><p>PULSE-DRIVEN FILL · TEAM-COLOURED MOLTEN FLUID · LIVE FROM THE BRACKET</p></div>
<div class="khud kpanel">
  <label>PUMP SPEED</label>
  <input class="kr-speed" type="range" min="0.3" max="2.5" step="0.05" value="1">
  <button class="kr-runbtn" type="button">&#10074;&#10074; PAUSE</button>
  <div class="kr-phase">BREWING</div>
  <div class="kr-pulsecount">0 PULSES LIVE</div>
  <label style="margin-top:8px;display:block">VIEW PITCH <span class="kr-pitchdeg" style="float:right;color:#e8c67a">0&deg;</span></label>
  <input class="kr-pitch" type="range" min="0" max="45" step="1" value="0">
</div>
<div class="khud kr-stages">
  <button data-v="HOME" class="on" type="button">HOME</button>
  <button data-v="GROUPS" type="button">GROUPS</button>
  <button data-v="R32" type="button">R32</button>
  <button data-v="R16" type="button">R16</button>
  <button data-v="QF" type="button">QF</button>
  <button data-v="SF" type="button">SF</button>
  <button data-v="FINAL" type="button">FINAL</button>
</div>
<div class="kr-ticker" aria-hidden="true"></div>
<div class="kr-banner" role="status" aria-live="polite"><span class="cbk">CONGRATULATIONS</span><span class="cbteam"></span></div>
<div class="kr-bronze-chip" role="status" aria-live="polite"><span class="bck">Bronze</span><span class="bcdot">&middot;</span><span class="bcteam"></span></div>
<button class="kr-exit" type="button" aria-label="Back to 2D bracket">2D ✕</button>`;

export async function mountKnockoutRoom(hostEl, opts = {}) {
  const { THREE, GLTFLoader, buildCauldron, buildTrophy, SHELLS } = await loadMods();
  const root = hostEl;
  root.classList.add('kr-root');
  root.innerHTML = KR_HUD_HTML;
  const W = () => root.clientWidth || 1, H = () => root.clientHeight || 1;

  // removable-listener registry + RAF/dispose bookkeeping (toggle-cycle-safe; no leaks across mounts)
  const _listeners = [];
  const on = (target, ev, fn, o) => { target.addEventListener(ev, fn, o); _listeners.push([target, ev, fn, o]); };
  const _winHooks = ['__setFill', '__detonate', '__pulseState', '__dbg', '__sample', '__timeRenders', '__project', '__champState', '__champSim', '__bronzeReplay', '__bronzeState'];
  let _raf = 0, _disposed = false;

  // Escape exits 3D (mirrors the toggle); document.hidden pause is handled in the tick loop.
  on(window, 'keydown', (e) => { if (e.key === 'Escape' && opts.onExit) opts.onExit(); });
  /* R12 (owner 2026-07-18) — the debug HUD (all dials + PAUSE, the .kpanel) is hidden by default
     for a clean fan scene; the backtick (`) key toggles it. Registered through on() so it exists
     ONLY while this mount is live — dispose() removes it, so the key is inert on the 2D floor.
     Backtick chosen for being unobtrusive with no browser/site collision; ignored with modifiers. */
  on(window, 'keydown', (e) => {
    if (e.key === '`' && !e.metaKey && !e.ctrlKey && !e.altKey) { root.classList.toggle('kr-debug'); }
  });

  // LIVE DATA — parse the baked 2D bracket DOM (single source of truth, zero fetches).
  const bracketWin = (opts.bracketWin) || document.querySelector('.bracket-window');
  const parsed = parseBracket(bracketWin);
  const { GROUPS_DATA, QUALIFIED, R32_DATA, R32_STATE, R32_PENS, R32_HREF, R16_DATA, R16_STATE, R16_PENS, R16_HREF, QF_DATA, QF_STATE, QF_PENS, QF_HREF, SF_DATA, SF_STATE, SF_PENS, SF_HREF, FINAL_ROW, FINAL_STATE, FINAL_PENS, FINAL_HREF, THIRD_ROW, THIRD_STATE, THIRD_PENS, THIRD_HREF } = parsed;
  root.__krSig = parsed.sig;

/* ============================ ported scene (an earlier revision) begins ============================ */


/* ============ renderer / scene / camera ============ */
const canvas = root.querySelector('.kr-stage');
/* an earlier revision — preserveDrawingBuffer:true added (an earlier revision did not need it) so the verification harness's
   window.__sample() can gl.readPixels() the transmission-glass hero objects; matches the proven
   glass-poc harness (glass-poc/index.html) exactly. Visual output is unaffected. */
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W(), H());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
/* cert R9 — a lost GL context (driver reset, GPU crash, tab eviction) must never strand a black
   canvas with no way back: exit cleanly to the certified 2D floor (onExit -> to2D() disposes this
   mount and restores .bracket-window); the [2D|3D] toggle stays offered, so 3D is re-enterable.
   Registered through on() so dispose() removes it BEFORE its own forceContextLoss() — no re-entry. */
on(canvas, 'webglcontextlost', (e) => {
  try { e.preventDefault(); } catch (err) {}
  if (opts.onExit) opts.onExit(); else dispose();
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030510);
scene.fog = new THREE.Fog(0x030510, 52, 170);

const BASE_FOV = 78;
const camera = new THREE.PerspectiveCamera(BASE_FOV, W()/H(), 0.1, 400);

/* bgGroup — deep-background elements only (walls, nebulae, starfield, cauldron + its fire lights).
   Pipes, distributor, pump, cards and the glass wall are added directly to `scene` (never to
   bgGroup) so stage-focus background parallax never touches them. */
const bgGroup = new THREE.Group();
scene.add(bgGroup);
/* TURN8 FIX #1 — cauGroup declared here (ahead of the lights section, which attaches the pot's
   two lights to it below) so it exists before anything references it. Full reasoning lives at
   its actual population site, further down, next to POTZ/cauHost. */
const cauGroup = new THREE.Group();
scene.add(cauGroup);

/* ============ lights ============ */
const amb = new THREE.AmbientLight(0x30405c, 0.85); scene.add(amb);
const key = new THREE.DirectionalLight(0xbdd8ff, 1.5); key.position.set(-14, 20, 24); scene.add(key);
const warm = new THREE.DirectionalLight(0xffb070, 0.3); warm.position.set(16, 4, 12); scene.add(warm);
/* TURN7 FIX #1: repositioned/boosted to track the bigger, higher cauldron host (was tuned for the
   old scale-3.6/y=5.2 rig) so the fire glow still visibly wraps the vessel rather than sitting
   below it in empty air. */
const fireLight = new THREE.PointLight(0xff7a1e, 12, 44, 1); fireLight.position.set(0, 0.4, -37.0); cauGroup.add(fireLight);
const wallLight = new THREE.PointLight(0x5f8fdd, 0.8, 0, 0); wallLight.position.set(0, 6, 8); scene.add(wallLight);
/* R9 FIX (detonation wash) — `flash` used distance=0/decay=0 ("no attenuation": every surface in
   the scene, however far, was lit at the SAME full intensity as the trophy itself), which is what
   was bleaching the whole dark hall to pale beige for the salvo's duration instead of lighting just
   the trophy's own corner. Given real falloff (distance 42, decay 2 — same order as fireLight's own
   cauldron falloff two lines up) plus a lower peak (fireShot(), below: 34 -> 20), it now reads as a
   strong LOCAL flash that dims with distance, so the room stays dark and deep past a few units. */
const flash = new THREE.PointLight(0xffc27a, 0, 42, 2); flash.position.set(0, -10, 4); scene.add(flash);
/* an earlier revision perf note: a second always-in-scene PointLight (tried for wider strobe reach) cost real fps
   across the ~90-card wall's lit materials even at intensity 0 (shader light-loop cost is paid per
   compiled light regardless of value). Cut it — `flash` above (now with real falloff) plus the DOM
   #detFlash overlay below (now a radial gradient centred on the trophy, not a flat full-viewport
   wash — see its styling in tick()) together sell "the trophy flash-lights its own corner" without
   flooding the periphery. */

/* ============ stage color registry (gray out preceding stages, keep animating) ============ */
/* stages: 0 GROUPS (+feed plumbing) · 1 R32 · 2 R16 · 3 QF · 4 SF (+off-gas) · 5 FINAL */
const stageReg = [];
let grayCut = 0;
function grayOf(c){
  const l = THREE.MathUtils.clamp(0.299*c.r + 0.587*c.g + 0.114*c.b, 0, 1);
  return new THREE.Color(l, l, l);
}
function regMat(mat, stage){
  const e = {mat, stage, color:mat.color.clone(), gray:grayOf(mat.color)};
  if (mat.emissive) { e.emissive = mat.emissive.clone(); e.grayE = grayOf(mat.emissive); }
  stageReg.push(e);
  return e;   /* R9 #10 — a caller that later re-tints this mat at runtime (the final leg's
                 champion colour) needs this entry too, or the next applyGray() call stomps the
                 live colour back to whatever was current when regMat() first ran. */
}
function applyGray(cut){
  grayCut = cut;
  for (const e of stageReg) {
    const g = e.stage < cut;
    e.mat.color.copy(g ? e.gray : e.color);
    if (e.emissive) e.mat.emissive.copy(g ? e.grayE : e.emissive);
  }
}

/* ============ shared materials ============ */
const darkMetal  = new THREE.MeshStandardMaterial({color:0x1a2233, metalness:0.85, roughness:0.42});
const frameLineMat = new THREE.LineBasicMaterial({color:0x6f95cc, transparent:true, opacity:0.55});

/* ============ the room ============ */
const floorMat = new THREE.MeshStandardMaterial({color:0x0a1020, metalness:0.35, roughness:0.75});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 110), floorMat);
floor.rotation.x = -Math.PI/2; floor.position.set(0, -16, -40); scene.add(floor);
const grid = new THREE.GridHelper(140, 46, 0x1d3050, 0x131f38);
grid.position.set(0, -15.97, -40); grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);

const wallMatDark = new THREE.MeshStandardMaterial({color:0x060a16, metalness:0.2, roughness:0.9});
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(140, 74), wallMatDark);
backWall.position.set(0, 8, -95); bgGroup.add(backWall);
for (const sx of [-1, 1]) {
  const side = new THREE.Mesh(new THREE.PlaneGeometry(110, 74), wallMatDark);
  side.rotation.y = sx * Math.PI/2;
  side.position.set(sx * -46, 8, -42); bgGroup.add(side);
}

/* starfield */
{
  const N = 1600, pos = new Float32Array(N*3);
  for (let i = 0; i < N; i++) {
    const r = 120 + Math.random()*120;
    const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
    pos[i*3]   = r*Math.sin(ph)*Math.cos(th);
    pos[i*3+1] = Math.abs(r*Math.cos(ph)) * 0.8 - 12;
    pos[i*3+2] = -30 - Math.abs(r*Math.sin(ph)*Math.sin(th));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({color:0xa9c4ff, size:0.65, sizeAttenuation:true, transparent:true, opacity:0.8, fog:false});
  bgGroup.add(new THREE.Points(g, m));
}
function nebulaTex(inner, outer){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128,128,10,128,128,128);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(c);
}
const nebPurple = new THREE.Mesh(new THREE.PlaneGeometry(90,60),
  new THREE.MeshBasicMaterial({map:nebulaTex('rgba(90,50,170,0.34)','rgba(0,0,0,0)'), transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, fog:false}));
nebPurple.position.set(-24, 14, -88); bgGroup.add(nebPurple);
const nebTeal = new THREE.Mesh(new THREE.PlaneGeometry(80,52),
  new THREE.MeshBasicMaterial({map:nebulaTex('rgba(30,140,150,0.28)','rgba(0,0,0,0)'), transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, fog:false}));
nebTeal.position.set(26, 6, -90); bgGroup.add(nebTeal);

/* ============ the glass wall (camera side) ============ */
const frameMat = new THREE.MeshStandardMaterial({color:0x0e1626, metalness:0.8, roughness:0.4});
const FW = 44, FH = 34, FZ = 1.6, FCY = -0.5;
for (const [w,h,x,y] of [[FW,0.7,0,FCY+FH/2],[FW,0.7,0,FCY-FH/2],[0.7,FH,-FW/2,FCY],[0.7,FH,FW/2,FCY]]) {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w,h,0.7), frameMat);
  beam.position.set(x,y,FZ); scene.add(beam);
}
/* TURN8 FIX #4 (source side) — the room's own front glass wall sits between camera and every
   card; its clearcoat is what throws the sharpest specular hot-spots ("glare"). Softened
   (clearcoat 1->0.55, roughness 0.03->0.07) so it still reads unmistakably as glass without
   producing a hard mirror-bright streak that can land on a card's own type — belt-and-suspenders
   with the baked text scrim above, not a replacement for it. */
const glassWall = new THREE.Mesh(new THREE.PlaneGeometry(FW-0.7, FH-0.7),
  new THREE.MeshPhysicalMaterial({color:0xbcd9ff, metalness:0, roughness:0.07, transparent:true, opacity:0.05, clearcoat:0.55, clearcoatRoughness:0.2, side:THREE.DoubleSide, depthWrite:false}));
glassWall.position.set(0, FCY, FZ); scene.add(glassWall);

/* ============ the REAL cauldron (lib/artifacts.js) — TURN7 FIX #1: "the pot needs to be elevated
   more and larger" (the maintainer note 1), flagged unmet on an earlier revision AND an earlier revision by an external reviewer ("its presence is
   underwhelming"). lib/artifacts.js itself is untouched (earth seated in the measured mouth, hood a
   suspended canopy) — this is a HOST-transform fix only: scale raised 3.6->5.2 (44% larger) and the
   host lifted 5.2->8.0 so the mouth/boil sits higher in frame, clear of the group-card band rather
   than tucked below it. Verified against the frustum at HOME's pitch-23 camera (the visible vertical
   span at the pot's own depth is roughly [-58,+46] world units there) — comfortable headroom, so
   this is a straightforward "bigger, higher," not a reframe. Kept deep (POTZ unchanged) per the maintainer's
   own fallback: "if the size needs to be very large to be realistic, push it to the background." ============ */
const POTZ = -38;
/* TURN8 FIX #1 — cauGroup (declared up near bgGroup, above) is a SEPARATE transform group from
   bgGroup (walls/starfield/nebula), holding only the cauldron + the two lights that light it.
   bgGroup's own stage-focus fisheye (below, in tick()) recedes AND grows its members by up to
   +22% so the walls don't look like they shrink away as the camera zooms into a stage — but that
   same growth, compounding on an already-large cauldron (host scale 5.2), is exactly what let it
   balloon into the SF/QF card band at focus framings (GPT-5.5, turn8: "so large and low in some
   focus frames that it intrudes behind the semi-final cards"). cauGroup gets the SAME recede but
   the OPPOSITE scale trend — it shrinks slightly as fishAmt rises — so it recedes AND shrinks
   together as the camera moves from HOME/GROUPS (fishAmt 0/0.12, full size, looming) toward
   SF/QF/FINAL (fishAmt 0.32-0.48, materially smaller), guaranteeing it never grows toward the
   bracket read at exactly the framings where that read matters most. */
const cauHost = new THREE.Group();
/* host.y=17 (not the first-pass 8.0) — measured via the live projection: at 8.0 the pot's own
   mouth projected to screenY~356, ALMOST EXACTLY the group row's own top edge (354), so the boil
   sat directly behind the card wall and read only in the slivers between cards — failing "see what
   is boiling in the pot" even though the vessel itself was bigger. Scanned host.y against the
   group-row/distributor screen bands and picked the value that clears both with real margin. */
/* Grok (turn8 dissent): "raise cauldron elevation 15%" — 17 -> 19.6 (+15%), extra headroom
   clear of the group-card band and the SF/QF sightlines computed above. */
cauHost.position.set(0, 19.6, POTZ);
cauHost.scale.setScalar(5.2);
cauGroup.add(cauHost);
const cau = buildCauldron(THREE, GLTFLoader, {
  parent: cauHost, glbBase: '/img/cauldron/',
  onReady: w => { if (String(w).endsWith('fail')) console.warn('[R7F] cauldron artifact failed to load:', w); },
  /* an earlier revision hood rework — fires once BOTH cauldron GLBs are in and the hood's intake/duct anchors are
     genuinely measured (an earlier fix). potRouteDirty is a module-level let declared down in the pipe
     section; this callback only ever runs async (network load), long after module eval, so there
     is no TDZ here (an earlier fix) — and the actual rebuild happens in tick(), gated so it can never swap
     the tube out from under a toDist pulse mid-flight. */
  onHoodReady: () => { potRouteDirty = true; }
});

/* pump (offset right; floor-level) — an earlier revision HERO GLASS #3: "the pump housing: same treatment
   [as the distributor], smaller." The body used to be plain opaque darkMetal with nothing visible
   inside it; per the glass-poc lesson ("something must be BEHIND transmissive glass for it to
   read") a molten core cylinder is added FIRST, then the housing becomes real transmission glass
   around it — the machine's second visibly-working heart, smaller than the distributor's. A
   dedicated pumpGlassMat replaces the shared `darkMetal` here (darkMetal is reused by many other
   opaque parts across the room — ports, spout, flywheel — so it must stay opaque; giving the pump
   body its own material is what lets it go transmissive without touching anything else). */
const PX = 6.5, PZ = -25;
const pumpCoreMat = new THREE.MeshStandardMaterial({color:0x8a3400, emissive:0xff8020, emissiveIntensity:1.5, roughness:0.35});
regMat(pumpCoreMat, 0);
const pumpCore = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 2.7, 16), pumpCoreMat);
pumpCore.position.set(PX, -12.3, PZ); scene.add(pumpCore);
/* an earlier fix — clearcoat is colourless; the amber hue lives in the wall's own .color, clearcoat kept
   low. an earlier fix — emissiveIntensity kept well under the ACES ~1.7 clip so the glass tint doesn't wash
   to cream. */
const pumpGlassMat = new THREE.MeshPhysicalMaterial({color:0xd8c8a8, metalness:0, roughness:0.08, transmission:1, ior:1.5, thickness:0.6, transparent:false, opacity:1, clearcoat:0.25, clearcoatRoughness:0.3, emissive:0xff8020, emissiveIntensity:0.18, side:THREE.FrontSide});
regMat(pumpGlassMat, 0);
const pumpBody = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 3.2, 18), pumpGlassMat);
pumpBody.position.set(PX, -12.3, PZ); scene.add(pumpBody);
const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2.4, 12),
  new THREE.MeshStandardMaterial({color:0x8b96ad, metalness:0.9, roughness:0.3}));
piston.position.set(PX, -9.8, PZ); scene.add(piston);
const pistonCap = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.4, 14), darkMetal);
pistonCap.position.set(PX, -8.7, PZ); scene.add(pistonCap);
const flywheel = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.22, 10, 26), darkMetal);
flywheel.position.set(PX+1.9, -11.4, PZ); scene.add(flywheel);
const pumpGauge = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8),
  new THREE.MeshStandardMaterial({color:0x201005, emissive:0xffa040, emissiveIntensity:1.6}));
pumpGauge.position.set(PX-1.2, -10.6, PZ+0.6); scene.add(pumpGauge);

/* ============================================================================
   THE DISTRIBUTOR — TURN7 FIX #2 (half of it): "the distributor/pump causal chain is still
   visually secondary" / "not clearly visible" (Gemini, on note 3). Ported wholesale from r6e (the
   build Gemini named superior on this exact point) rather than re-solved from scratch: a big,
   glowing, amber-glass housing sitting in the one genuinely open volume in the room — directly
   above the group row, close enough to the pot's glow to read as fed by it — with 12 flared ports
   the group pipes visibly leave FROM. Its 12 drops to the group cards are now short and direct
   (see the feed-routing below) instead of a long diagonal fan across the whole depth of the room —
   this is also half of the "spaghetti" fix Gemini named on r6e's own web of group feeds. ============ */
const DISTY = 13.4, DISTZ = -13;
/* an earlier revision HERO GLASS #2 — real transmission glass (glass-poc PROVEN recipe: transmission:1, ior~1.5,
   thickness), so the molten core (distCore, below — already sitting inside this box) is seen
   THROUGH real refractive glass, not just an alpha-blended tint. an earlier fix — the amber hue stays on the
   wall's own .color (unchanged from an earlier revision: 0xffb060), clearcoat trimmed down (0.9->0.35) so it
   cannot wash the hue to a colourless white specular. an earlier fix — emissiveIntensity left at an earlier revision's own
   0.5, well under the ACES ~1.7 clip. transparent/opacity dropped in favour of transmission itself
   carrying the "see-through" (alphaMode-OPAQUE pattern from the glass-poc report — mixing regular
   alpha-blend with transmission double-darkens the result). */
const distHousingMat = new THREE.MeshPhysicalMaterial({color:0xffb060, metalness:0.05, roughness:0.10, transmission:1, ior:1.5, thickness:1.0, transparent:false, opacity:1, emissive:0xff7a1e, emissiveIntensity:0.5, clearcoat:0.35, clearcoatRoughness:0.2, side:THREE.FrontSide});
regMat(distHousingMat, 0);
const dist = new THREE.Mesh(new THREE.BoxGeometry(11.0, 1.6, 1.9), distHousingMat);
dist.position.set(0, DISTY, DISTZ); scene.add(dist);
const distFrameMat = new THREE.MeshStandardMaterial({color:0x141c2c, metalness:0.8, roughness:0.35});
for (const fx2 of [-5.5, 5.5]) {
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.75, 2.05), distFrameMat);
  cap.position.set(fx2, DISTY, DISTZ); scene.add(cap);
}
const distMoltenMat = new THREE.MeshStandardMaterial({color:0x8a3400, emissive:0xff8020, emissiveIntensity:1.55, roughness:0.35});
regMat(distMoltenMat, 0);
const distCore = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 10.7, 20), distMoltenMat);
distCore.rotation.z = Math.PI/2; distCore.position.set(0, DISTY, DISTZ); scene.add(distCore);
const portTipMat = new THREE.MeshStandardMaterial({color:0x3a1600, emissive:0xffa030, emissiveIntensity:1.5, roughness:0.4});
regMat(portTipMat, 0);
/* ports hang from the housing's UNDERSIDE — the group row sits directly below (row-top at 11.95,
   housing bottom at 12.6: a clean 0.65-unit gap), so a viewer at HOME sees the whole chain in one
   glance: pot -> hood -> pump -> this lit manifold -> 12 lit ports -> pipes dropping into the cards. */
const PORT_Y = DISTY - 1.55;
const distPorts = [];
for (let i = 0; i < 12; i++) {
  const fx = -4.6 + i*(9.2/11);
  const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.9, 10), distFrameMat);
  nub.position.set(fx, PORT_Y+0.5, DISTZ); scene.add(nub);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 9), portTipMat);
  tip.position.set(fx, PORT_Y, DISTZ); scene.add(tip);
  distPorts.push(tip);
}
const distBackGlow = new THREE.Sprite(new THREE.SpriteMaterial({map:nebulaTex('rgba(255,160,70,0.5)','rgba(0,0,0,0)'), blending:THREE.AdditiveBlending, depthWrite:false, fog:false}));
distBackGlow.scale.set(13.5, 4.8, 1); distBackGlow.position.set(0, DISTY, DISTZ-1.6); scene.add(distBackGlow);
const distGlow = new THREE.PointLight(0xff8020, 9, 20, 1.6); distGlow.position.set(0, DISTY+0.3, DISTZ+0.9); scene.add(distGlow);
const potSpill = new THREE.PointLight(0xff661a, 26, 46, 1.6); potSpill.position.set(0, 10.0, -37); cauGroup.add(potSpill);

/* ============================================================================
   THE CARD SYSTEM — "cards that visibly fill", TURN3 CRITICAL FIX applied.
   Each card is TWO independent glass halves sharing one sealed cell: bottom
   inlet, bottom WINNER outlet, SIDE loser vent (red-hot), each half with its
   OWN meniscus. Decided: winner's half fills HIGH and glows hot molten;
   loser's half fills LOW (drained) and stays dim — the two halves read as
   visibly different LEVELS, not just different colors, so the result is
   unmistakable from across the room. Live: both halves share one pulsing
   level, undecided. TBD (FINAL/OFF-GAS): both halves share one level driven
   by the simulation, molten amber as it climbs toward the climax.
   ============================================================================ */
const dynCards = [];   // per-card runtime state, updated every frame
let matchSeq = 0;

function faceTexture(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true;
  return t;
}
/* safe-type-zone helper: shrinks font-size until the string fits maxWidth (never crops) */
function fitText(g, text, cx, cy, maxWidth, startPx, weight, family){
  let px = startPx;
  g.font = weight + ' ' + px + 'px ' + family;
  while (g.measureText(text).width > maxWidth && px > startPx*0.55) {
    px -= 1;
    g.font = weight + ' ' + px + 'px ' + family;
  }
  g.fillText(text, cx, cy);
  return px;
}
/* TURN8 FIX #4 — "group codes veiled by glare and pipe rails... nothing may veil type." Bakes a
   soft dark backing directly into the canvas texture BEHIND a team code, the same rounded-plate
   trick the HUD's own label() already uses for its captions — so legibility never depends on
   what the 3D scene happens to be doing behind the card (a specular hot-spot off the glass, a
   pipe rail at a grazing angle): the glyph always has guaranteed contrast baked in, regardless. */
function scrim(g, cx, cy, w, h){
  const rx = w/2, ry = h/2, r = Math.min(rx, ry) * 0.45;
  g.fillStyle = 'rgba(3,7,16,0.42)';
  g.beginPath();
  g.moveTo(cx-rx+r, cy-ry);
  g.arcTo(cx+rx, cy-ry, cx+rx, cy+ry, r);
  g.arcTo(cx+rx, cy+ry, cx-rx, cy+ry, r);
  g.arcTo(cx-rx, cy+ry, cx-rx, cy-ry, r);
  g.arcTo(cx-rx, cy-ry, cx+rx, cy-ry, r);
  g.closePath(); g.fill();
}
const FAM = '"Avenir Next","Segoe UI",sans-serif';
function drawMatchFace(g, w, h, d){
  g.clearRect(0,0,w,h);
  g.textAlign = 'center';
  g.font = '700 22px ' + FAM;
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillStyle = 'rgba(150,190,235,0.75)';
  g.fillText(d.tag, w*0.06, h*0.06);
  if (d.mode === 'live') {
    g.fillStyle = 'rgba(255,110,90,0.95)';
    g.beginPath(); g.arc(w*0.90, h*0.10, w*0.014, 0, 7); g.fill();
    g.font = '700 20px ' + FAM;
    g.fillStyle = 'rgba(255,150,120,0.9)';
    g.textAlign = 'right';
    g.fillText('LIVE · ' + d.minute, w*0.88, h*0.055);
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const cy = h*0.56;
  const safeW = w*0.30;
  if (d.mode === 'decided') {
    const codeSize = Math.round(h*0.24), scoreSize = Math.round(h*0.15);
    const aX = w*0.16, bX = w*0.84, mX = w*0.5;
    /* R9 #8 — flags, one per competing team, in the gap between the header row and the
       code/score block; never overlapping the type. */
    const fgW = w*0.13, fgH = h*0.09, fgY = h*0.235;
    scrim(g, aX, fgY, fgW*1.3, fgH*1.5); scrim(g, bX, fgY, fgW*1.3, fgH*1.5);
    drawFlag(g, d.a, aX-fgW/2, fgY-fgH/2, fgW, fgH);
    drawFlag(g, d.b, bX-fgW/2, fgY-fgH/2, fgW, fgH);
    scrim(g, aX, cy, safeW*1.05, h*0.30); scrim(g, bX, cy, safeW*1.05, h*0.30);
    g.fillStyle = d.winner === 'a' ? 'rgba(255,238,200,0.98)' : 'rgba(160,172,190,0.7)';
    const usedA = fitText(g, d.a, aX, cy, safeW, codeSize, '900', FAM);
    g.fillStyle = d.winner === 'b' ? 'rgba(255,238,200,0.98)' : 'rgba(160,172,190,0.7)';
    const usedB = fitText(g, d.b, bX, cy, safeW, codeSize, '900', FAM);
    g.font = '800 ' + scoreSize + 'px ' + FAM;
    g.fillStyle = 'rgba(255,205,120,0.96)';
    fitText(g, d.sa + ' – ' + d.sb, mX, cy, w*0.22, scoreSize, '800', FAM);
    g.strokeStyle = 'rgba(255,196,90,0.92)'; g.lineWidth = Math.max(2, h*0.018);
    const uX = d.winner === 'a' ? aX : bX, uw = w*0.11, uSize = d.winner === 'a' ? usedA : usedB;
    g.beginPath(); g.moveTo(uX-uw, cy+uSize*0.66); g.lineTo(uX+uw, cy+uSize*0.66); g.stroke();
    /* cert R3 — a shootout-decided tie shows its resolution honestly, right under the level FT
       score: the baked .bk-pens text verbatim ("<team> won 4–2 on penalties"). Display truth only —
       the winner ordering above already came exclusively from .bbrow.w. */
    if (d.pens) {
      const pSize = Math.round(h*0.085);
      scrim(g, w*0.5, h*0.84, w*0.72, pSize*1.9);
      g.font = '700 ' + pSize + 'px ' + FAM;
      g.fillStyle = 'rgba(255,215,140,0.95)';
      fitText(g, d.pens, w*0.5, h*0.84, w*0.66, pSize, '700', FAM);
    }
  } else if (d.mode === 'live') {
    /* TURN8 FIX #2 — "live cards still omit a prominent live score/minute despite the
       requirement to instantly see... WHAT THE SCORE WAS." A live match is exactly the case
       where a fan's first question is the running score, so it gets the SAME visual weight the
       decided branch gives its final score, not a bare "v". */
    const codeSize = Math.round(h*0.22), scoreSize = Math.round(h*0.20);
    const fgW2 = w*0.13, fgH2 = h*0.09, fgY2 = h*0.235;
    scrim(g, w*0.17, fgY2, fgW2*1.3, fgH2*1.5); scrim(g, w*0.83, fgY2, fgW2*1.3, fgH2*1.5);
    drawFlag(g, d.a, w*0.17-fgW2/2, fgY2-fgH2/2, fgW2, fgH2);
    drawFlag(g, d.b, w*0.83-fgW2/2, fgY2-fgH2/2, fgW2, fgH2);
    scrim(g, w*0.17, cy, w*0.28, h*0.28); scrim(g, w*0.83, cy, w*0.28, h*0.28);
    g.fillStyle = 'rgba(235,245,255,0.95)';
    fitText(g, d.a, w*0.17, cy, w*0.26, codeSize, '900', FAM);
    fitText(g, d.b, w*0.83, cy, w*0.26, codeSize, '900', FAM);
    g.font = '800 ' + scoreSize + 'px ' + FAM;
    g.fillStyle = 'rgba(255,150,105,0.98)';
    fitText(g, d.sa + ' – ' + d.sb, w*0.5, cy, w*0.26, scoreSize, '800', FAM);
    g.font = '700 ' + Math.round(h*0.11) + 'px ' + FAM;
    g.fillStyle = 'rgba(255,180,150,0.88)';
    g.fillText(d.minute, w*0.5, cy + scoreSize*0.72);
  } else { /* tbd */
    g.font = '700 ' + Math.round(h*0.20) + 'px ' + FAM;
    g.fillStyle = 'rgba(140,160,190,0.55)';
    fitText(g, d.label, w*0.5, cy, w*0.88, Math.round(h*0.20), '700', FAM);
  }
  g.textAlign = 'right'; g.textBaseline = 'bottom';
  g.font = '600 16px ' + FAM;
  g.fillStyle = 'rgba(120,150,190,0.55)';
  g.fillText(d.id, w*0.94, h*0.95);
}
function drawGroupFace(g, w, h, d){
  /* an earlier revision — summary-card LOD (turn5 blocker #2): this face IS the collapsed representation of
     4 team pots; qualifiers must read at a glance here since the full 48 only ever expand one
     group at a time (on hover), never all-48-at-once. */
  g.clearRect(0,0,w,h);
  g.textAlign = 'center'; g.textBaseline = 'top';
  g.font = '700 26px ' + FAM;
  g.fillStyle = 'rgba(150,190,235,0.8)';
  g.fillText('GROUP ' + d.letter, w*0.5, h*0.08);
  const cx = [w*0.28, w*0.72], cyv = [h*0.42, h*0.78];
  g.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    const q = d.qualified[i];
    /* R9 #8 — one flag per group team, above its code. */
    const fgW = w*0.09, fgH = h*0.065;
    scrim(g, cx[i%2], cyv[(i/2)|0]-h*0.115, fgW*1.4, fgH*1.5);
    drawFlag(g, d.codes[i], cx[i%2]-fgW/2, cyv[(i/2)|0]-h*0.115-fgH/2, fgW, fgH);
    scrim(g, cx[i%2], cyv[(i/2)|0], w*0.42, h*0.24);
    g.fillStyle = q ? 'rgba(255,238,200,0.98)' : 'rgba(140,150,168,0.5)';
    fitText(g, d.codes[i], cx[i%2], cyv[(i/2)|0], w*0.34, Math.round(h*0.19), q ? '900' : '700', FAM);
    if (q) {
      g.fillStyle = 'rgba(150,255,190,0.92)';
      g.font = '800 ' + Math.round(h*0.10) + 'px ' + FAM;
      g.fillText('✓', cx[i%2] + w*0.155, cyv[(i/2)|0] - h*0.095);
    }
  }
}
function drawTeamFace(g, w, h, d){
  g.clearRect(0,0,w,h);
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.font = '700 16px ' + FAM;
  g.fillStyle = 'rgba(150,190,235,0.7)';
  g.fillText('GRP ' + d.letter, w*0.06, h*0.07);
  drawFlag(g, d.code, w*0.5 - w*0.11, h*0.10, w*0.22, h*0.16);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 ' + Math.round(h*0.30) + 'px ' + FAM;
  scrim(g, w*0.5, h*0.42, w*0.72, h*0.34);
  g.fillStyle = d.qualified ? 'rgba(255,238,200,0.98)' : 'rgba(150,160,178,0.6)';
  fitText(g, d.code, w*0.5, h*0.42, w*0.86, Math.round(h*0.30), '900', FAM);
  g.font = '600 ' + Math.round(h*0.13) + 'px ' + FAM;
  g.fillStyle = 'rgba(190,210,240,0.75)';
  fitText(g, d.name, w*0.5, h*0.68, w*0.9, Math.round(h*0.13), '600', FAM);
  g.font = '700 ' + Math.round(h*0.11) + 'px ' + FAM;
  g.fillStyle = d.qualified ? 'rgba(150,255,190,0.9)' : 'rgba(255,120,110,0.75)';
  g.fillText(d.qualified ? 'QUALIFIED' : 'ELIMINATED', w*0.5, h*0.86);
}

/* ============================================================================
   COLLAPSED faces — TURN6 defect #2: "never render a card as an unreadable
   smudge — collapse it into a summary card, don't shrink it into mush." These
   are drawn once at build time (cheap — same canvas-texture machinery as the
   detail faces) and swapped in by updateCardLOD() purely off each card's own
   measured on-screen size, every frame. No score, no match id, no live dot —
   just the two codes (or a stage label) at the biggest safe size, so even at
   a handful of screen pixels the card still reads as SOMETHING legible
   instead of fine print turned to noise. The fluid level behind it is
   completely unaffected — "the fill state reads by LEVEL, not by reading"
   holds at every LOD tier, per the brief's own words. ============================================================================ */
function drawMatchFaceCollapsed(g, w, h, d){
  g.clearRect(0,0,w,h);
  /* TURN8 FIX #4 — same baked scrim as the group faces: this is R32/R16/OFF-GAS's default face at
     HOME, so its codes are exactly the ones "veiled by glare" would be measured against. */
  scrim(g, w*0.5, h*0.56, w*0.94, h*0.62);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const cy = h*0.56, safeW = w*0.40;
  if (d.mode === 'decided') {
    const sz = Math.round(h*0.40);
    /* R9 #8 — tiny flag chips, collapsed LOD; still legible, never touching the codes below. */
    const cfW = w*0.16, cfH = h*0.14, cfY = h*0.13;
    scrim(g, w*0.27, cfY, cfW*1.4, cfH*1.5); scrim(g, w*0.73, cfY, cfW*1.4, cfH*1.5);
    drawFlag(g, d.a, w*0.27-cfW/2, cfY-cfH/2, cfW, cfH);
    drawFlag(g, d.b, w*0.73-cfW/2, cfY-cfH/2, cfW, cfH);
    g.fillStyle = d.winner === 'a' ? 'rgba(255,230,160,0.98)' : 'rgba(150,160,178,0.55)';
    fitText(g, d.a, w*0.27, cy, safeW, sz, '900', FAM);
    g.fillStyle = d.winner === 'b' ? 'rgba(255,230,160,0.98)' : 'rgba(150,160,178,0.55)';
    fitText(g, d.b, w*0.73, cy, safeW, sz, '900', FAM);
    g.font = '700 ' + Math.round(h*0.16) + 'px ' + FAM;
    g.fillStyle = 'rgba(190,210,235,0.5)';
    g.fillText('–', w*0.5, cy);
  } else if (d.mode === 'live') {
    /* TURN8 FIX #2 — the collapsed face is what a fan sees at a glance from across the room; the
       score belongs here too, not just at stage-focus. Codes pushed to the corners, running
       score dead center at the biggest safe size — legible at exactly the pixel counts this face
       exists for. */
    const codeSz = Math.round(h*0.30), scoreSz = Math.round(h*0.38);
    const cfW2 = w*0.16, cfH2 = h*0.14, cfY2 = h*0.86;
    scrim(g, w*0.14, cfY2, cfW2*1.4, cfH2*1.5); scrim(g, w*0.86, cfY2, cfW2*1.4, cfH2*1.5);
    drawFlag(g, d.a, w*0.14-cfW2/2, cfY2-cfH2/2, cfW2, cfH2);
    drawFlag(g, d.b, w*0.86-cfW2/2, cfY2-cfH2/2, cfW2, cfH2);
    g.fillStyle = 'rgba(220,235,255,0.85)';
    fitText(g, d.a, w*0.14, cy, w*0.18, codeSz, '900', FAM);
    fitText(g, d.b, w*0.86, cy, w*0.18, codeSz, '900', FAM);
    g.fillStyle = 'rgba(255,160,110,0.98)';
    fitText(g, d.sa + '–' + d.sb, w*0.5, cy, w*0.32, scoreSz, '900', FAM);
    /* TURN7 — "who's live" must read at HOME too, where this collapsed face is the ONLY thing
       shown for the semis. A dot/shape reads at any size, unlike a "LIVE" word at a few screen
       pixels, so the live state is a color cue here, not more text. */
    g.fillStyle = 'rgba(255,90,70,0.95)';
    g.beginPath(); g.arc(w*0.5, h*0.14, w*0.032, 0, 7); g.fill();
  } else { /* tbd */
    g.font = '800 ' + Math.round(h*0.24) + 'px ' + FAM;
    g.fillStyle = 'rgba(165,185,215,0.6)';
    fitText(g, d.tag, w*0.5, cy, w*0.86, Math.round(h*0.24), '800', FAM);
  }
}
function drawGroupFaceCollapsed(g, w, h, d){
  /* TURN8 FIX #4 — this is the face groups actually wear at HOME (39px < GROUP_LOD_FLOOR), so it
     is the one the "group codes veiled by glare" complaint was almost certainly measured against;
     the detail face's scrim (drawGroupFace, above) never even renders there. Same fix, applied here. */
  g.clearRect(0,0,w,h);
  scrim(g, w*0.5, h*0.56, w*0.86, h*0.78);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = '700 ' + Math.round(h*0.22) + 'px ' + FAM;
  g.fillStyle = 'rgba(170,205,240,0.9)';
  g.fillText('GROUP', w*0.5, h*0.40);
  g.font = '900 ' + Math.round(h*0.52) + 'px ' + FAM;
  g.fillStyle = 'rgba(255,238,205,0.99)';
  g.textBaseline = 'middle';
  g.fillText(d.letter, w*0.5, h*0.72);
}

/* molten palette (adopted from r2f, the best-scored fluid/glow treatment in the batch) —
   unlit base colors so the read never depends on where in the room a card sits, plus a
   separate additive flicker-glow layer for true "molten liquid" character. */
const WIN_C  = new THREE.Color(0xffd27e);
const LOSE_C = new THREE.Color(0x34353c);
const LIVE_C = new THREE.Color(0xff9a3a), LIVE_HI = new THREE.Color(0xffe2ab);
/* TURN8 merge (an earlier revision/r7d) — ONE shared red for every loser-vent surface: SF side ports, the
   OFF-GAS card's two inlets, and the off-gas-bound slug color, so "loser fluid vents red" reads
   as a single consistent thread from the SF card to the off-gas jar, not two similar-but-not-
   identical hex values. */
const VENT_HOT = new THREE.Color(0xff3a1a);
/* R9 — group cards represent 4 teams, not a single match; both halves share this molten gold. */
const GROUP_C = new THREE.Color(0xffb43a);

/* TURN8 merge (GPT-5.5: "merge in r7d's more disciplined per-card LOD floors") — declared here,
   ahead of buildCard, so every card can read its own default at construction time (the full
   invariant/reasoning lives with updateCardLOD, far below, where it's actually applied). */
const MIN_LEGIBLE_PX  = 40;   // default per-card collapse floor (protects QF/SF/FINAL at HOME)
const GROUP_LOD_FLOOR  = 90;  // stricter floor for the 12 group summary cards (4-code face)
const GLYPH_HIDE_PX    = 34;  // below this even the collapsed 2-glyph face hides; row label carries it

/* buildCard(x,y,w,h,stage,opts) — the sealed glass cell, two independent halves.
   opts: {tex, sidePort, mode:'decided'|'live'|'tbd'|'team', winner:'a'|'b'|null, qualified, cheapGlass} */
function buildCard(x, y, w, h, stage, opts){
  opts = opts || {};
  const depth = Math.max(0.3, Math.min(w,h)*0.22);
  const grp = new THREE.Group();

  const backMat = new THREE.MeshStandardMaterial({color:0x070a14, metalness:0.25, roughness:0.9});
  regMat(backMat, stage);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w*0.96, h*0.96), backMat);
  back.position.set(0, 0, -depth*0.46); grp.add(back);

  /* fluid halves — TWO INDEPENDENT fill levels (fillA/fillB), the critical fix: a decided
     card's winner half climbs high and glows; the loser half stays low and dim — "drained",
     legible by LEVEL as well as color, unmistakable from across the room. */
  const fluidGeo = new THREE.BoxGeometry(w*0.44, 1, depth*0.42);
  const glowGeo  = new THREE.BoxGeometry(w*0.34, 1, depth*0.28);
  const matA = new THREE.MeshBasicMaterial({color:0x1c2230, transparent:true, opacity:0.72, depthWrite:false});
  const matB = matA.clone();
  const glowMatA = new THREE.MeshBasicMaterial({color:0x1c2230, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false});
  const glowMatB = glowMatA.clone();
  const fluidA = new THREE.Mesh(fluidGeo, matA); fluidA.position.set(-w*0.25, -h/2, -depth*0.06); fluidA.scale.y = 0.0001;
  const fluidB = new THREE.Mesh(fluidGeo, matB); fluidB.position.set( w*0.25, -h/2, -depth*0.06); fluidB.scale.y = 0.0001;
  const glowA = new THREE.Mesh(glowGeo, glowMatA); glowA.position.set(-w*0.25, -h/2, -depth*0.01); glowA.scale.y = 0.0001;
  const glowB = new THREE.Mesh(glowGeo, glowMatB); glowB.position.set( w*0.25, -h/2, -depth*0.01); glowB.scale.y = 0.0001;
  grp.add(fluidA, fluidB, glowA, glowB);

  /* two independent menisci — one per half, since winner/loser sit at different levels */
  const menMatA = new THREE.MeshBasicMaterial({color:0xfff0c8, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false});
  const menMatB = menMatA.clone();
  const meniscusA = new THREE.Mesh(new THREE.PlaneGeometry(w*0.42, Math.max(h*0.06, 0.05)), menMatA);
  meniscusA.position.set(-w*0.25, -h/2, -depth*0.02); grp.add(meniscusA);
  const meniscusB = new THREE.Mesh(new THREE.PlaneGeometry(w*0.42, Math.max(h*0.06, 0.05)), menMatB);
  meniscusB.position.set( w*0.25, -h/2, -depth*0.02); grp.add(meniscusB);

  /* scorebug — printed on the front glass, in front of the fluid */
  const tex = opts.tex;
  const textMat = new THREE.MeshBasicMaterial({map:tex, transparent:true, depthWrite:false});
  const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(w*0.96, h*0.96), textMat);
  textPlane.position.set(0, 0, depth*0.30); grp.add(textPlane);

  /* waterline tints — per half */
  const tintMatA = new THREE.MeshBasicMaterial({color:0x2a1608, transparent:true, opacity:0, depthWrite:false});
  const tintMatB = tintMatA.clone();
  const tintA = new THREE.Mesh(new THREE.PlaneGeometry(w*0.46, 1), tintMatA);
  tintA.position.set(-w*0.25, -h/2, depth*0.34); tintA.scale.y = 0.0001; grp.add(tintA);
  const tintB = new THREE.Mesh(new THREE.PlaneGeometry(w*0.46, 1), tintMatB);
  tintB.position.set( w*0.25, -h/2, depth*0.34); tintB.scale.y = 0.0001; grp.add(tintB);

  /* the sealed glass shell — TURN8 FIX #4 (source side): clearcoat trimmed 0.5->0.3 and
     clearcoatRoughness raised 0.3->0.42 to soften the card's own specular hot-spot (the known
     trap: "clearcoat is colourless by design" and can throw a bright streak straight across the
     type it should never touch); the baked text scrim is the real guarantee, this just lowers
     the odds of ever needing it. */
  const glassMat = opts.cheapGlass
    ? new THREE.MeshStandardMaterial({color:0xa8d4ff, metalness:0.08, roughness:0.16, transparent:true, opacity:0.16, side:THREE.DoubleSide, depthWrite:false})
    : new THREE.MeshPhysicalMaterial({color:0xa8d4ff, metalness:0, roughness:0.24, transparent:true, opacity:0.11, clearcoat:0.3, clearcoatRoughness:0.42, side:THREE.DoubleSide, depthWrite:false});
  regMat(glassMat, stage);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), glassMat);
  grp.add(glass);

  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, depth*1.02));
  const edgeLines = new THREE.LineSegments(edges, frameLineMat);
  grp.add(edgeLines);

  /* explicit paint order — text ALWAYS crisp on top of the fluid/glow, glass sheen never
     lands on top of it (the exact "olive swamp water" washout r2f fixed) */
  back.renderOrder = 0;
  fluidA.renderOrder = fluidB.renderOrder = 1;
  glowA.renderOrder = glowB.renderOrder = 2;
  meniscusA.renderOrder = meniscusB.renderOrder = 3;
  glass.renderOrder = 4;
  textPlane.renderOrder = 5;
  tintA.renderOrder = tintB.renderOrder = 6;
  edgeLines.renderOrder = 7;

  /* bottom inlet / WINNER outlet — everything advances from here, except the OFF-GAS manifold
     card (opts.noBottomPort), which takes BOTH its inlets from the side instead (brief note 7). */
  if (!opts.noBottomPort) {
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.32, 8), darkMetal);
    port.position.set(0, -h/2 - 0.13, 0); grp.add(port);
  }

  /* SIDE loser vent (red-hot) — card anatomy, exactly. Positioned on the LOSER's actual side
     when the match is decided (you can see who lost by which way the fluid goes); generic
     right edge while the match is still live/undecided. */
  let sideTip = null;
  if (opts.sidePort) {
    let sideSign = 1;
    if (opts.mode === 'decided' && opts.winner) sideSign = (opts.winner === 'a') ? 1 : -1;
    const sideX = sideSign * (w/2);
    const sidePortMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8), darkMetal);
    sidePortMesh.rotation.z = Math.PI/2;
    sidePortMesh.position.set(sideX + sideSign*0.13, 0, 0); grp.add(sidePortMesh);
    /* TURN8 merge (Grok: "explicit side-port red vents on every semi-final card") — idle
       emissiveIntensity raised 0 -> baseline (set per-mode in updateCard(), below: 'live' cards
       get their own pilot glow rather than sitting fully dark until a slug happens to vent). */
    const sideTipMat = new THREE.MeshStandardMaterial({color:0x2a0d02, emissive:VENT_HOT.getHex(), emissiveIntensity:0});
    sideTip = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), sideTipMat);
    sideTip.position.set(sideX + sideSign*0.30, 0, 0); grp.add(sideTip);
  }

  /* an earlier revision — imported from r3d (Grok's 92, the round's top single score): THE OFF-GAS / 3RD-PLACE
     CARD gets TWO labelled side inlets, L(SF1) + L(SF2), read on the card's OWN face — not a
     floating HUD label elsewhere. Each inlet is its own red-hot ember port with a name tag riding
     right on the glass edge, so "loser -> off-gas" is unmistakable at this card alone. */
  const inletPorts = {};
  if (opts.dualSidePort) {
    const sides = [{key:'L(SF1)', sx:-1}, {key:'L(SF2)', sx:1}];
    for (const s of sides) {
      const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.36, 8), darkMetal);
      pm.rotation.z = Math.PI/2;
      pm.position.set(s.sx*(w/2 + 0.15), h*0.14, 0); grp.add(pm);
      const tipMat = new THREE.MeshStandardMaterial({color:0x1a0703, emissive:VENT_HOT.getHex(), emissiveIntensity:1.3});
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), tipMat);
      tip.position.set(s.sx*(w/2 + 0.34), h*0.14, 0); grp.add(tip);
      tip.userData.vent = 0;
      const ltex = faceTexture(240, 76, (g,ww,hh) => {
        g.clearRect(0,0,ww,hh); g.font = '700 40px ' + FAM;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = 'rgba(255,150,110,0.95)';
        g.shadowColor = 'rgba(255,90,40,0.85)'; g.shadowBlur = 12;
        g.fillText(s.key, ww/2, hh/2);
      });
      const lspr = new THREE.Sprite(new THREE.SpriteMaterial({map:ltex, transparent:true, depthWrite:false, fog:false}));
      lspr.scale.set(1.25, 0.40, 1);
      lspr.position.set(s.sx*(w/2 + 0.34 + 0.68), h*0.14, 0.05); grp.add(lspr);
      inletPorts[s.key] = tip;
    }
  }

  grp.position.set(x, y, 0);
  scene.add(grp);

  const card = {
    grp, x, y, w, h, stage, depth,
    fluidA, matA, glowA, glowMatA, meniscusA, menMatA, tintA, tintMatA,
    fluidB, matB, glowB, glowMatB, meniscusB, menMatB, tintB, tintMatB,
    sideTip, inletPorts, hitMesh: glass,
    fillA: 0, fillB: 0, grayAmt: 0, pulseT: 0, ventT: 0, revealT: 1,
    mode: opts.mode || 'tbd', winner: opts.winner || null, qualified: opts.qualified || false,
    targetFillWin: 0.86, targetFillLose: 0.14,
    /* R9 #1/#9 — pulse-driven fill (replaces the old sim-variable fill). pulseTracked cards
       (12 groups + 16 R32 + 8 R16 + 4 QF + 2 SF + 1 FINAL) are empty until the pulse engine
       (below, near the pipe/segs registry) sets fillTargetA/B on arrival; colA/colB are each
       half's fixed team colour (precomputed at build time from the bracket data), and emitColor
       is the colour this card hands onward once both halves have arrived. */
    pulseTracked: !!opts.pulseTracked,
    fillTargetA: 0, fillTargetB: 0,
    colA: opts.colA || null, colB: opts.colB || null, emitColor: opts.emitColor || null,
    /* an earlier revision — TURN6 defect #2 (the HARD legibility invariant): every card that was built with a
       texCollapsed keeps BOTH textures on hand so updateCardLOD() (defined near the animation
       loop) can swap the FACE MATERIAL's map, every frame, purely off that card's own projected
       on-screen size — never off which "view" is nominally active. A card with no texCollapsed
       (the 48 hover-only team-detail cards) is exempt: it is only ever shown large, on demand. */
    textMat, texDetail: opts.tex || null, texCollapsed: opts.texCollapsed || null, lodCollapsed: false, lodHidden: false,
    /* TURN8 merge (r7d's per-card LOD floor) — see the const declarations just above. */
    lodFloor: opts.lodFloor || MIN_LEGIBLE_PX,
    /* R11 — the parsed 2D match-page href for a RESOLVED match card; a truthy value makes this card
       click-through (the canvas 'click' raycast, below). TBD/group/team cards leave it null. */
    href: opts.href || null
  };
  dynCards.push(card);
  return card;
}

/* per-frame visual update: independent per-half fill level, meniscus, glow flicker, grayout */
function updateCard(card, dt, t){
  const grayed = card.stage < grayCut ? 1 : 0;
  card.grayAmt += (grayed - card.grayAmt) * Math.min(dt*2.2, 1);

  if (card.pulseTracked) {
    /* R9 #1 — driven purely by pulse arrivals: fillTargetA/B are 0 until the pulse engine sets
       them (a group's single pulse, or a knockout card's two independent team pulses — "the SUM
       of the 2 pulses feeding it fills it"), then eased in the same way every other mode already
       animated its rise. */
    card.fillA += (card.fillTargetA - card.fillA) * Math.min(dt*1.7, 1);
    card.fillB += (card.fillTargetB - card.fillB) * Math.min(dt*1.7, 1);
  } else if (card.mode === 'decided') {
    const aT = card.winner === 'a' ? card.targetFillWin : card.targetFillLose;
    const bT = card.winner === 'b' ? card.targetFillWin : card.targetFillLose;
    card.fillA += (aT - card.fillA) * Math.min(dt*0.9, 1);
    card.fillB += (bT - card.fillB) * Math.min(dt*0.9, 1);
  } else if (card.mode === 'team') {
    const tgt = card.qualified ? card.targetFillWin : card.targetFillLose;
    card.fillA += (tgt - card.fillA) * Math.min(dt*0.9, 1);
    card.fillB = card.fillA;
  } else if (card.mode === 'live') {
    const shared = 0.42 + Math.sin(t*0.35 + card.x*0.4) * 0.30 + 0.28;
    card.fillA = card.fillB = shared;
  } else { /* tbd, not pulse-tracked (e.g. OFFGAS) — scheduled/TBD stays empty glass */
    card.fillB = card.fillA;
  }

  if (card.pulseT > 0) card.pulseT -= dt;
  const bounce = card.pulseT > 0 ? Math.sin(Math.min(card.pulseT,0.5)/0.5*Math.PI) * 0.035 : 0;
  const rippleOn = card.pulseTracked || card.mode === 'decided' || card.mode === 'live' || card.mode === 'tbd';
  const rippleA = rippleOn ? Math.sin(t*1.6 + card.x) * 0.006 : 0;
  const rippleB = rippleOn ? Math.sin(t*1.6 + card.x + 1.7) * 0.006 : 0;

  const fillFracA = THREE.MathUtils.clamp(card.fillA + bounce + rippleA, 0, 0.97);
  const fillFracB = THREE.MathUtils.clamp(card.fillB + bounce + rippleB, 0, 0.97);
  const fillPxA = Math.max(fillFracA * card.h * 0.94, 0.0006);
  const fillPxB = Math.max(fillFracB * card.h * 0.94, 0.0006);

  card.fluidA.scale.y = fillPxA; card.fluidA.position.y = -card.h/2 + fillPxA/2;
  card.glowA.scale.y = Math.max(fillPxA*0.94, 0.0006); card.glowA.position.y = -card.h/2 + card.glowA.scale.y/2;
  card.meniscusA.position.y = -card.h/2 + fillPxA;
  card.tintA.scale.y = fillPxA; card.tintA.position.y = -card.h/2 + fillPxA/2;

  card.fluidB.scale.y = fillPxB; card.fluidB.position.y = -card.h/2 + fillPxB/2;
  card.glowB.scale.y = Math.max(fillPxB*0.94, 0.0006); card.glowB.position.y = -card.h/2 + card.glowB.scale.y/2;
  card.meniscusB.position.y = -card.h/2 + fillPxB;
  card.tintB.scale.y = fillPxB; card.tintB.position.y = -card.h/2 + fillPxB/2;

  const showA = fillFracA > 0.02, showB = fillFracB > 0.02;
  card.menMatA.opacity = showA ? (0.62 + Math.sin(t*7 + card.x)*0.14) * (1-card.grayAmt*0.6) : 0;
  card.menMatB.opacity = showB ? (0.62 + Math.sin(t*7 + card.x + 2.1)*0.14) * (1-card.grayAmt*0.6) : 0;
  card.tintMatA.opacity = showA ? 0.20 * (1-card.grayAmt*0.4) : 0;
  card.tintMatB.opacity = showB ? 0.20 * (1-card.grayAmt*0.4) : 0;
  /* R9 fix — the fluid SLAB itself (matA/matB) always had a fixed 0.72 opacity, unconditioned on
     fill amount; that was invisible in r8f (a "decided" card's loser half never dropped below its
     0.14 floor, so the sliver was always the same dim near-background LOSE_C). Pulse-tracked cards
     now start at a genuine 0 and use bright team colours for BOTH halves, so that same
     always-on sliver became a visible bright line on an "empty" card. Gate it by the same showA/B
     so an empty card is actually empty glass, not a colour-veiled hairline. */
  card.matA.opacity = showA ? 0.72 * (1-card.grayAmt*0.3) : 0;
  card.matB.opacity = showB ? 0.72 * (1-card.grayAmt*0.3) : 0;

  /* winner glows hot / loser sits drained-cold; live+tbd pulse molten amber (climax buildup
     included — no flat "TBD grey" fluid, the molten palette applies to ALL fluid). */
  let colA, colB;
  if (card.pulseTracked) {
    /* R9 #9 — each half fills in ITS team's colour (fixed at build time from the bracket data;
       groups use a shared molten gold since a group card represents 4 teams, not a single match). */
    colA = card.colA || WIN_C;
    colB = card.colB || WIN_C;
  } else if (card.mode === 'decided') {
    colA = card.winner === 'a' ? WIN_C : LOSE_C;
    colB = card.winner === 'b' ? WIN_C : LOSE_C;
  } else if (card.mode === 'team') {
    colA = colB = card.qualified ? WIN_C : LOSE_C;
  } else {
    const pulse = 0.5 + Math.sin(t*3.1 + card.x)*0.5;
    colA = colB = LIVE_C.clone().lerp(LIVE_HI, pulse*0.4);
  }
  card.matA.color.copy(colA).lerp(grayOf(colA), card.grayAmt);
  card.matB.color.copy(colB).lerp(grayOf(colB), card.grayAmt);

  const flickA = 0.5 + Math.sin(t*5.2 + card.x*1.7)*0.28 + Math.sin(t*11.3 + card.x)*0.12;
  const flickB = 0.5 + Math.sin(t*5.2 + card.x*1.7 + 2.4)*0.28 + Math.sin(t*11.3 + card.x + 2.4)*0.12;
  const lumaA = 0.299*card.matA.color.r + 0.587*card.matA.color.g + 0.114*card.matA.color.b;
  const lumaB = 0.299*card.matB.color.r + 0.587*card.matB.color.g + 0.114*card.matB.color.b;
  card.glowMatA.color.copy(card.matA.color);
  card.glowMatB.color.copy(card.matB.color);
  card.glowMatA.opacity = showA ? THREE.MathUtils.clamp(flickA,0,1) * Math.min(0.72, lumaA*1.18) * (1-card.grayAmt*0.7) : 0;
  card.glowMatB.opacity = showB ? THREE.MathUtils.clamp(flickB,0,1) * Math.min(0.72, lumaB*1.18) * (1-card.grayAmt*0.7) : 0;

  if (card.sideTip) {
    /* TURN8 merge (Grok: "explicit side-port red vents on every semi-final card feeding the
       off-gas jar") — 'live' (the two SF cards, today) now carries its own always-on pilot
       glow, not just 'decided' matches. A fan can find the vent on an SF card at a glance,
       before any slug happens to be mid-flight through it; it still brightens further (v*3.2)
       the instant one actually vents. */
    const decidedEmber = card.mode === 'decided' ? 0.7 : (card.mode === 'live' ? 0.42 : 0);
    card.ventT -= dt;
    const v = Math.max(0, card.ventT) / 0.55;
    card.sideTip.material.emissiveIntensity = (decidedEmber + v*3.2) * (1-card.grayAmt*0.5);
    card.sideTip.material.emissive.copy(VENT_HOT).lerp(new THREE.Color(0x552418), card.grayAmt);
  }
}
function pulseCard(card){ card.pulseT = 0.55; }
function ventCard(card){ if (card.sideTip) card.ventT = 0.55; }
function ventInlet(card, key){ if (card.inletPorts && card.inletPorts[key]) card.inletPorts[key].userData.vent = 0.6; }

/* ============ code -> display name lookup (cosmetic ONLY — cert minor fix: the old header here
   advertised the mockup's invented bracket data; every score/winner/state now comes exclusively
   from the parsed live DOM). Used by the group-detail faces (drawTeamFace) to show a full name
   under a code; an unknown code falls back to the code itself, never to invented data. ============ */
const TEAM = {
  GER:'Germany', MEX:'Mexico', KSA:'Saudi Arabia',
  FRA:'France', SWE:'Sweden', QAT:'Qatar', IRN:'Iran',
  CAN:'Canada', URU:'Uruguay', RSA:'South Africa', TUN:'Tunisia',
  NED:'Netherlands', MAR:'Morocco',
  POR:'Portugal', CRO:'Croatia',
  ESP:'Spain', AUT:'Austria', PAN:'Panama',
  USA:'United States', BIH:'Bosnia & Herz.', KOR:'South Korea',
  BEL:'Belgium', SEN:'Senegal', UZB:'Uzbekistan', NZL:'New Zealand',
  BRA:'Brazil', JPN:'Japan', SCO:'Scotland',
  NOR:'Norway', CIV:'Ivory Coast', PAR:'Paraguay', HAI:'Haiti',
  COL:'Colombia', ECU:'Ecuador', EGY:'Egypt', COD:'DR Congo',
  ENG:'England', ARG:'Argentina', GHA:'Ghana', CPV:'Cape Verde',
  SUI:'Switzerland', CZE:'Czechia', AUS:'Australia', TUR:'Türkiye',
  CUW:'Curaçao', ALG:'Algeria', IRQ:'Iraq', JOR:'Jordan'
};

/* ============================================================================
   cert B2 (an earlier fix) — team colours come from the AUDITED site palette, read straight off the baked
   DOM: build.mjs stamps every resolved .bbrow with data-color = that team's data/team-colors.json
   ui.primary, and parseBracket() collects them into parsed.COLORS (code -> '#hex'). The mockup's
   private colour table (34/48 wrong at hue level, 11 fossil codes) is DELETED — one colour
   source for the whole page, zero new fetches. Unknown/absent code (TBD placeholder, or a row the
   bake couldn't colour) -> the neutral molten amber, exactly as before. ============ */
function teamColor(code){ const c = parsed.COLORS[code]; return c ? new THREE.Color(c) : new THREE.Color(0xffd27e); }

/* ============================================================================
   R9 #8 — flags, drawn PROCEDURALLY on the canvas texture. No external
   fetches — same reasoning the room's own procedural earth texture uses (zero
   CSP surface). A compact type+colour table covers all 48 codes with a small
   set of generic renderers (bands / cross / disc / diamond / canton / saltire
   / diagonal / starfield / taegeuk); simplified-but-recognizable is the bar,
   crests are never chased. Never veils the type — drawn as a small chip,
   placed above/beside each code, not behind it. ============ */
const FLAG_TYPES = {
  h(g,w,h,c,ws){ let y=0; const n=c.length, wgt=ws||c.map(()=>1/n); for(let i=0;i<n;i++){ const bh=h*wgt[i]; g.fillStyle=c[i]; g.fillRect(0,y,w,bh+0.6); y+=bh; } },
  v(g,w,h,c,ws){ let x=0; const n=c.length, wgt=ws||c.map(()=>1/n); for(let i=0;i<n;i++){ const bw=w*wgt[i]; g.fillStyle=c[i]; g.fillRect(x,0,bw+0.6,h); x+=bw; } },
  stripes(g,w,h,c){ const [c0,c1,n]=c, bh=h/n; for(let i=0;i<n;i++){ g.fillStyle=i%2?c1:c0; g.fillRect(0,i*bh,w,bh+0.6); } },
  solid(g,w,h,c){ g.fillStyle=c[0]; g.fillRect(0,0,w,h); },
  cross(g,w,h,c){ const [bg,cr,inner]=c; g.fillStyle=bg; g.fillRect(0,0,w,h);
    const cx=w*0.36, cw=h*0.30; g.fillStyle=cr;
    g.fillRect(cx-cw*0.5,0,cw,h); g.fillRect(0,h*0.5-cw*0.5,w,cw);
    if (inner){ const iw=cw*0.42; g.fillStyle=inner; g.fillRect(cx-iw*0.5,0,iw,h); g.fillRect(0,h*0.5-iw*0.5,w,iw); } },
  disc(g,w,h,c){ const [bg,disc,frac]=c; g.fillStyle=bg; g.fillRect(0,0,w,h);
    g.fillStyle=disc; g.beginPath(); g.arc(w*0.5,h*0.5,h*(frac||0.4),0,7); g.fill(); },
  diamond(g,w,h,c){ const [bg,dia,circ]=c; g.fillStyle=bg; g.fillRect(0,0,w,h);
    g.fillStyle=dia; g.beginPath(); g.moveTo(w*0.5,h*0.08); g.lineTo(w*0.92,h*0.5); g.lineTo(w*0.5,h*0.92); g.lineTo(w*0.08,h*0.5); g.closePath(); g.fill();
    g.fillStyle=circ; g.beginPath(); g.arc(w*0.5,h*0.5,h*0.22,0,7); g.fill(); },
  canton(g,w,h,c){ const [s0,s1,cant,frac]=c, bh=h/7;
    for(let i=0;i<7;i++){ g.fillStyle=i%2?s1:s0; g.fillRect(0,i*bh,w,bh+0.6); }
    const cw=w*(frac||0.4), chh=h*0.54; g.fillStyle=cant; g.fillRect(0,0,cw,chh);
    g.fillStyle='rgba(255,255,255,0.85)';
    for(let r=0;r<2;r++) for(let ci=0;ci<3;ci++){ g.beginPath(); g.arc(cw*(0.2+ci*0.3), chh*(0.28+r*0.44), h*0.028,0,7); g.fill(); } },
  saltire(g,w,h,c){ const [bg,x,quads]=c; g.fillStyle=bg; g.fillRect(0,0,w,h);
    if (quads){
      g.save(); g.beginPath(); g.moveTo(0,0); g.lineTo(w,0); g.lineTo(w*0.5,h*0.5); g.closePath(); g.fillStyle=quads[0]; g.fill(); g.restore();
      g.save(); g.beginPath(); g.moveTo(w,0); g.lineTo(w,h); g.lineTo(w*0.5,h*0.5); g.closePath(); g.fillStyle=quads[1]; g.fill(); g.restore();
      g.save(); g.beginPath(); g.moveTo(0,h); g.lineTo(w,h); g.lineTo(w*0.5,h*0.5); g.closePath(); g.fillStyle=quads[2]; g.fill(); g.restore();
      g.save(); g.beginPath(); g.moveTo(0,0); g.lineTo(0,h); g.lineTo(w*0.5,h*0.5); g.closePath(); g.fillStyle=quads[3]; g.fill(); g.restore();
    }
    g.strokeStyle=x; g.lineWidth=h*0.16;
    g.beginPath(); g.moveTo(0,0); g.lineTo(w,h); g.stroke();
    g.beginPath(); g.moveTo(w,0); g.lineTo(0,h); g.stroke(); },
  quad(g,w,h,c){ g.fillStyle=c[0]; g.fillRect(0,0,w*0.5,h*0.5); g.fillStyle=c[1]; g.fillRect(w*0.5,0,w*0.5,h*0.5);
    g.fillStyle=c[2]; g.fillRect(0,h*0.5,w*0.5,h*0.5); g.fillStyle=c[3]; g.fillRect(w*0.5,h*0.5,w*0.5,h*0.5); },
  diag(g,w,h,c){ const [bg,stripe,border]=c; g.fillStyle=bg; g.fillRect(0,0,w,h);
    g.beginPath(); g.moveTo(0,h); g.lineTo(w*0.32,h); g.lineTo(w,h*0.18); g.lineTo(w,0); g.lineTo(w*0.68,0); g.lineTo(0,h*0.82); g.closePath();
    g.fillStyle=border||stripe; g.fill();
    g.beginPath(); g.moveTo(0,h); g.lineTo(w*0.22,h); g.lineTo(w,h*0.28); g.lineTo(w,h*0.08); g.lineTo(w*0.78,0); g.lineTo(0,h*0.72); g.closePath();
    g.fillStyle=stripe; g.fill(); },
  starfield(g,w,h,c){ const [bg,star,count,scattered]=c; g.fillStyle=bg; g.fillRect(0,0,w,h);
    g.fillStyle=star; const n=count||1;
    for(let i=0;i<n;i++){ const sx=scattered?w*(0.2+0.6*((i*0.618)%1)):w*0.28, sy=scattered?h*(0.25+0.5*((i*0.382+0.15)%1)):h*0.3;
      g.beginPath(); g.arc(sx,sy,h*0.06,0,7); g.fill(); } },
  taegeuk(g,w,h,c){ const [red,blue]=c; g.fillStyle='#ffffff'; g.fillRect(0,0,w,h);
    g.save(); g.beginPath(); g.arc(w*0.5,h*0.5,h*0.32,0,7); g.clip();
    g.fillStyle=blue; g.fillRect(0,h*0.5,w,h*0.5);
    g.fillStyle=red; g.fillRect(0,0,w,h*0.5);
    g.fillStyle=red; g.beginPath(); g.arc(w*0.5,h*0.5-h*0.16,h*0.16,0,7); g.fill();
    g.fillStyle=blue; g.beginPath(); g.arc(w*0.5,h*0.5+h*0.16,h*0.16,0,7); g.fill();
    g.restore(); }
};
const FLAGS = {
  GER:['h',['#000000','#dd0000','#ffce00']], MEX:['v',['#006847','#ffffff','#ce1126']],
  KSA:['solid',['#006c35']],
  FRA:['v',['#0055a4','#ffffff','#ef4135']], SWE:['cross',['#006aa7','#fecc02']],
  QAT:['v',['#ffffff','#8d1b3d'],[0.22,0.78]], IRN:['h',['#239f40','#ffffff','#da0000']],
  CAN:['v',['#ff0000','#ffffff','#ff0000'],[0.25,0.5,0.25]], URU:['stripes',['#ffffff','#0038a8',9]],
  RSA:['h',['#007a4d','#ffb612','#000000']], TUN:['disc',['#e70013','#ffffff',0.32]],
  NED:['h',['#ae1c28','#ffffff','#21468b']], MAR:['starfield',['#c1272d','#006233',1,false]],
  POR:['v',['#046a38','#da020e'],[0.4,0.6]], CRO:['h',['#ff0000','#ffffff','#171796']],
  ESP:['h',['#aa151b','#f1bf00','#aa151b'],[0.25,0.5,0.25]], AUT:['h',['#ed2939','#ffffff','#ed2939']],
  PAN:['quad',['#ffffff','#da121a','#0033a0','#ffffff']],
  USA:['canton',['#b22234','#ffffff','#3c3b6e',0.42]], BIH:['diag',['#002395','#fecb00','#fecb00']],
  KOR:['taegeuk',['#c60c30','#003478']],
  BEL:['v',['#000000','#fae042','#ed2939']], SEN:['v',['#00853f','#fdef42','#e31b23']],
  UZB:['h',['#0099b5','#ffffff','#1eb53a']], NZL:['starfield',['#00247d','#c8102e',4,true]],
  BRA:['diamond',['#009739','#fedd00','#012169']], JPN:['disc',['#ffffff','#bc002d',0.30]],
  SCO:['saltire',['#005eb8','#ffffff',null]],
  NOR:['cross',['#ef2b2d','#ffffff','#00205b']], CIV:['v',['#f77f00','#ffffff','#009e60']],
  PAR:['h',['#0038a8','#ffffff','#d52b1e']], HAI:['h',['#00209f','#d21034']],
  COL:['h',['#fcd116','#003893','#ce1126'],[0.5,0.25,0.25]], ECU:['h',['#ffdd00','#034ea2','#ed1c24'],[0.5,0.25,0.25]],
  EGY:['h',['#ce1126','#ffffff','#000000']], COD:['diag',['#007fff','#ce1021','#f7d618']],
  ENG:['cross',['#ffffff','#cf142b']], ARG:['h',['#74acdf','#ffffff','#74acdf'],[0.25,0.5,0.25]],
  GHA:['h',['#ce1126','#fcd116','#006b3f']], CPV:['h',['#003893','#ffffff','#cf2027','#ffffff','#003893'],[0.4,0.07,0.06,0.07,0.4]]
};
/* SITE EXTENSION — flag chips for the real qualifiers the mockup's fictional 48 lacked. Codes are
   the site's audited FIFA trigrams (data/flag-map.json: SUI/CZE/AUS/TUR/CUW/ALG/IRQ/JOR); the
   mockup's 11 fossil codes (teams that are not in the 2026 tournament, plus non-FIFA code
   misspellings) are purged (cert B2 follow-through) — every entry matches a real 2026 team. */
Object.assign(FLAGS, {
  SUI: ['cross',['#da291c','#ffffff']],
  CZE: ['h',['#ffffff','#d7141a']], AUS: ['starfield',['#00247d','#ffffff',5,true]],
  TUR: ['disc',['#e30a17','#ffffff',0.22]], CUW: ['h',['#002b7f','#f9e814','#002b7f'],[0.55,0.15,0.3]],
  ALG: ['v',['#006233','#ffffff']], IRQ: ['h',['#ce1126','#ffffff','#000000']],
  JOR: ['h',['#000000','#ffffff','#007a3d']]
});
function drawFlag(g, code, x, y, w, h){
  const spec = FLAGS[code]; if (!spec) return;
  const [type, colors, weights] = spec;
  const fn = FLAG_TYPES[type]; if (!fn) return;
  const r = Math.min(w,h)*0.12;
  function roundRectPath(){
    g.beginPath();
    g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r);
    g.closePath();
  }
  g.save(); g.translate(x,y); roundRectPathLocal(); g.clip();
  fn(g, w, h, colors, weights);
  g.restore();
  function roundRectPathLocal(){
    g.beginPath();
    g.moveTo(r,0); g.arcTo(w,0,w,h,r); g.arcTo(w,h,0,h,r); g.arcTo(0,h,0,0,r); g.arcTo(0,0,w,0,r);
    g.closePath();
  }
  g.save();
  roundRectPath();
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = Math.max(1, Math.min(w,h)*0.05);
  g.stroke();
  g.restore();
}

function decidedOpts(tag, a, b, sa, sb, id, pens){
  /* cert B1/R3 — rows arrive winner-first FROM THE PARSE (.bbrow.w is the only ordering truth), so
     the winner is 'a' by construction. The old `sa > sb ? 'a' : 'b'` derivation would have put the
     winner highlight on the LOSER of a shootout-decided tie (level score, winner-first row). */
  const winner = 'a';
  const d = {tag,a,b,sa,sb,winner,mode:'decided',id,pens: pens || ''};
  /* R9 #9/#10 — each half's fixed team colour, precomputed from the bracket data (winner is
     always 'a' by this data set's own [winner, loser, ...] convention); emitColor is what this
     card hands onward once both halves have arrived (#10 — the onward pipe/pulse carries it). */
  const colA = teamColor(a), colB = teamColor(b);
  return {
    winner, sidePort: true, mode:'decided', pulseTracked: true, colA, colB, emitColor: colA,
    tex: faceTexture(560, 350, (g,w,h) => drawMatchFace(g,w,h,d)),
    texCollapsed: faceTexture(224, 140, (g,w,h) => drawMatchFaceCollapsed(g,w,h,d))
  };
}
/* LIVE-DATA state-aware opts: a KO card built from the parsed DOM tie renders per its real state —
   ft -> decided (filled, winner colour); live -> pilot glow + running score; sched/tbd -> empty glass
   (neutral molten amber). A known code is shown; a synthetic __TBD placeholder becomes a "TBD" face. */
const isTBD = (c) => typeof c === 'string' && c.indexOf('__TBD') === 0;
function cardOptsFor(tag, row, state, id, pens, href){
  const [a,b,sa,sb] = row;
  /* R11 — a card is click-through only when RESOLVED (decided or live): those cards show real
     teams and their match page is worth a click. A sched/TBD tie renders as the TBD face and stays
     non-navigable (no dead clicks), so href is threaded only on the ft/live branches. */
  if (state === 'ft') return { ...decidedOpts(tag, a, b, sa, sb, id, pens), href: href || '' };
  if (state === 'live'){
    const d = {tag, a: isTBD(a)?'TBD':a, b: isTBD(b)?'TBD':b, sa, sb, minute:"LIVE", mode:'live', id};
    const colA = teamColor(a), colB = teamColor(b);
    return { mode:'live', sidePort:true, pulseTracked:true, colA, colB, emitColor: (sa>=sb?colA:colB), href: href || '',
      tex: faceTexture(560,350,(g,w,h)=>drawMatchFace(g,w,h,d)),
      texCollapsed: faceTexture(224,140,(g,w,h)=>drawMatchFaceCollapsed(g,w,h,d)) };
  }
  const label = (!isTBD(a) && !isTBD(b)) ? (a + '  v  ' + b) : 'TBD';
  const d = {tag, label, mode:'tbd', id};
  return { mode:'tbd', sidePort:true, pulseTracked:true, colA:GROUP_C, colB:GROUP_C, emitColor:GROUP_C,
    tex: faceTexture(560,350,(g,w,h)=>drawMatchFace(g,w,h,d)),
    texCollapsed: faceTexture(224,140,(g,w,h)=>drawMatchFaceCollapsed(g,w,h,d)) };
}

/* ============================================================================
   GROUP racks — summary-card LOD (turn5 blocker #2, GPT-5.5: "several small
   scorebug cards are still near the edge of legibility rather than collapsing
   into summaries" — this was measured even at the dedicated GROUPS focus
   shot, i.e. showing all 48 at once is ITSELF the smear, not a HOME-only
   problem. Fix: 12 summary cards (one per group, qualifiers highlighted —
   see drawGroupFace) are the ONLY thing ever shown by default, at every
   framing including GROUPS focus. Full 48 never render simultaneously.
   Hovering ONE summary card expands JUST that group's 4 real broadcast
   scorebugs in place; every other group stays collapsed. This is the
   brief's own rule applied literally: "never render a card as an unreadable
   smudge — collapse it into a summary card instead of shrinking it into
   mush." See updateGroupHover() in the tick loop. ============================================================================ */
const groupCards = [];
const GCX = [-15,-9,-3,3,9,15], GCY = [11.0, 7.6];
const GW = 3.0, GH = 1.9;
for (let c = 0; c < 12; c++) {
  const col = c % 6, row = (c/6)|0;
  const x = GCX[col], y = GCY[row];
  const letter = String.fromCharCode(65+c);
  const codes = GROUPS_DATA[c];
  const qualified = codes.map((code) => QUALIFIED.has(code));
  const tex = faceTexture(480, 300, (g,w,h) => drawGroupFace(g,w,h,{letter, codes, qualified}));
  const texCollapsed = faceTexture(160, 100, (g,w,h) => drawGroupFaceCollapsed(g,w,h,{letter}));
  /* R9 #1/#9 — a group card fills from its ONE pulse (not a per-team sum); it represents 4 teams
     at once, so both halves share one molten-gold colour rather than a single team's hue. */
  const card = buildCard(x, y, GW, GH, 0, {tex, texCollapsed, mode:'live', lodFloor: GROUP_LOD_FLOOR, pulseTracked: true, colA: GROUP_C, colB: GROUP_C, emitColor: GROUP_C});
  groupCards.push(card);
}
/* 48 LOD detail cards — hidden until their OWN group is hovered (never more than 4 visible at
   once). cheapGlass:true (no clearcoat) — the per-card cost only matters while shown, and even
   then it's at most 4 at a time now, versus the old "all 48 simultaneously" cost. */
const groupDetail = [];
{
  const offs = [[-0.95,0.62],[0.95,0.62],[-0.95,-0.62],[0.95,-0.62]];
  for (let c = 0; c < 12; c++) {
    const col = c % 6, row = (c/6)|0;
    const cx = GCX[col], cy = GCY[row];
    const letter = String.fromCharCode(65+c);
    const codes = GROUPS_DATA[c];
    codes.forEach((code, bi) => {
      const q = QUALIFIED.has(code);
      const [dx,dy] = offs[bi];
      const tex = faceTexture(320, 220, (g,w,h) => drawTeamFace(g,w,h,{letter, code, name:TEAM[code]||code, qualified:q}));
      const dc = buildCard(cx+dx, cy+dy, 1.45, 0.98, 0, {tex, mode:'team', qualified:q, cheapGlass:true});
      dc.grp.visible = false;
      groupDetail.push(dc);
    });
  }
}
/* an earlier revision: LOD expansion is hover-only now (see the summary-card-LOD comment above groupCards).
   hoveredGroupIdx / updateGroupHover() (defined near the camera/raycaster setup below) own the
   real toggle. setGroupsOpen() is kept as a stub so the existing call sites (stage-button switch,
   pitch-dial reset, the FINAL climax camera cut) still compile and do the sane thing — collapse
   whatever group is pinned open when the user moves to a different framing. */
function setGroupsOpen(open){ collapseAllGroups(); }
let hoveredGroupIdx = -1;
function collapseAllGroups(){
  if (hoveredGroupIdx >= 0) {
    groupCards[hoveredGroupIdx].grp.visible = true;
    for (let k = 0; k < 4; k++) {
      const dc = groupDetail[hoveredGroupIdx*4+k];
      dc.grp.visible = false; dc.revealT = 0; dc.grp.scale.setScalar(1);
    }
    hoveredGroupIdx = -1;
  }
}

/* ============ knockout columns ============ */
const r32 = [], r16 = [], qf = [], sf = [];
for (let i = 0; i < 16; i++) {
  matchSeq++;
  const v = buildCard(-13.5 + i*1.8, 4.6, 1.7, 1.05, 1, cardOptsFor('R32', R32_DATA[i], R32_STATE[i], 'M'+(100+matchSeq), R32_PENS[i], R32_HREF[i]));
  r32.push(v);
}
for (let i = 0; i < 8; i++) {
  matchSeq++;
  const v = buildCard(-11.2 + i*3.2, 1.4, 2.5, 1.55, 2, cardOptsFor('R16', R16_DATA[i], R16_STATE[i], 'M'+(100+matchSeq), R16_PENS[i], R16_HREF[i]));
  r16.push(v);
}
for (let i = 0; i < 4; i++) {
  matchSeq++;
  const v = buildCard(-7.5 + i*5.0, -1.8, 3.8, 2.35, 3, cardOptsFor('QF', QF_DATA[i], QF_STATE[i], 'M'+(100+matchSeq), QF_PENS[i], QF_HREF[i]));
  qf.push(v);
}
/* R9 #9/#10 — SF matches are live/undecided, so there's no "winner" in the data yet; the
   currently-LEADING team's colour stands in for "the team this card is filling" (tie -> 'a'),
   consistent with #9's own wording ("the colour of the team it is filling"). */
function leaderHalf(sa, sb){ return sa >= sb ? 'a' : 'b'; }
for (let i = 0; i < 2; i++) {
  matchSeq++;
  const v = buildCard(i ? 5.2 : -5.2, -5.4, 5.4, 3.3, 4, cardOptsFor('SF', SF_DATA[i], SF_STATE[i], 'M'+(100+matchSeq), SF_PENS[i], SF_HREF[i]));
  sf.push(v);
}

/* THE FINAL — a card too. TBD until the semis resolve; its fluid drains into the REAL trophy.
   Its two halves take SF1's / SF2's currently-leading colour (#9); its own emitColor — the
   colour of the final leg into the trophy (#10) — is the "champion", re-picked randomly between
   the two SF leaders at the start of every set (see START_SET in the pulse engine, below). */
const FINAL_OPTS = (FINAL_STATE === 'sched')
  ? (() => {
      const label = (!isTBD(FINAL_ROW[0]) && !isTBD(FINAL_ROW[1])) ? (FINAL_ROW[0] + '  v  ' + FINAL_ROW[1]) : 'SF1  v  SF2';
      const dF = {tag:'FINAL', mode:'tbd', label, id:'M131'};
      return {tex: faceTexture(680,420,(g,w,h)=>drawMatchFace(g,w,h,dF)), texCollapsed: faceTexture(272,168,(g,w,h)=>drawMatchFaceCollapsed(g,w,h,dF)), mode:'tbd', pulseTracked:true, colA: sf[0].emitColor, colB: sf[1].emitColor, emitColor: sf[0].emitColor};
    })()
  : cardOptsFor('FINAL', FINAL_ROW, FINAL_STATE, 'M131', FINAL_PENS, FINAL_HREF);
const FINAL = buildCard(0, -9.7, 6.4, 3.9, 5, FINAL_OPTS);

/* ============================================================================
   R9 #1 — TOPOLOGY SLOT MAPS. Every knockout DATA row is [teamA, teamB, ...] with teamA always
   the advancing team (winner, by this data set's own convention; for SF, "leader" stands in —
   see leaderHalf() above). slotMap(rows) answers "which card + which half does THIS team code
   feed into", by team code — exactly what the pulse engine (below, once the pipe segs exist)
   needs to route every one of the 12/32/16/8/4/2/1 pulses to the right port. ============ */
function slotMap(rows){
  const m = {};
  rows.forEach((row, i) => { m[row[0]] = {idx:i, half:'a'}; m[row[1]] = {idx:i, half:'b'}; });
  return m;
}
const R32_SLOT = slotMap(R32_DATA);
const R16_SLOT = slotMap(R16_DATA);
const QF_SLOT  = slotMap(QF_DATA);
const SF_SLOT  = slotMap(SF_DATA.map(r => [r[0], r[1]]));

/* OFF-GAS / 3RD PLACE — smaller card, fed from both semis' side ports. an earlier revision: noBottomPort +
   dualSidePort import r3d's loser/off-gas clarity (Grok's outright #1, 92) — the card's own
   face carries the two labelled L(SF1)/L(SF2) inlets, not a floating HUD label elsewhere. */
/* cert fix-before-promote (item 1) — wire the parsed THIRD result through cardOptsFor so a decided
   (or live) third-place play-off renders its real scoreline on the card face, instead of the frozen
   "L(SF1) v L(SF2)" TBD face forever. Mirrors the FINAL_OPTS pattern above: resolved -> real face;
   sched -> the custom two-inlet TBD face. Gated on the parsed THIRD_STATE (an earlier fix — no fabricated
   result). The jar keeps its off-gas identity below (noBottomPort, dualSidePort, fixed VENT_HOT
   pool); only the face texture reflects the real result. THIRD_ROW/STATE/PENS are in the sig, so a
   result landing mid-view remounts and updates the card like every other. */
const ogResolved = (THIRD_STATE === 'ft' || THIRD_STATE === 'live')
  ? cardOptsFor('3RD', THIRD_ROW, THIRD_STATE, 'M130', THIRD_PENS, THIRD_HREF)
  : null;
const dOg = {tag:'3RD', mode:'tbd', label:'L(SF1) v L(SF2)', id:'M130'};
const ogTex = ogResolved ? ogResolved.tex : faceTexture(420, 260, (g,w,h) => drawMatchFace(g,w,h,dOg));
const ogTexCollapsed = ogResolved ? ogResolved.texCollapsed : faceTexture(168, 104, (g,w,h) => drawMatchFaceCollapsed(g,w,h,dOg));
/* R11 — the 3RD card is click-through only when the play-off is resolved (ogResolved carries the
   parsed THIRD href); the TBD jar face stays non-navigable. */
/* an earlier revision championship port — when the 3rd-place play-off is DECIDED, the jar is a DECIDED card like
   every other round: winner emphasis (winner half fills HIGH + glows, loser drains) carried by
   updateCard's own mode:'decided' path, with the two REAL team colours (winner-first parse: winner
   is 'a'). Its hero jar pools + forge below read celebratory BRONZE (the medal), not the old
   off-gas red. Undecided (sched) / in-flight (live) keep the existing off-gas identity. */
const thirdDecided = !!(ogResolved && ogResolved.mode === 'decided');
const OFFGAS = buildCard(8.6, -10.1, 2.4, 1.5, 4, ogResolved
  ? {tex: ogTex, texCollapsed: ogTexCollapsed, mode: ogResolved.mode, winner: ogResolved.winner, noBottomPort:true, dualSidePort:true, pulseTracked:true, colA: ogResolved.colA, colB: ogResolved.colB, emitColor: ogResolved.emitColor, href: ogResolved.href || null}
  : {tex: ogTex, texCollapsed: ogTexCollapsed, mode:'tbd', noBottomPort:true, dualSidePort:true, pulseTracked:true, colA: VENT_HOT, colB: VENT_HOT, emitColor: VENT_HOT, href: null});
/* ============================================================================
   an earlier revision HERO GLASS #1 — the off-gas / 3rd-place JAR. the maintainer: "I will need to see this fix in all
   the 3D digital assets" (the transmission-glass upgrade), on top of the brief's original ask for
   a "smaller off-gassing container." an earlier revision's OFFGAS was a flat card-box; rebuilt here as an actual
   vessel (LatheGeometry profile: base -> bulging belly -> narrowing shoulder -> flared neck) in
   real transmission glass, by replacing only this card's own `hitMesh` (the box "glass" mesh)
   AFTER buildCard() returns — buildCard() itself is byte-for-byte untouched, so no other card in
   the file (all built through the same function) is affected. This is the ADR's hero-only budget
   applied literally: one instance, not a global material swap.
   pulseTracked:true (added to the opts just above) + the one-time fillTarget set below gives the
   jar a persistent, visible pool in VENT_HOT — the SAME red an earlier revision's own comments already named as
   "the shared thread... from the SF card to the off-gas jar" but never actually rendered, because
   the old flat card had no vessel worth filling and was deliberately left empty (an earlier fix's own
   fix). an earlier fix's lesson still applies and is respected here: these two targets are set ONCE, on
   this line, and nothing in the pulse engine, PULSE_TRACKED_CARDS (which OFFGAS is deliberately
   NOT added to) or the trophy climax sim ever touches them again — this is a fixed pool, not a
   simulation variable. The glass-poc lesson ("something must sit BEHIND transmissive glass for it
   to read") is what makes this worth doing at all: the existing fluidA/fluidB meshes (unchanged,
   still the two independent loser-stream chambers) now sit inside real refractive glass instead
   of a flat alpha-blended pane. */
OFFGAS.fillTargetA = 0.42; OFFGAS.fillTargetB = 0.34;
{
  const jarProfile = [
    [0.02,-0.75], [0.95,-0.70], [1.18,-0.55], [1.28,-0.20], [1.22, 0.05],
    [0.95, 0.25], [0.55, 0.42], [0.50, 0.58], [0.60, 0.68], [0.50, 0.75]
  ];
  const jarPts = jarProfile.map(([r,y]) => new THREE.Vector2(r,y));
  const jarGeo = new THREE.LatheGeometry(jarPts, 28);
  /* an earlier fix-safe — hue lives in the wall's own pale-glass tint (not clearcoat); no emissive on
     this shell at all, so it can never hit the ACES clip. */
  const jarGlassMat = new THREE.MeshPhysicalMaterial({color:0xc8e0ff, metalness:0, roughness:0.06, transmission:1, ior:1.5, thickness:0.6, transparent:false, opacity:1, clearcoat:0.25, clearcoatRoughness:0.3, side:THREE.FrontSide});
  regMat(jarGlassMat, 4);
  OFFGAS.hitMesh.geometry.dispose();
  OFFGAS.hitMesh.geometry = jarGeo;
  OFFGAS.hitMesh.material.dispose();
  OFFGAS.hitMesh.material = jarGlassMat;
  /* the box's straight-edge wireframe (EdgesGeometry of a BoxGeometry, built inside buildCard) reads
     as a ghost cube around a round vessel — hidden, not deleted, so buildCard()'s construction order
     needs no conditional and every other card's edges are untouched. */
  const offEdges = OFFGAS.grp.children.find(o => o.type === 'LineSegments');
  if (offEdges) offEdges.visible = false;
  /* an earlier revision CODING ERROR, caught by pixel-sampling and fixed here (logged per the mandate, an earlier fix) —
     three.js's transmissive render pass only captures OPAQUE geometry into its background texture;
     buildCard()'s own fluidA/fluidB (matA/matB, transparent:true for the an earlier fix empty-glass gate)
     are invisible to that capture, so the jar's transmission surface showed the dark room behind
     it instead of the loser fluid, even though fillTargetA/B above are genuinely nonzero. Fixed
     the way distCore/pumpCore already prove works: two small OPAQUE emissive pools (one per loser
     stream, matching fluidA/fluidB's own x-offsets) sit inside the jar purely so the transmission
     capture has something opaque to refract — the original translucent fluidA/fluidB slabs are
     left completely untouched underneath them (still an earlier fix-gated, still glowing), so this is a pure
     addition, not a substitution. Sized once from the FIXED fillTargetA/B set above (this pool
     never animates — an earlier fix's own lesson, a static target, not a sim variable) and kept safely
     inside the jarProfile's own radius at every height it spans (checked against the profile
     points above), so it never pokes past the glass silhouette. */
  if (thirdDecided) {
    /* an earlier revision championship port — celebratory BRONZE pools (the medal), ACES-safe (an earlier fix: hue lives in
       the emissive, kept below the clip; no clearcoat). The WINNER's half glows the hotter bronze
       (winner is 'a' by the winner-first parse). Base-anchored cylinders (geometry translated so the
       base sits at local y=0) scaled on Y by the card's eased fill (updateThirdPools, in tick), so
       the jar fills with winner emphasis. Radius 0.36 at x-offset ±0.5 stays inside the jarProfile
       silhouette at every height it spans (an earlier fix — a fill must stay inside its vessel's extent). */
    const BRONZE = new THREE.Color(0xcd7f32), BRONZE_HOT = new THREE.Color(0xffb14a);
    const poolMatWin  = new THREE.MeshStandardMaterial({color:0x2a1806, emissive:BRONZE_HOT.getHex(), emissiveIntensity:1.35, roughness:0.34});
    const poolMatLose = new THREE.MeshStandardMaterial({color:0x241505, emissive:BRONZE.getHex(),     emissiveIntensity:1.05, roughness:0.42});
    regMat(poolMatWin, 4); regMat(poolMatLose, 4);
    const POOL_MAX_H = 0.42 * OFFGAS.h * 0.94;
    const mkPool = (mat, xoff, zoff) => {
      const geo = new THREE.CylinderGeometry(0.36, 0.36, POOL_MAX_H, 14);
      geo.translate(0, POOL_MAX_H/2, 0);            // base at local y=0 -> scale.y grows the top only
      const m = new THREE.Mesh(geo, mat);
      m.position.set(xoff, -OFFGAS.h/2 + 0.07, zoff);
      m.scale.y = 0.0001;
      OFFGAS.grp.add(m);
      return m;
    };
    OFFGAS.poolA = mkPool(OFFGAS.winner === 'a' ? poolMatWin : poolMatLose, -0.5, -0.05);
    OFFGAS.poolB = mkPool(OFFGAS.winner === 'a' ? poolMatLose : poolMatWin,  0.5,  0.05);
  } else {
    const offPoolMat = new THREE.MeshStandardMaterial({color:0x3a0d02, emissive:VENT_HOT.getHex(), emissiveIntensity:1.35, roughness:0.4});
    regMat(offPoolMat, 4);
    const offPoolHA = Math.max(0.06, OFFGAS.fillTargetA * OFFGAS.h * 0.94);
    const offPoolHB = Math.max(0.06, OFFGAS.fillTargetB * OFFGAS.h * 0.94);
    /* radius 0.38, x-offset 0.5: checked against jarProfile above at the pool's lowest point
       (y=-0.68local, jarProfile r~=0.98) — 0.5+0.38=0.88 stays inside with margin at every height
       the pool spans (the profile only gets wider moving up from there), so it never pokes past the
       glass silhouette (the an earlier fix lesson: a fill must stay inside its vessel's own measured extent). */
    const offPoolA = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, offPoolHA, 14), offPoolMat);
    offPoolA.position.set(-0.5, -OFFGAS.h/2 + 0.07 + offPoolHA/2, -0.05);
    OFFGAS.grp.add(offPoolA);
    const offPoolB = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, offPoolHB, 14), offPoolMat);
    offPoolB.position.set(0.5, -OFFGAS.h/2 + 0.07 + offPoolHB/2, 0.05);
    OFFGAS.grp.add(offPoolB);
  }
}

/* ============ the REAL trophy (lib/artifacts.js) — the terminus. Fills to 75%, erupts. ============ */
const troHost = new THREE.Group();
troHost.position.set(0, -12.4, 0.5);
troHost.scale.setScalar(1.55);
scene.add(troHost);
const tro = buildTrophy(THREE, GLTFLoader, {
  parent: troHost, glbBase: '/img/trophy/',
  onReady: w => { if (String(w).endsWith('fail')) console.warn('[R7F] trophy artifact failed to load:', w); },
  onBounds: b => buildTrophyFill(b)
});
const poolMat = new THREE.MeshStandardMaterial({color:0x8a3600, emissive:0xff8c2a, emissiveIntensity:0.35, roughness:0.4, transparent:true, opacity:0.55});
const pool = new THREE.Mesh(new THREE.CircleGeometry(2.1, 30), poolMat);
/* an earlier revision fix: an earlier revision's hardcoded pool Y (-13.75) sat ~2.6 units ABOVE the trophy's actual measured base
   (troHost.position.y + trophyMinY*troHost.scale.y = -12.4 + -2.55*1.55 = -16.35) — invisible as a
   problem while the fill's only "proof" was an offset side vessel, but once the trophy itself
   became the fill indicator this floating puddle read as a mysterious detached amber disc
   mid-stem. Anchored to the same formula the trophy body itself uses. */
pool.rotation.x = -Math.PI/2; pool.position.set(0, troHost.position.y + (-2.55)*troHost.scale.y + 0.05, 0.9); pool.scale.setScalar(0.16);
scene.add(pool);

/* ============================================================================
   TURN6 DEFECT #1 — "the trophy fill reads as an adjacent measuring cylinder,
   not the trophy filling." Root cause named exactly in _TURN6.md: the Rodin
   trophy GLB is solid with no hollow interior, and every prior build's fluid
   evidence was a SEPARATE glass tank offset in X beside it (an earlier revision's own
   `vesselGlass` at VX=-3.3, replaced below) — legible, but unequivocally
   "next to the trophy," not "in" it.
   the maintainer's decision, verbatim: "Trophy fills -> erupts at 75%." Fix per the
   brief's own option 3 ("give the cup a subtle glass insert so you are
   looking INTO the trophy"), combined with option 1 ("measure the GLB's
   bounds at load"): buildTrophy() now calls opts.onBounds() with the REAL
   measured local box the moment the GLB loads (lib/artifacts.js addition,
   additive/optional — every other mockup on disk is unaffected). This build
   uses those numbers to shape a goblet-profile insert ON THE TROPHY'S OWN
   CENTRAL AXIS (x=0, z=0 — zero lateral offset from the model, not beside
   it), sized to the model's own measured width/height: a thin glass shell
   (so you see INTO the trophy) around a solid molten-fluid core whose level
   is a real THREE.Plane world-space clip — the exact same "rising level,
   fixed vessel" physics the match cards use — so the meniscus climbs inside
   a shape that sits exactly where the trophy sits, on the trophy's own
   silhouette, glowing out through the gaps in the gold. A fan sees the World
   Cup itself lit from within by rising liquid, with a painted ring marking
   75% ON the trophy's own form, not a gauge parked next to it. ============================================================================ */
const trophyFillHost = new THREE.Group(); scene.add(trophyFillHost); // world-positioned to MATCH troHost exactly
trophyFillHost.position.copy(troHost.position);
trophyFillHost.scale.copy(troHost.scale);
/* [radiusFrac 0..1, heightFrac 0..1] — a SLENDER column, deliberately conservative (max frac 1.0),
   because the Rodin trophy GLB is a SOLID, OPAQUE sculpt with no real hollow interior or gaps: a
   profile that is wide enough to hug the model's full silhouette will, at the heights where the
   real model is actually narrower than its own overall bounding box (the stem, the neck under the
   globe), poke PAST the gold — which is exactly how an earlier revision's offset vessel and this build's own first
   attempt both ended up reading as a foreign shape laid over/beside the trophy instead of the
   trophy itself. Staying narrow and centered on the model's own axis is what keeps the level inside
   the silhouette at every height actually measured. */
const GOBLET_PROFILE = [
  [0.50,0.00],[0.46,0.06],[0.30,0.16],[0.24,0.30],[0.30,0.40],
  [0.48,0.52],[0.70,0.63],[0.88,0.73],[1.00,0.78],[0.78,0.85],[0.40,0.93],[0.05,1.00]
];
function profileRadiusFrac(hFrac){
  const pts = GOBLET_PROFILE;
  for (let i = 1; i < pts.length; i++) {
    if (hFrac <= pts[i][1] || i === pts.length-1) {
      const [r0,h0] = pts[i-1], [r1,h1] = pts[i];
      const k = h1 > h0 ? THREE.MathUtils.clamp((hFrac-h0)/(h1-h0), 0, 1) : 0;
      return THREE.MathUtils.lerp(r0, r1, k);
    }
  }
  return pts[pts.length-1][0];
}
let trophyMinY = -2.55, trophyMaxY = 0.85, trophyRadius = 0.24; // sane defaults so the fill exists even before/if the GLB bounds callback never fires
let trophyGlass=null, trophyFluid=null, trophyGlow=null, trophyMeniscus=null, trophyMenMat=null, trophyGlowMat=null, trophyFluidMat=null, clipPlane=null;
function buildTrophyFill(bounds){
  trophyMinY = bounds.minY; trophyMaxY = bounds.maxY;
  /* half the model's OWN measured width/depth, then pulled well in again — comfortably inside even
     the model's narrowest cross-section, on its own central axis (zero X/Z offset from the model
     itself, unlike an earlier revision's VX=-3.3 side tank). */
  trophyRadius = Math.max(0.16, Math.min(bounds.width, bounds.depth) * 0.5 * 0.34);
  const H = trophyMaxY - trophyMinY;
  const segCount = 40;
  const pts2d = [];
  for (let i = 0; i <= segCount; i++) {
    const hf = i/segCount;
    pts2d.push(new THREE.Vector2(Math.max(0.015, profileRadiusFrac(hf)) * trophyRadius, trophyMinY + hf*H));
  }
  const latheGeo = new THREE.LatheGeometry(pts2d, 32);

  renderer.localClippingEnabled = true;
  clipPlane = new THREE.Plane(new THREE.Vector3(0,-1,0), 0);

  /* Every layer here renders with depthTest:false. The trophy body itself is solid/opaque, so a
     mesh that respects normal depth testing would simply vanish behind it for almost its whole
     height — defeating "you can see it filling." Skipping the depth test instead makes this read
     as a soft internal glow rising THROUGH the gold (the level is always legible), which — combined
     with the conservative radius above so it never draws outside the model's own outline — is the
     robust version of brief option 3 ("a subtle glass insert so you are looking INTO the trophy")
     that actually survives a solid GLB, instead of a hard-edged shape that can either vanish
     (occluded) or poke out (reading as a separate object) depending on camera angle. */
  const glassMat = new THREE.MeshPhysicalMaterial({color:0xa8d4ff, metalness:0, roughness:0.18, transparent:true, opacity:0.10, clearcoat:0.6, clearcoatRoughness:0.2, side:THREE.DoubleSide, depthWrite:false, depthTest:false});
  regMat(glassMat, 5);
  trophyGlass = new THREE.Mesh(latheGeo, glassMat);
  trophyGlass.renderOrder = 1;
  trophyFillHost.add(trophyGlass);

  trophyFluidMat = new THREE.MeshBasicMaterial({color:0x2a1608, transparent:true, opacity:0.55, side:THREE.DoubleSide, depthWrite:false, depthTest:false, clippingPlanes:[clipPlane]});
  trophyFluid = new THREE.Mesh(latheGeo, trophyFluidMat);
  trophyFluid.renderOrder = 2;
  trophyFillHost.add(trophyFluid);
  trophyGlowMat = new THREE.MeshBasicMaterial({color:0xffab4a, transparent:true, opacity:0, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false, depthTest:false, clippingPlanes:[clipPlane]});
  trophyGlow = new THREE.Mesh(latheGeo, trophyGlowMat);
  trophyGlow.scale.set(0.8, 1, 0.8); // X/Z only — the lathe profile is NOT centered on y=0 (it runs trophyMinY..trophyMaxY), so a uniform scale would also shift it vertically off the fluid's own clip level
  trophyGlow.renderOrder = 3;
  trophyFillHost.add(trophyGlow);

  trophyMenMat = new THREE.MeshBasicMaterial({color:0xfff0c8, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false});
  trophyMeniscus = new THREE.Mesh(new THREE.CircleGeometry(1, 24), trophyMenMat);
  trophyMeniscus.rotation.x = -Math.PI/2;
  trophyMeniscus.renderOrder = 4;
  trophyFillHost.add(trophyMeniscus);

  /* R9 #2 — the marked 75% ring + its label are REMOVED. Nothing waits on a percentage any more;
     the trophy fills as pulses arrive and erupts the instant the mass-32 pulse reaches it (#3). */
}
const trophyColScratch = new THREE.Color();

const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.2, 10), darkMetal);
spout.position.set(FINAL.x+2.3, FINAL.y-1.3, 0.3); spout.rotation.z = 0.7; scene.add(spout);
const matchGrp = new THREE.Group();
const matchStick = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.75, 6),
  new THREE.MeshStandardMaterial({color:0xc9a15f, roughness:0.9}));
matchGrp.add(matchStick);
const matchTip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
  new THREE.MeshStandardMaterial({color:0x3a1005, emissive:0xffc23a, emissiveIntensity:3}));
matchTip.position.y = 0.43; matchGrp.add(matchTip);
const flameSprite = new THREE.Sprite(new THREE.SpriteMaterial({map:nebulaTex('rgba(255,190,80,0.9)','rgba(0,0,0,0)'), blending:THREE.AdditiveBlending, depthWrite:false}));
flameSprite.scale.set(0.58, 0.8, 1); flameSprite.position.y = 0.62; matchGrp.add(flameSprite);
const MATCH_HOME = new THREE.Vector3(FINAL.x+2.8, FINAL.y-0.3, 0.3);
matchGrp.position.copy(MATCH_HOME); scene.add(matchGrp);

/* ============================================================================
   ROW LABELS — TURN7 FIX #3 (the label half of it). These floating captions read the
   same "48 teams funnelling to one champion" story the LOD-collapsed cards carry, so they were
   measured too: at HOME's distance (~28-38 world units to the label band near the left wall) the
   OLD fixed-world-scale sprite text rendered at roughly the same ~11-19px cap-height as the card
   text it sits beside — i.e. it was ALSO marginal, not a safety net for the rows whose per-card text
   now hides at HOME (see GLYPH_HIDE_PX, declared up near buildCard). Fix: every label optionally
   takes a `targetPx` — a MINIMUM on-screen pixel height enforced every frame in tick() by re-deriving
   the label's world scale from the live camera distance (autoLabels, below; TURN8: now a Group's
   uniform scale, not a Sprite's), the same "counteract perspective, hold a
   floor" trick the card LOD already uses for glass boxes. A label given a targetPx is therefore
   confidently legible at ANY distance, including HOME — it is the guaranteed-readable summary the
   brief asks for on the rows whose individual match cards are too many/small to read there (R32,
   R16, OFF-GAS), and now also carries a live count so the row still tells the tournament's shape
   even with its per-card type hidden. */
const autoLabels = [];
/* TURN8 (Gemini, who scored r7f the round's closest-to-done, 92): "summary labels... look like 2D
   text overlays and are not well integrated into the 3D 'glass wall' aesthetic" -> redesign as
   physical etched-glass plaques. A Sprite always billboards to face the camera, which is exactly
   what read as "a HUD caption floating in front of the room" — this build replaces it with a real
   Group: a thin frosted glass backing plate (MeshPhysicalMaterial, a soft edge trim) plus the text
   plane, BOTH fixed to face +z — the room's own glass-wall orientation, never the camera — so it
   sits IN the scene as an etched panel, not on top of it. The same "hold a minimum on-screen pixel
   height" trick (autoLabels, used below in tick()) still applies, now via a single uniform
   grp.scale instead of a Sprite's w/h scale, so legibility at HOME is unaffected by the swap. */
function label(text, x, y, scale=1, targetPx=null){
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  /* TURN7 — some labels now carry a live count ("ROUND OF 32 · 16 DECIDED") and run longer than
     the old bare stage names; shrink to fit the canvas instead of clipping off its right edge. */
  let fpx = 44;
  g.font = '600 ' + fpx + 'px "Avenir Next", "Segoe UI", sans-serif';
  while (g.measureText(text).width > 486 && fpx > 24) {
    fpx -= 1;
    g.font = '600 ' + fpx + 'px "Avenir Next", "Segoe UI", sans-serif';
  }
  const tw = g.measureText(text).width;
  g.fillStyle = 'rgba(195,225,255,0.95)';
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(90,160,255,0.75)'; g.shadowBlur = 14;
  g.fillText(text, 14, 48);

  const rw = Math.min(tw+28, 500);
  const baseW = 6.2*scale, baseH = 1.16*scale;
  const plateW = baseW * (rw/512), plateH = baseH*0.74;

  const grp = new THREE.Group();
  const plateMat = new THREE.MeshPhysicalMaterial({color:0x081018, metalness:0.05, roughness:0.4, transparent:true, opacity:0.52, clearcoat:0.35, clearcoatRoughness:0.4, side:THREE.DoubleSide, depthWrite:false});
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(plateW, plateH), plateMat);
  plate.position.set(plateW/2, 0, -0.015);
  grp.add(plate);
  const plateEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(plateW, plateH)), frameLineMat);
  plateEdges.position.set(plateW/2, 0, 0.001);
  grp.add(plateEdges);
  const textMatL = new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c), transparent:true, depthWrite:false});
  const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(baseW, baseH), textMatL);
  textPlane.position.set(baseW/2, 0, 0.01);
  grp.add(textPlane);

  grp.position.set(x, y, 0.4);
  scene.add(grp);
  if (targetPx) autoLabels.push({grp, targetPx, baseH});
  return grp;
}
label('GROUP STAGE · 48 TEAMS', -19.8, 12.4, 0.9, 30);
label('ROUND OF 32 · 16 DECIDED', -19.8, 4.6, 0.9, 30);
label('ROUND OF 16 · 8 DECIDED', -19.8, 1.4, 0.9, 30);
label('QUARTER-FINALS · 4 DECIDED', -19.8, -1.8, 0.9, 30);
label('SEMI-FINALS · LIVE', -19.8, -5.4, 0.9, 30);
label('THE FINAL', -19.8, -9.7, 1.0, 32);
label('THIRD-PLACE PLAY-OFF', 10.8, -9.05, 0.55, 24);
/* an earlier revision: L(SF1)/L(SF2) labels moved onto the off-gas card's OWN face (see buildCard dualSidePort) —
   no floating duplicate HUD labels here, per turn4 fix 3. The '75% LINE' label itself is emitted
   by buildTrophyFill() above once the GLB's real bounds arrive, since its position depends on the
   measured trophy height. Distributor moved (TURN7 fix #2) to sit above the group row — name it
   there, at its own new PORT_Y, not the old mid-bracket position. */
label('DISTRIBUTOR', -6.6, PORT_Y+0.55, 0.4, 22);

/* ============================================================================
   PIPES — TRANSPARENT walls with the molten fluid visibly flowing INSIDE
   (the maintainer's brief: "transparent plastic pipes" — no build had done this yet).
   Every addTube() call now builds TWO layers on the same curve: an outer
   translucent/clearcoat wall (an earlier revision's real vertex-displacement bulge lives
   here, preserved) and an inner, always-lit amber core tube (~40% radius)
   that reads as the flowing fluid through the glass, independent of whether
   a slug happens to be passing.
   CARD-LEGIBILITY FIX: turn-2's connectors sagged in FRONT of the cards
   (positive z) at a radius big enough to occlude type. Every inter-card
   connector now dips BEHIND the cards (negative z) between rows/cards —
   visible only in the gaps, never crossing a face — and base radii are
   substantially thinner; the bulge still gives visual punch as slugs pass.
   ============================================================================ */
const DEPTH0 = -40, DEPTH1 = 2;
const dk = z => Math.pow(THREE.MathUtils.clamp((z - DEPTH0)/(DEPTH1 - DEPTH0), 0, 1), 1.35);

/* ============================================================================
   THE CARD PLANE INVARIANT — turn5 blocker #1. Flagged three turns running
   ("pipes still cross card faces") and hand-routed three times, because
   hand-routing is a per-pipe PROMISE, not a guarantee: a Catmull-Rom spline
   can overshoot past its own control points *between* them, so even control
   points that all sit comfortably behind the cards can still produce a
   rendered tube vertex that pokes in front. All three review models
   independently prescribed the same structural cure (Grok: "lock pipe
   routing behind card plane except at ports"; GPT-5.5: a distributor spine
   behind each stage with short vertical drops; Gemini: routing that never
   obscures type "from the primary viewing angles"). This build makes it a
   property of the geometry itself, not of any curve's authored control
   points:
     CARD_PLANE_Z = 0 — every card group sits at world z=0 (buildCard:
       `grp.position.set(x, y, 0)`), and every port stub (bottom inlet,
       bottom winner outlet, side loser vent) is built at LOCAL z≈0 on its
       card — so z=0 IS the plane of ports.
     PIPE_BEHIND_Z = -0.7 — comfortably behind the back face of the deepest
       card in this file (THE FINAL: depth 0.858 → back face at -0.429; a
       -0.7 floor clears every card's glass box with margin).
   CardPlaneCurve wraps any THREE.Curve and clamps the Z of every SAMPLED
   POINT (not the authored control points — the actual vertices TubeGeometry
   consumes) to PIPE_BEHIND_Z, except within a short ramp at each end of the
   curve's parameter range, where the ceiling relaxes linearly back up to
   CARD_PLANE_Z so the tube can still reach its two ports — and even inside
   that ramp the ceiling only ever reaches the true (unclamped) authored Z
   exactly AT the endpoint (t=0 or t=1), i.e. the port itself. Every other
   sampled point on every pipe in this scene is provably <= CARD_PLANE_Z.
   addTube() (below) applies this wrap UNCONDITIONALLY to whatever curve it
   is given — there is no call site that can opt out, so a future pipe added
   here without reading this comment still inherits the invariant. This is
   what "impossible by construction" means: the geometry sampler enforces it,
   not the person authoring control points.
   ============================================================================ */
const CARD_PLANE_Z = 0;
const PIPE_BEHIND_Z = -0.7;
const PORT_RAMP = 0.07; // fraction of a curve's parameter length, at EACH end, during which the Z ceiling relaxes from PIPE_BEHIND_Z back toward the port
class CardPlaneCurve extends THREE.Curve {
  constructor(inner) { super(); this.inner = inner; this.isCardPlaneCurve = true; }
  getPoint(t, target = new THREE.Vector3()) {
    this.inner.getPoint(t, target);
    const dEnd = Math.min(t, 1 - t); // parameter-distance from the nearer end (0 = exactly at a port)
    if (dEnd >= PORT_RAMP) {
      target.z = Math.min(target.z, PIPE_BEHIND_Z);               // mid-pipe: hard clamp, always behind, no exceptions
    } else if (dEnd > 0) {
      const k = dEnd / PORT_RAMP;                                  // 0 at the port .. 1 at the ramp's far edge
      target.z = Math.min(target.z, THREE.MathUtils.lerp(CARD_PLANE_Z, PIPE_BEHIND_Z, k));
    }
    // dEnd === 0 (t===0 or t===1 exactly): untouched — this IS the port, by definition <= the plane already.
    return target;
  }
}
const segs = {};
const tmpCenter = new THREE.Vector3();
function addTube(name, curve, radius, tubularSegs=48, stage=0, tubeOpts){
  /* R9 CHANGE #10 — reintroduces an earlier revision/r8d's optional wall/core colour override (dropped when this
     file was ported from r8f), as an additive 6th param so every existing call site (which never
     passes it) is byte-for-byte unaffected. Used below on the legs that carry exactly ONE team's
     fluid — the *_out_ stub each card emits once it has a winner — so the onward line persistently
     reads that team's colour, not just for the instant a pulse passes through it. */
  tubeOpts = tubeOpts || {};
  /* every pipe passes through the card-plane clamp here, unconditionally — see the invariant
     comment above. No addTube() call in this file can put a pipe in front of a card. */
  curve = curve.isCardPlaneCurve ? curve : new CardPlaneCurve(curve);
  const pts = curve.getPoints(12);
  let kM = 0; for (const p of pts) kM += dk(p.z); kM /= pts.length;
  /* TURN7 FIX #2 (the definition half): "pipes should gain definition as they traverse from the
     rear to the fore" (note 3) was measured present but "not clearly visible" on an earlier revision/an earlier revision — same dk()
     mechanism, too narrow a swing to read as more than a faint shading. Widened materially: a rear
     pipe (kM~0, near the pot) now renders barely a third the radius of a foreground pipe (kM~1, at
     the card wall) instead of roughly half — an unmistakable taper, not a shading gradient. */
  const r = radius * (0.26 + 1.68*kM);
  const RADIAL = 14;
  const geo = new THREE.TubeGeometry(curve, tubularSegs, r, RADIAL, false);
  const posAttr = geo.attributes.position;
  const basePos = posAttr.array.slice();
  const { tubularSegments, radialSegments } = geo.parameters;
  const ringN = tubularSegments + 1, vertsPerRing = radialSegments + 1;
  const centers = new Float32Array(ringN*3);
  for (let i = 0; i < ringN; i++) {
    curve.getPointAt(i/tubularSegments, tmpCenter);
    centers[i*3]=tmpCenter.x; centers[i*3+1]=tmpCenter.y; centers[i*3+2]=tmpCenter.z;
  }
  const dirs = new Float32Array(basePos.length);
  for (let i = 0; i < ringN; i++) {
    const cx=centers[i*3], cy=centers[i*3+1], cz=centers[i*3+2];
    for (let j = 0; j < vertsPerRing; j++) {
      const idx = i*vertsPerRing + j;
      const vx = basePos[idx*3]-cx, vy = basePos[idx*3+1]-cy, vz = basePos[idx*3+2]-cz;
      const len = Math.hypot(vx,vy,vz) || 1;
      dirs[idx*3]=vx/len; dirs[idx*3+1]=vy/len; dirs[idx*3+2]=vz/len;
    }
  }
  const col = new Float32Array(posAttr.count*3);
  for (let i = 0; i < posAttr.count; i++) {
    const b = 0.14 + 0.86*dk(posAttr.getZ(i));
    col[i*3] = b; col[i*3+1] = b; col[i*3+2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  /* an earlier revision: the outer wall reads thin-wire when its opacity floor is too low near the pot — turn4 fix
     2 ("not wires, not spaghetti" — a real tube has a visible wall at every depth). Raised floor and
     ceiling, plus a touch more clearcoat, so the wall itself is always legible as PLASTIC, with the
     molten core (below) doing the "fluid inside" half of the read.
     TURN7 FIX #2: opacity/vertex-color swing widened further still (0.06->0.72, vs the prior
     0.15->0.61) — a rear pipe now reads as a faint, hazy thread genuinely receding into the room's
     fog, where a foreground pipe reads as a solid, opaque, well-lit wall. The two ends of a single
     pipe should look like different objects; that is the "unmistakable" bar. */
  const mat = new THREE.MeshPhysicalMaterial({
    color: tubeOpts.wallColor || 0xbfe2ff, vertexColors:true, metalness:0,
    roughness:0.34 - 0.20*kM, transparent:true, opacity:0.045 + 0.70*kM,
    clearcoat:0.85, clearcoatRoughness:0.30 - 0.18*kM, depthWrite:false
  });
  const matReg = regMat(mat, stage);
  const mesh = new THREE.Mesh(geo, mat);
  /* an earlier revision — the invariant's SECOND enforcement layer. The Z-clamp above guarantees pipes are
     genuinely positioned behind the card plane, but under the FINAL view's low, steep camera
     (looking up across the whole rig to keep the trophy's boil in frame) a long-haul pipe far in
     Z can still land on the SAME screen pixel as a card that sits between it and the camera —
     and since neither the pipe wall/core nor a card's fluid/glass/text write depth (all
     `depthWrite:false`, needed so a card's own fluid+glass+text layer correctly over each other),
     Three.js resolves overlapping transparent fragments by renderOrder/paint order, not a true
     per-pixel depth test. So: every pipe mesh is pinned to renderOrder -1, strictly below every
     card layer (buildCard's lowest is fluid at 1, text is 5) — a pipe can therefore never be the
     last thing painted at a pixel a card also occupies. Combined with the Z-clamp, this is belt
     and suspenders: pipes are both genuinely behind AND, even in a coincidental screen-space
     overlap, always lose the paint order to card type. */
  mesh.renderOrder = -1;
  scene.add(mesh);

  /* the molten core — same curve, thinner, always visible through the transparent wall.
     R9 CHANGE #10: tubeOpts.coreColor lets a specific run carry a team's colour at full
     saturation here (kept plain MeshBasicMaterial + additive blending, same as before — no
     emissiveIntensity multiplier involved, so this is not subject to the ACES cream-clip trap
     that burned earlier builds above ~1.7 emissive). */
  const coreMat = new THREE.MeshBasicMaterial({color: tubeOpts.coreColor || 0xffab4a, transparent:true, opacity:0.26 + 0.68*kM, blending:THREE.AdditiveBlending, depthWrite:false});
  const coreMatReg = regMat(coreMat, stage);
  const coreGeo = new THREE.TubeGeometry(curve, Math.max(10, Math.round(tubularSegs*0.5)), r*0.46, 7, false);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.renderOrder = -1;
  scene.add(core);

  const entry = {
    curve, len:curve.getLength(), radius:r, stage,
    posAttr, basePos, dirs, tubularSegments, vertsPerRing,
    mesh, core,   /* an earlier revision — kept so removeTube() (below) can retire a tube whose route is only
      known once a GLB's measured anchors arrive (the hood's duct exit) without leaking meshes,
      geometries or stageReg entries. */
    mat, coreMat, matReg, coreMatReg   /* R9 #10 — kept so a leg whose colour is decided at
      RUNTIME (the final's champion, picked fresh each set) can be re-tinted after construction —
      matReg/coreMatReg are the stageReg snapshots applyGray() reads, so retintTube() (below)
      updates both the live material AND its snapshot, or the next stage-cut redraw would stomp
      the new colour back to whatever was current at build time. */
  };
  if (name) segs[name] = entry;
  return mesh;
}
/* R9 #10 — re-tint an already-built tube's wall+core AND its stageReg snapshot (matReg/coreMatReg
   — see the note in addTube's entry above for why the snapshot has to move too, not just the live
   material). Only finalDrain needs this: it is built neutral at init and re-tinted to the REAL
   champion's colour once the parsed final is decided (buildLegPlan's FINAL_STATE gate — the
   mockup's per-set coin-flip is long gone, an earlier fix). */
function retintTube(entry, wallColor, coreColor){
  entry.mat.color.copy(wallColor);
  entry.matReg.color.copy(wallColor); entry.matReg.gray.copy(grayOf(wallColor));
  entry.coreMat.color.copy(coreColor);
  entry.coreMatReg.color.copy(coreColor); entry.coreMatReg.gray.copy(grayOf(coreColor));
}
function resetBulge(entry){
  entry.posAttr.array.set(entry.basePos);
  entry.posAttr.needsUpdate = true;
}
function applyBulge(entry, tParam, gain){
  const ringF = THREE.MathUtils.clamp(tParam, 0, 1) * entry.tubularSegments;
  const WIN = 5;
  const i0 = Math.max(0, Math.floor(ringF-WIN)), i1 = Math.min(entry.tubularSegments, Math.ceil(ringF+WIN));
  const vpr = entry.vertsPerRing, arr = entry.posAttr.array, base = entry.basePos, dirs = entry.dirs;
  for (let i=i0;i<=i1;i++){
    const dist = Math.abs(i-ringF)/WIN;
    if (dist>=1) continue;
    const g = gain*(1-dist*dist);
    for (let j=0;j<vpr;j++){
      const idx=i*vpr+j, k=idx*3;
      const bx=base[k],by=base[k+1],bz=base[k+2];
      const dx=dirs[k],dy=dirs[k+1],dz=dirs[k+2];
      const curProj = (arr[k]-bx)*dx + (arr[k+1]-by)*dy + (arr[k+2]-bz)*dz;
      if (g > curProj) { arr[k]=bx+dx*g; arr[k+1]=by+dy*g; arr[k+2]=bz+dz*g; }
    }
  }
  entry.posAttr.needsUpdate = true;
}
/* an earlier revision — retire a named tube built by addTube(): remove + dispose both meshes AND splice its two
   regMat() snapshots out of stageReg (an earlier fix's lesson runs both ways — a stale registry entry keeps
   writing to a disposed material on every applyGray()). Needed because the potPump run's true
   geometry is only known once the hood GLB's measured duct anchor arrives (async). */
function removeTube(name){
  const e = segs[name]; if (!e || !e.mesh) return;
  scene.remove(e.mesh); e.mesh.geometry.dispose();
  scene.remove(e.core); e.core.geometry.dispose();
  for (let i = stageReg.length-1; i >= 0; i--) {
    if (stageReg[i].mat === e.mat || stageReg[i].mat === e.coreMat) stageReg.splice(i, 1);
  }
  e.mat.dispose(); e.coreMat.dispose();
  delete segs[name];
}
const cr = pts => new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
/* ============================================================================
   POT -> HOOD -> PUMP -> DISTRIBUTOR — the hood rework (the maintainer: "the hood is actually what is
   connected to all the pipes"; "the molten liquid should be spurted from the pot in one go up to
   the hood and then out to the distributor"). an earlier revision/r8f ran the potPump tube pot->pump directly, so
   the fluid teleported PAST the hood; now the toDist route is, in order:
     1. 'spurt'    pool -> UP into the hood's intake mouth — OPEN AIR, no tube mesh (a spurt, and
                   the pipes belong to the hood, not the pot). The mass-12 pulse rides it visibly.
     2. 'hoodPass' intake -> throat -> duct exit, INSIDE the hood — no tube, and the pulse mesh is
                   hidden while on it (hideInside): the mass visibly disappears INTO the aperture
                   while the hood's own interior gather-glow (cau.hoodReceive, called on entry with
                   the exact real-seconds hold) does the "working hopper" read.
     3. 'potPump'  duct exit -> pump — the first visible PIPE, leaving the hood's side duct.
     4. 'pumpDist' pump -> distributor (unchanged).
   All three anchors come from cau.potMouth()/hoodIntake()/hoodDuctExit() — measured from the
   loaded GLBs by lib/artifacts.js and recomputed in world space on every call (an earlier fix; the GLBs load
   async and cauHost scales the group). Until both GLBs are in, the same calls return the lib's
   fallback anchors, so this first pass builds a sane placeholder; onHoodReady (see buildCauldron
   above) marks the route dirty and tick() rebuilds it — only while no toDist pulse can be riding
   these segs, so the swap can never happen under a pulse mid-flight. ============ */
let potRouteDirty = false;
function buildPotRoute(){
  const mouth = cau.potMouth(), intake = cau.hoodIntake(), duct = cau.hoodDuctExit();
  /* the one-go spurt: straight up out of the pool, leaning into the intake center only near the
     top — a jet, not an arc. Ends just past the mouth plane so it reads as swallowed. */
  const inPt = new THREE.Vector3(intake.x, intake.y + 0.4, intake.z);
  const spurtCurve = new THREE.CatmullRomCurve3([
    mouth.clone(),
    new THREE.Vector3(mouth.x, mouth.y + (intake.y - mouth.y)*0.55, mouth.z),
    inPt.clone()
  ]);
  segs['spurt'] = {curve: spurtCurve, len: spurtCurve.getLength(), radius: 0.3, stage: 0};
  /* inside the hood: intake -> up through the throat -> out at the duct opening */
  const hoodCurve = new THREE.CatmullRomCurve3([
    inPt.clone(),
    new THREE.Vector3(THREE.MathUtils.lerp(intake.x, duct.x, 0.35), Math.max(intake.y, duct.y) + 0.9, THREE.MathUtils.lerp(intake.z, duct.z, 0.35)),
    duct.clone()
  ]);
  segs['hoodPass'] = {curve: hoodCurve, len: hoodCurve.getLength(), radius: 0.3, stage: 0, hideInside: true};
  /* the real pipe: hood duct -> pump. Continues briefly along the duct's own outward direction
     so the tube visibly leaves the opening, then sweeps down to the pump inlet. */
  removeTube('potPump');
  const out = duct.clone().sub(intake); out.y = 0;
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0); else out.normalize();
  const cPotPump = new THREE.CatmullRomCurve3([
    duct.clone(),
    duct.clone().add(out.clone().multiplyScalar(2.4)).add(new THREE.Vector3(0, -1.5, 0)),
    new THREE.Vector3(PX + 1.8, (duct.y - 11.9) * 0.32, (duct.z + PZ) * 0.5),
    new THREE.Vector3(PX, -11.9, PZ)
  ]);
  addTube('potPump', cPotPump, 0.5, 48, 0);
}
buildPotRoute();   // fallback-anchor first pass; rebuilt via potRouteDirty once both GLBs are measured
const cPumpDist = cr([[PX,-8.7,PZ],[5.4,-1.5,-22],[2.6,5.2,-17],[0,DISTY,DISTZ+0.4]]);
addTube('pumpDist', cPumpDist, 0.5, 48, 0);

/* ============================================================================
   TURN6 DEFECT #3 — "the distributor/pump causal chain is still visually
   secondary... fewer, cleaner, more deliberate pipe runs." Grok's verdict:
   "an earlier revision + r5d vents + r5f LOD." Gemini named an earlier revision's DISTRIBUTOR SPINE the
   superior layout outright. an earlier revision (this file's own base) only applied the
   spine+riser cure to ONE leg (distributor -> groups); every row transition
   below it still used a single hand-authored diagonal `bracket()` curve
   card-to-card. _TURN6.md's own KEEP list is explicit that this is not
   enough: "clamping behind the plane alone is NOT sufficient... use spine +
   risers that never leave their own card's X." So: an earlier revision's construction,
   ported wholesale, for EVERY row boundary — groups->R32, R32->R16,
   R16->QF, QF->SF, SF->FINAL, and the off-gas elbow. Each is:
     PORT -> STUB (one axis only, inside the owning card's own footprint)
           -> SPINE (one shared horizontal manifold per row-gap, glowing,
              legible as real plumbing — a small distributor in its own right)
           -> STUB -> PORT.
   No two spines share a Y-band; every band is the empty gap between two
   card rows. Because every stub only ever moves along its OWN card's fixed
   X (or Y, for a side port), and every spine never leaves its own fixed Y/Z,
   a pipe crossing a card's face is impossible by the shape of the geometry,
   not by tuning a curve's midpoint — which is exactly what kept breaking
   across turns 2-5. This still passes through addTube()'s CardPlaneCurve
   Z-clamp too (unchanged, above) — belt and suspenders, per the brief. */
const PLANE_SAFE = -1.3;   // depth every spine/stub lives at — clears every card's back face with margin
const STUB = 0.26;         // length of the straight approach into a port, confined to that port's own card

function vDrop(name, px, portY, spineY, spineZ, stage, r, tubularSegs=20, tubeOpts){
  const nearY = portY - Math.sign(portY - spineY || 1) * STUB;
  const path = new THREE.CurvePath();
  path.add(new THREE.LineCurve3(new THREE.Vector3(px, portY, 0), new THREE.Vector3(px, nearY, spineZ)));
  path.add(new THREE.LineCurve3(new THREE.Vector3(px, nearY, spineZ), new THREE.Vector3(px, spineY, spineZ)));
  return addTube(name, path, r, tubularSegs, stage, tubeOpts);
}
function spine(name, y, z, x0, x1, stage, r){
  return addTube(name, new THREE.LineCurve3(new THREE.Vector3(x0,y,z), new THREE.Vector3(x1,y,z)), r, 48, stage);
}
function spineHop(y, z, x0, x1, stage, r=0.15){
  const c = new THREE.LineCurve3(new THREE.Vector3(x0,y,z), new THREE.Vector3(x1,y,z));
  return {curve:c, len:Math.max(c.getLength(), 0.01), radius:r, stage};
}
/* R9 CHANGE #10 — "the line from card to the next should contain the colour of the team that
   won." The out_ stub each card emits is the one pipe in this network genuinely dedicated to a
   SINGLE team (every knockout card, R32 onward, has exactly one winner); the shared spine + the
   in_ stub on the far end are each fed by TWO different teams at once (a card's two halves), so
   flat-tinting those would misrepresent whichever team isn't showing — left at the default molten
   colour instead. Core gets the team's colour at full strength (the "hot fluid"); the wall gets a
   subtle tint blended toward the existing icy glass colour (spec: "core, and a subtle wall tint"). */
function teamTubeOpts(color){
  return { wallColor: new THREE.Color(0xbfe2ff).lerp(color, 0.5), coreColor: color };
}
function buildTransition(spineName, y, z, xLo, xHi, fromCards, toCards, fromStage, toStage, outPrefix, inPrefix, tintOut){
  spine(spineName, y, z, xLo, xHi, fromStage, 0.22);
  fromCards.forEach((c,i) => vDrop(outPrefix+i, c.x, c.y-c.h/2, y, z, fromStage, 0.14, 20, tintOut ? teamTubeOpts(c.emitColor) : undefined));
  toCards.forEach((c,i) => vDrop(inPrefix+i, c.x, c.y-c.h/2, y, z, toStage, 0.14));
}

/* distributor -> 12 group cards — TURN7 FIX #2, second pass. The first pass (ported from r6e) kept
   r6e's OWN unfixed flaw: Gemini named it explicitly even on r6e — "the web of thin, spaghetti-like
   pipes from the distributor to the group stage is visually cluttered" — because 12 ports crammed
   into a 9.2-unit-wide housing feeding 12 cards spread across 31.5 units, each via its OWN
   independently-curved diagonal, reads as a firework of radiating lines even though no two curves
   technically cross. Fixed structurally, not cosmetically, by treating "distributor -> groups" as
   just another row transition — the SAME spine-plus-straight-riser pattern already proven (and on
   the KEEP list) for every OTHER row boundary in this file: ONE shared glowing manifold spanning the
   group row's own width, fed by a single drop from the distributor's own core, then 12 short
   vertical stubs — each confined to its own card's fixed X — down into the cards. This is "fewer,
   cleaner, more deliberate": one bar and twelve short drops, not twelve diagonals. */
const SPINE_GROUPFEED = {y: PORT_Y - 0.9, z: PLANE_SAFE};
addTube('distToSpine', new THREE.LineCurve3(
  new THREE.Vector3(0, PORT_Y, DISTZ), new THREE.Vector3(0, SPINE_GROUPFEED.y, SPINE_GROUPFEED.z)), 0.30, 24, 0);
spine('spineGroupFeed', SPINE_GROUPFEED.y, SPINE_GROUPFEED.z, -15.75, 15.75, 0, 0.22);
groupCards.forEach((gc, i) => {
  vDrop('feed'+i, gc.x, gc.y-gc.h/2, SPINE_GROUPFEED.y, SPINE_GROUPFEED.z, 0, 0.16);
});

/* ============ the five row-transition SPINES + their drop pipes — ONE shared glowing manifold
   per stage boundary, each in its own empty gap-band; no card ever sits between a spine and this
   camera at any framing, because no spine ever leaves PLANE_SAFE and no card ever leaves z=0. ============ */
const SPINE_GROUPS  = {y: 6.00,  z: PLANE_SAFE};
const SPINE_R32R16  = {y: 3.10,  z: PLANE_SAFE};
const SPINE_R16QF   = {y: 0.00,  z: PLANE_SAFE};
const SPINE_QFSF    = {y: -3.36, z: PLANE_SAFE};
const SPINE_SFFINAL = {y: -7.40, z: PLANE_SAFE};   // also serves as the off-gas elbow's flat leg, below
const GAPY = SPINE_SFFINAL.y;

buildTransition('spineGroups',  SPINE_GROUPS.y,  SPINE_GROUPS.z,  -15.6, 15.6, groupCards, r32,   0, 1, 'gout_',   'r32in_', false);
buildTransition('spineR32R16',  SPINE_R32R16.y,  SPINE_R32R16.z,  -14.3, 14.3, r32,        r16,   1, 2, 'r32out_', 'r16in_', true);
buildTransition('spineR16QF',   SPINE_R16QF.y,   SPINE_R16QF.z,   -12.0, 12.0, r16,        qf,    2, 3, 'r16out_', 'qfin_', true);
buildTransition('spineQFSF',    SPINE_QFSF.y,    SPINE_QFSF.z,     -8.3,  8.3, qf,         sf,    3, 4, 'qfout_',  'sfin_', true);
buildTransition('spineSFFinal', SPINE_SFFINAL.y, SPINE_SFFINAL.z,  -6.0,  9.4, sf,         [FINAL], 4, 5, 'sfout_', 'finalin_', true);

/* the final's fluid drains into the REAL trophy — retargeted to x=0, the trophy's own central
   axis (TURN6 defect #1 fix), not the old offset vessel. */
/* R9 #10 — the final leg into the trophy runs in the champion's colour. FINAL.emitColor starts as
   whichever SF is currently leading (its construction default); buildLegPlan() re-tints this tube
   (segs.finalDrain.mat/coreMat) each time a fresh set picks its coin-flip champion. */
addTube('finalDrain', cr([[FINAL.x, FINAL.y-FINAL.h/2, 0],[0,-11.4,-0.5],[0, trophyMinY*troHost.scale.y + troHost.position.y + 1.6, 0.6]]), 0.20, 24, 5, teamTubeOpts(FINAL.emitColor));

/* off-gas = 3rd place: BOTH SF cards' SIDE ports feed the off-gas card's own two labelled inlets,
   also side ports — an L-shaped elbow (one axis at a time) reusing the SF->FINAL gap band, per an earlier revision's
   proven construction, not a single long diagonal. */
const offInletL = new THREE.Vector3(OFFGAS.x - (OFFGAS.w/2+0.34), OFFGAS.y + OFFGAS.h*0.14, 0);
const offInletR = new THREE.Vector3(OFFGAS.x + (OFFGAS.w/2+0.34), OFFGAS.y + OFFGAS.h*0.14, 0);
sf.forEach((card, i) => {
  const ventX = card.x + (card.w/2 + 0.30), ventY = card.y;
  const ventNear = new THREE.Vector3(ventX + STUB, ventY, PLANE_SAFE);
  addTube('p4side_'+i, new THREE.LineCurve3(new THREE.Vector3(ventX,ventY,0), ventNear), 0.10, 12, 4);

  const offInlet = i === 0 ? offInletL : offInletR;
  const offNear  = new THREE.Vector3(offInlet.x + (i===0 ? -STUB : STUB), offInlet.y, PLANE_SAFE);
  const gapAtVent = new THREE.Vector3(ventNear.x, GAPY, PLANE_SAFE);
  const gapAtOff  = new THREE.Vector3(offNear.x,  GAPY, PLANE_SAFE);
  const ogPath = new THREE.CurvePath();
  ogPath.add(new THREE.LineCurve3(ventNear, gapAtVent));
  ogPath.add(new THREE.LineCurve3(gapAtVent, gapAtOff));
  ogPath.add(new THREE.LineCurve3(gapAtOff, offNear));
  addTube('og_'+i, ogPath, 0.13, 48, 4);

  addTube('pog_'+i, new THREE.LineCurve3(offNear, offInlet), 0.09, 12, 4);
});

/* "THIRD-PLACE FORGE" — an ember plinth beneath the off-gas card where both loser streams
   visibly land (an earlier revision, ported from r3d). */
/* an earlier revision championship port — when the play-off is DECIDED the plinth reads celebratory BRONZE (the
   winner's medal), a warm bronze metal base with bronze embers; undecided keeps the off-gas red. */
const forgeMat = thirdDecided
  ? new THREE.MeshStandardMaterial({color:0x2a1c0e, metalness:0.7, roughness:0.45, emissive:0x3a2408, emissiveIntensity:0.5})
  : new THREE.MeshStandardMaterial({color:0x14100c, metalness:0.6, roughness:0.55});
const forgePlinth = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.34, 20), forgeMat);
forgePlinth.position.set(OFFGAS.x, OFFGAS.y - OFFGAS.h/2 - 0.5, 0.15); scene.add(forgePlinth);
const forgeEmberMat = thirdDecided
  ? new THREE.MeshStandardMaterial({color:0x2a1806, emissive:0xffb14a, emissiveIntensity:1.5})
  : new THREE.MeshStandardMaterial({color:0x2a0e02, emissive:0xff5a1a, emissiveIntensity:2.0});
for (const fe of [[-0.4,0.05],[0.35,-0.05],[0,0.25]]) {
  const em = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), forgeEmberMat);
  em.position.set(OFFGAS.x+fe[0], OFFGAS.y-OFFGAS.h/2-0.42, 0.3+fe[1]); scene.add(em);
}
/* an earlier revision perf note: no dynamic PointLight here — the ember spheres above are already emissive
   MeshStandardMaterial (self-illuminating regardless of scene lights), so the plinth reads as
   glowing without paying for another always-on light across every lit material in the wall. */

/* an earlier revision championship port — per-frame, the decided 3rd-place jar's bronze pools track the card's
   eased fill (base-anchored scale.y). No-op when undecided (poolA/poolB never created). */
function updateThirdPools(){
  if (OFFGAS.poolA) OFFGAS.poolA.scale.y = Math.max(0.0001, THREE.MathUtils.clamp(OFFGAS.fillA, 0, 1));
  if (OFFGAS.poolB) OFFGAS.poolB.scale.y = Math.max(0.0001, THREE.MathUtils.clamp(OFFGAS.fillB, 0, 1));
}

/* pass-through segments inside cards (no tube mesh; just the slug's travel path top->bottom) */
function passSeg(name, v, stage){
  const c = new THREE.LineCurve3(new THREE.Vector3(v.x, v.y+v.h/2, 0), new THREE.Vector3(v.x, v.y-v.h/2, 0));
  segs[name] = {curve:c, len:c.getLength(), radius:0.1, stage};
}
r32.forEach((v,i)=>passSeg('p32_'+i, v, 1));
r16.forEach((v,i)=>passSeg('p16_'+i, v, 2));
qf .forEach((v,i)=>passSeg('p8_'+i,  v, 3));
sf .forEach((v,i)=>passSeg('p4_'+i,  v, 4));

/* ============================================================================
   R9 — THE PULSE ENGINE (replaces r8f's continuous random slug spawner).
   #1 fill is driven purely by pulses that ARRIVE — a group's one pulse fills it; a knockout
      card's fill is the SUM of its two teams' pulses.
   #4 exactly ONE set in flight — the cauldron sends 12 pulses, then emits nothing else until
      the trophy detonates (enforced structurally: launchLeg() below is only ever called from
      startSet() or endLeg(), and startSet() only ever runs from the IDLE->RUNNING transition
      in tick(), which only happens after EXPLODING has fully completed).
   #6 the whole set advances through 8 fixed legs in lockstep (pot->distributor, distributor->groups,
      groups->R32, R32->R16, R16->QF, QF->SF, SF->FINAL, FINAL->TROPHY), each leg an equal share of ONE
      randomised 2-8s pot->trophy journey chosen fresh per set — every pulse born in a leg
      shares that leg's duration exactly, so siblings always arrive together.
   the maintainer: "the molten liquid should be spurted from the pot in one go up to the hood and then out
   to the distributor to be distributed" — the set's whole charge leaves the pot as ONE mass-12
   pulse (toDist) that now genuinely PASSES THROUGH THE HOOD: it rides the open-air 'spurt' up
   into the hood's measured intake, is hidden inside 'hoodPass' while the hood's own gather-glow
   works (cau.hoodReceive, synced to the pulse's real hold time), then exits the side duct into
   the 'potPump' pipe and on via pumpDist to the distributor, which is where the 12 group pulses
   are actually born (toGroup starts AT the distributor, not the pot).
   Mass doubles at every merge (12 seed pulses, still mass 1, become 32 mass-1 qualifiers; then
   16 mass-2 -> 8 mass-4 -> 4 mass-8 -> 2 mass-16 -> 1 mass-32 into the trophy), read as size +
   brightness. Colour (#9/#10): every card half's colour is fixed from the bracket data at build
   time (card.colA/colB); the pulse a card hands onward (card.emitColor) carries that same
   colour, so the wall reads as team colour converging 32->16->8->4->2->1 into the champion's
   colour on the final leg. ============================================================================ */
const slugGeo = new THREE.SphereGeometry(1, 10, 8);
let prevBulged = new Set();
const LEGS = ['toDist','toGroup','toR32','toR16','toQF','toSF','toFinal','toTrophy'];

/* per-leg route builders — chain the SAME named segs/spineHops the pipe section above already
   built (potPump/pumpDist/distToSpine/feed_c/gout_c/r32in_v/p32_v/... every stage boundary) into
   one path per pulse; the off-gas branch (og_/pog_) is unused here — OFF-GAS has no pulses of its
   own in the new topology and stays empty glass, per the KEEP list's own "scheduled/TBD = empty". */
/* the maintainer's spurt (CHANGE 2, reworked for the hood) — the set's whole charge leaves the pot as one
   mass in one go, UP into the hood's intake ('spurt'), through the hood's interior ('hoodPass' —
   pulse hidden, hood gather-glow working), out of the side duct into the real pipe ('potPump'),
   then on to the distributor ('pumpDist'). Nothing downstream of the distributor changes. */
function routeToDist(){
  return [segs['spurt'], segs['hoodPass'], segs['potPump'], segs['pumpDist']];
}
/* time-warp for the toDist leg: a linear frac->distance map would flick the mass through the hood
   in a few hundredths of a second (the hood's interior is a small share of the leg's total length)
   — the gather would never read. This piecewise remap spends fixed SHARES of the leg's duration on
   [pool->intake, inside the hood, duct->distributor] while arrival at frac=1 (and therefore the
   leg's end/endLeg timing) is untouched: the hood genuinely holds the charge for ~a third of the
   leg, which is the visible "gathers, then sends" beat the maintainer asked for. */
function makeDwellWarp(route, dwellSeg, tShares){
  const total = route.reduce((s, seg) => s + seg.len, 0) || 1;
  let before = 0;
  for (const seg of route) { if (seg === dwellSeg) break; before += seg.len; }
  const f0 = before / total, f1 = (before + (dwellSeg ? dwellSeg.len : 0)) / total;
  const tA = tShares[0], tB = tShares[0] + tShares[1], tC = Math.max(0.0001, 1 - tB);
  return (t) => {
    if (t <= tA) return f0 * (t / Math.max(0.0001, tA));
    if (t <= tB) return f0 + (f1 - f0) * ((t - tA) / Math.max(0.0001, tShares[1]));
    return f1 + (1 - f1) * ((t - tB) / tC);
  };
}
function routeToGroup(c){
  const gc = groupCards[c];
  return [segs['distToSpine'], spineHop(SPINE_GROUPFEED.y, SPINE_GROUPFEED.z, 0, gc.x, 0), segs['feed'+c]];
}
function routeToR32(c, v){
  const gc = groupCards[c];
  return [segs['gout_'+c], spineHop(SPINE_GROUPS.y, SPINE_GROUPS.z, gc.x, r32[v].x, 0), segs['r32in_'+v], segs['p32_'+v]];
}
function routeToR16(v, j){
  return [segs['r32out_'+v], spineHop(SPINE_R32R16.y, SPINE_R32R16.z, r32[v].x, r16[j].x, 1), segs['r16in_'+j], segs['p16_'+j]];
}
function routeToQF(j, k){
  return [segs['r16out_'+j], spineHop(SPINE_R16QF.y, SPINE_R16QF.z, r16[j].x, qf[k].x, 2), segs['qfin_'+k], segs['p8_'+k]];
}
function routeToSF(k, m){
  return [segs['qfout_'+k], spineHop(SPINE_QFSF.y, SPINE_QFSF.z, qf[k].x, sf[m].x, 3), segs['sfin_'+m], segs['p4_'+m]];
}
function routeToFinal(m){
  return [segs['sfout_'+m], spineHop(SPINE_SFFINAL.y, SPINE_SFFINAL.z, sf[m].x, FINAL.x, 4), segs['finalin_0']];
}
function routeToTrophy(){
  return [segs['finalDrain']];
}
const PULSE_TRACKED_CARDS = [...groupCards, ...r32, ...r16, ...qf, ...sf, FINAL];

/* the full 8-leg plan for the CURRENT set — fixed by the bracket data (only the champion pick,
   for the final leg's colour, is randomised fresh each set: SF is genuinely live/undecided). */
function buildLegPlan(){
  const plan = {toDist:[], toGroup:[], toR32:[], toR16:[], toQF:[], toSF:[], toFinal:[], toTrophy:[]};
  /* the whole set's charge, ONE decisive spurt pot->hood->pump->distributor; mass 12 reads heavier
     than any single toGroup pulse (mass 1) without outweighing the trophy's own mass-32 climax.
     warp: dwell inside the hood for a fixed share of the leg (see makeDwellWarp above) —
     [spurt 28%, hood hold 32%, duct->pump->distributor 40%] of the leg's duration. */
  const rDist = routeToDist();
  const DIST_SHARES = [0.28, 0.32, 0.40];   // [spurt, hood hold, duct->distributor] time shares
  plan.toDist.push({card:null, half:null, route:rDist, color:GROUP_C, mass:12,
                    warp: makeDwellWarp(rDist, segs['hoodPass'], DIST_SHARES), hoodShare: DIST_SHARES[1]});
  for (let c = 0; c < 12; c++) plan.toGroup.push({card:groupCards[c], half:'both', route:routeToGroup(c), color:GROUP_C, mass:1});
  for (let c = 0; c < 12; c++) {
    const qualified = GROUPS_DATA[c].filter(code => QUALIFIED.has(code));
    qualified.forEach(code => {
      const slot = R32_SLOT[code];
      if (!slot) return;
      plan.toR32.push({card:r32[slot.idx], half:slot.half, route:routeToR32(c, slot.idx), color:teamColor(code), mass:1});
    });
  }
  for (let v = 0; v < 16; v++) {
    if (R32_STATE[v] !== 'ft') continue;
    const slot = R16_SLOT[R32_DATA[v][0]];
    if (!slot) continue;
    plan.toR16.push({card:r16[slot.idx], half:slot.half, route:routeToR16(v, slot.idx), color:r32[v].emitColor, mass:2});
  }
  for (let j = 0; j < 8; j++) {
    if (R16_STATE[j] !== 'ft') continue;
    const slot = QF_SLOT[R16_DATA[j][0]];
    if (!slot) continue;
    plan.toQF.push({card:qf[slot.idx], half:slot.half, route:routeToQF(j, slot.idx), color:r16[j].emitColor, mass:4});
  }
  for (let k = 0; k < 4; k++) {
    if (QF_STATE[k] !== 'ft') continue;
    const slot = SF_SLOT[QF_DATA[k][0]];
    if (!slot) continue;
    plan.toSF.push({card:sf[slot.idx], half:slot.half, route:routeToSF(k, slot.idx), color:qf[k].emitColor, mass:8});
  }
  /* LIVE-DATA gates (settled-facts doctrine): the mockup coin-flipped a "champion" between the two
     SF leaders every set — fine on a static snapshot, a FABRICATED live result on the real site.
     toFinal only flows for a DECIDED semi (its winner is a settled fact), and the trophy climax
     only exists at all once the final itself is decided — champColor is then the REAL winner
     parsed from the DOM (parseBracket returns ft rows winner-first), never Math.random(). */
  for (let m = 0; m < 2; m++) { if (sf[m] && SF_STATE[m] === 'ft') plan.toFinal.push({card:FINAL, half: m===0?'a':'b', route:routeToFinal(m), color:sf[m].emitColor, mass:16}); }
  if (FINAL_STATE === 'ft') {
    const champColor = teamColor(FINAL_ROW[0]);   // the settled champion, winner-first from the parse
    FINAL.emitColor = champColor;
    /* R9 #10 — the finalDrain tube built once at init is re-tinted to the champion's colour here
       rather than at construction time (registry-safe via retintTube, an earlier fix). */
    const fd = segs['finalDrain'];
    if (fd) { const t = teamTubeOpts(champColor); retintTube(fd, t.wallColor, t.coreColor); }
    plan.toTrophy.push({card:null, half:null, route:routeToTrophy(), color:champColor, mass:32});
  }
  return plan;
}

let setState = 'IDLE', legIdx = -1, legT = 0, legDur = [];
let idleT = 2 + Math.random()*13, idleDur = idleT, brewCharge = 0, brewStokeClock = 0.5;
let legPlan = null, explodeColor = [1,0.85,0.6];
const pulses = [];
const pulseCounts = {toDist:0, toGroup:0, toR32:0, toR16:0, toQF:0, toSF:0, toFinal:0, toTrophy:0};

function newPulseVis(color, mass){
  const mat = new THREE.MeshStandardMaterial({color, emissive:color, emissiveIntensity:3.2});
  const mesh = new THREE.Mesh(slugGeo, mat);
  mesh.scale.setScalar(0.15 + 0.03*Math.log2(mass+1));
  scene.add(mesh);
  const bmat = new THREE.MeshPhysicalMaterial({color:0xbfe2ff, metalness:0, roughness:0.15, transparent:true, opacity:0.34, clearcoat:0.9, depthWrite:false});
  const bulge = new THREE.Mesh(slugGeo, bmat); bulge.renderOrder = -1; scene.add(bulge);
  return {mesh, mat, bmat, bulge};
}
function killPulse(p){ scene.remove(p.mesh); scene.remove(p.bulge); p.mat.dispose(); p.bmat.dispose(); }

/* position a pulse purely from the SET's own shared leg-progress fraction (not an independent
   per-pulse clock) — every pulse in a leg is therefore, by construction, exactly in sync with its
   siblings, arriving together (#6) with no drift to correct for. */
function positionPulseAtFrac(p, frac){
  frac = THREE.MathUtils.clamp(frac, 0, 1);
  /* an earlier revision — a route may carry a time-warp (the toDist leg's hood dwell, makeDwellWarp above):
     remap the leg's shared time-fraction into a distance-fraction before walking the segs. */
  if (p.entry && p.entry.warp) frac = THREE.MathUtils.clamp(p.entry.warp(frac), 0, 1);
  const target = frac * p.len;
  let acc = 0, seg = p.route[p.route.length-1], localT = 1;
  for (let i = 0; i < p.route.length; i++) {
    const L = p.route[i].len || 0.0001;
    if (acc + L >= target || i === p.route.length-1) { seg = p.route[i]; localT = L > 0 ? THREE.MathUtils.clamp((target-acc)/L, 0, 1) : 1; break; }
    acc += L;
  }
  /* an earlier revision — the hood swallows the mass: while the pulse rides a hideInside seg (the hood's
     interior) its own meshes are hidden — the hood's gather-glow IS the mass, working through the
     funnel — and cau.hoodReceive() is handed the exact real-seconds hold on entry so the interior
     glow builds precisely while the charge is inside and the duct flashes its send as it exits. */
  const hidden = !!seg.hideInside;
  p.mesh.visible = !hidden;
  p.bulge.visible = !hidden;
  if (hidden && !p.inHood) {
    p.inHood = true;
    const dur = legDur[legIdx] || 0.001;
    /* the warp pins the hood hold to a fixed time share of the leg (entry.hoodShare, the SAME
       value the warp itself was built from — one constant, no drift); convert to real seconds at
       the current pump speed (a mid-hold speed change only shifts the send flash by a beat) */
    const holdShare = (p.entry && p.entry.hoodShare) || (seg.len / Math.max(0.0001, p.len));
    cau.hoodReceive(holdShare * dur / Math.max(0.0001, pumpSpeed));
  } else if (!hidden && p.inHood) {
    p.inHood = false;
  }
  seg.curve.getPointAt(localT, tmpV);
  p.mesh.position.copy(tmpV);
  p.bulge.position.copy(tmpV);
  const kd = dk(tmpV.z);
  const massPulse = 1 + Math.sin(clock.elapsedTime*9 + p.len)*0.10;
  p.mesh.scale.setScalar((0.15 + 0.03*Math.log2(p.mass+1)) * (1 + 0.3*kd) * massPulse);
  p.mat.emissiveIntensity = 1.7 + 2.2*kd;
  p.bmat.opacity = 0.08 + 0.30*kd;
  p.bulge.scale.setScalar(Math.max((seg.radius||0.15)*1.5, 0.20 + 0.06*kd));
  if (seg.posAttr) { applyBulge(seg, localT, seg.radius*1.6); bulgedThisFrame.add(seg); }
}

function applyArrival(entry){
  if (entry.card) {
    if (entry.half === 'both') { entry.card.fillTargetA = 1; entry.card.fillTargetB = 1; }
    else if (entry.half === 'a') entry.card.fillTargetA = 1;
    else entry.card.fillTargetB = 1;
    pulseCard(entry.card);
  }
}
function launchLeg(idx){
  const name = LEGS[idx];
  cau.stoke();
  for (const e of legPlan[name]) {
    const vis = newPulseVis(e.color, e.mass);
    pulses.push(Object.assign(vis, {route:e.route, mass:e.mass, entry:e, len: e.route.reduce((s,seg)=>s+seg.len,0)}));
    pulseCounts[name]++;
  }
}
function startSet(){
  setState = 'RUNNING';
  legIdx = 0; legT = 0; brewCharge = 0;
  const T = 2 + Math.random()*6;                 // #6 — 2-8s total pot->trophy, randomised per set
  legDur = LEGS.map(() => T/LEGS.length);         // shared tempo per leg — siblings arrive coherently
  for (const c of PULSE_TRACKED_CARDS) { c.fillTargetA = 0; c.fillTargetB = 0; }
  trophyTargetFrac = 0;
  for (const k in pulseCounts) pulseCounts[k] = 0;
  legPlan = buildLegPlan();
  launchLeg(0);
}
/* end a set QUIETLY at the frontier of decided results — no explosion, no "CHAMPION!", straight
   back to the normal 2-15s brew (the room keeps living; the cascade just stops where the real
   tournament has). Mirrors the post-explosion IDLE reset exactly. */
function endSetQuietly(){
  setState = 'IDLE'; phase = 'BREWING';
  idleDur = 2 + Math.random()*13;
  idleT = idleDur;
}
function endLeg(){
  const name = LEGS[legIdx];
  for (const p of pulses) killPulse(p);
  pulses.length = 0;
  for (const e of legPlan[name]) applyArrival(e);
  if (name === 'toTrophy' && legPlan.toTrophy.length) {
    explodeColor = [legPlan.toTrophy[0].color.r, legPlan.toTrophy[0].color.g, legPlan.toTrophy[0].color.b];
    setState = 'EXPLODING'; phase = 'MATCH DROP'; matchT = 0;
    return;
  }
  /* advance to the NEXT POPULATED leg; an unresolved bracket leaves later legs empty (gated in
     buildLegPlan), so skip them — and when nothing further is populated, end the set quietly. */
  let next = legIdx + 1;
  while (next < LEGS.length && legPlan[LEGS[next]].length === 0) next++;
  if (next >= LEGS.length) { endSetQuietly(); return; }
  legIdx = next; legT = 0;
  launchLeg(legIdx);
}
let trophyTargetFrac = 0, bulgedThisFrame = new Set();

/* ============ detonation particles + off-gas rings ============ */
const PN = 320;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PN*3), pVel = new Float32Array(PN*3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
const pMat = new THREE.PointsMaterial({color:0xffb050, size:0.34, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false});
const burst = new THREE.Points(pGeo, pMat); burst.frustumCulled = false; scene.add(burst);
let burstAge = 99;
function detonateFX(){
  for (let i = 0; i < PN; i++) {
    pPos[i*3] = FINAL.x; pPos[i*3+1] = FINAL.y; pPos[i*3+2] = 0.6;
    const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1), sp = 4 + Math.random()*11;
    pVel[i*3] = sp*Math.sin(ph)*Math.cos(th);
    pVel[i*3+1] = Math.abs(sp*Math.cos(ph))*1.15;
    pVel[i*3+2] = sp*Math.sin(ph)*Math.sin(th)*0.6;
  }
  pGeo.attributes.position.needsUpdate = true;
  burstAge = 0;
  rings.forEach((r, i) => { r.userData.age = -i*0.28; });
}
const rings = [];
for (let i = 0; i < 4; i++) {
  const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 8, 32),
    new THREE.MeshBasicMaterial({color:0xbfe8d8, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false}));
  r.rotation.x = Math.PI/2;
  r.position.set(OFFGAS.x, OFFGAS.y + OFFGAS.h/2, 0);
  r.userData.age = 99; scene.add(r); rings.push(r);
}

/* ============ camera: presets, dolly, pointer parallax, hover-zoom ============ */
const views = {
  HOME:   {pos:[0, 11, 24],  tgt:[0, 1, -22]},
  GROUPS: {pos:[0, 9.4, 11],  tgt:[0, 9.3, -34]},
  R32:    {pos:[0, 5.8, 9.5], tgt:[0, 4.6, -34]},
  R16:    {pos:[0, 2.6, 9],   tgt:[0, 1.4, -34]},
  QF:     {pos:[0, -0.6, 8.5],tgt:[0, -1.8, -34]},
  SF:     {pos:[0, -4.2, 8.2],tgt:[0, -5.4, -34]},
  FINAL:  {pos:[0, -8.0, 13], tgt:[0, -10.8, -8]}
};
const STAGE_CUT = {HOME:0, GROUPS:0, R32:1, R16:2, QF:3, SF:4, FINAL:5};
const STAGE_FISH = {HOME:0, GROUPS:0.12, R32:0.20, R16:0.26, QF:0.32, SF:0.40, FINAL:0.48};
let curView = 'HOME';
const camPos = new THREE.Vector3(...views.HOME.pos);
const camTgt = new THREE.Vector3(...views.HOME.tgt);
let mx = 0, my = 0, smx = 0, smy = 0;
let hudHover = false, leanAmt = 0, fishAmt = 0;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
on(window, 'pointermove', e => {
  /* cert fix-before-promote (item 6) — map the pointer in CANVAS-relative coordinates. The raycast
     targets the canvas, so NDC must subtract the canvas's viewport offset; without getBoundingClientRect
     the group-hover raycast mistargets whenever the Room is scrolled or not at the viewport origin. */
  const r = canvas.getBoundingClientRect();
  mx = ((e.clientX - r.left)/(r.width || 1))*2 - 1;
  my = ((e.clientY - r.top)/(r.height || 1))*2 - 1;
  ndc.set(mx, -my);
  /* cert fix-before-promote (item 5) — the HUD uses class "khud", not "hud"; the old .hud selector
     never matched, so hover over the HUD sliders never suppressed the parallax sway (dead code). */
  hudHover = !!(e.target && e.target.closest && e.target.closest('.khud'));
  /* R11 — pointer affordance: show a link cursor when a navigable (resolved) match card is under
     the pointer, so the new click-through is discoverable. Cheap: a raycast only against the cards
     that actually carry an href (skipped entirely when over the HUD). */
  if (hudHover) { canvas.style.cursor = ''; }
  else {
    const nav = dynCards.filter((c) => c.href);
    if (!nav.length) { canvas.style.cursor = ''; }
    else { raycaster.setFromCamera(ndc, camera); canvas.style.cursor = raycaster.intersectObjects(nav.map((c) => c.hitMesh), false).length ? 'pointer' : ''; }
  }
});
/* R11 (owner 2026-07-18) — resolved match cards click through to their 2D match page. Read the LIVE
   canvas rect at click time (an earlier fix: a rect cached earlier goes stale after any scroll, landing the
   pointer off-canvas), map to canvas-relative NDC, raycast only the navigable cards, and navigate to
   the parsed href. TBD/undecided cards carry no href, so they are never in the hit set (no dead click). */
on(canvas, 'click', (e) => {
  const r = canvas.getBoundingClientRect();
  const cx = ((e.clientX - r.left) / (r.width || 1)) * 2 - 1;
  const cy = ((e.clientY - r.top) / (r.height || 1)) * 2 - 1;
  const nav = dynCards.filter((c) => c.href);
  if (!nav.length) return;
  raycaster.setFromCamera(new THREE.Vector2(cx, -cy), camera);
  const hits = raycaster.intersectObjects(nav.map((c) => c.hitMesh), false);
  if (!hits.length) return;
  const card = nav.find((c) => c.hitMesh === hits[0].object);
  if (card && card.href) { try { window.location.assign(card.href); } catch (err) { window.location.href = card.href; } }
});
/* an earlier revision — the hover half of the summary-card LOD (turn5 blocker #2): raycast the pointer against
   only the 12 group summary cards' glass shells every frame (cheap — 12 objects) and expand
   exactly one group's 4 real team cards while it's under the cursor, collapsing whichever group
   was previously expanded. Never more than 4 detail cards visible at once, at any camera framing. */
function updateGroupHover(){
  if (hudHover) { collapseAllGroups(); return; }
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(groupCards.map(c => c.hitMesh), false);
  const idx = hits.length ? groupCards.findIndex(c => c.hitMesh === hits[0].object) : -1;
  if (idx === hoveredGroupIdx) return;
  if (hoveredGroupIdx >= 0) {
    groupCards[hoveredGroupIdx].grp.visible = true;
    for (let k = 0; k < 4; k++) {
      const dc = groupDetail[hoveredGroupIdx*4+k];
      dc.grp.visible = false; dc.revealT = 0; dc.grp.scale.setScalar(1);
    }
  }
  if (idx >= 0) {
    groupCards[idx].grp.visible = false;
    /* TURN8 (Gemini): "the transition between the summary view and the detailed, zoomed-in stage
       view could be smoother and more animated" — the 4 revealed team cards now pop in from a
       smaller scale (revealT eased in tick(), below) instead of snapping to full size instantly. */
    for (let k = 0; k < 4; k++) {
      const dc = groupDetail[idx*4+k];
      dc.grp.visible = true; dc.revealT = 0; dc.grp.scale.setScalar(0.7);
      pulseCard(dc);
    }
  }
  hoveredGroupIdx = idx;
}
const btns = [...root.querySelectorAll('.kr-stages button')];
btns.forEach(b => b.addEventListener('click', () => {
  curView = b.dataset.v;
  btns.forEach(x => x.classList.toggle('on', x === b));
  applyGray(STAGE_CUT[curView]);
  setGroupsOpen(curView === 'GROUPS');
}));
applyGray(0); setGroupsOpen(false);

/* ============ VIEW PITCH dial (owner: "0 Degree pitch is needed", 2026-07-17 — default level) ============ */
const PITCH_T = [0, 1, -22], PITCH_R = 47.07;
const pitchEl = root.querySelector('.kr-pitch'), pitchDeg = root.querySelector('.kr-pitchdeg');
function applyPitch(deg){
  const th = deg*Math.PI/180;
  views.HOME.pos = [PITCH_T[0], PITCH_T[1] + PITCH_R*Math.sin(th), PITCH_T[2] + PITCH_R*Math.cos(th)];
  pitchDeg.textContent = deg + '°';
}
pitchEl.addEventListener('input', () => {
  applyPitch(+pitchEl.value);
  if (curView !== 'HOME') { curView = 'HOME'; btns.forEach(x => x.classList.toggle('on', x.dataset.v === 'HOME')); applyGray(0); setGroupsOpen(false); }
});
applyPitch(+pitchEl.value);

/* ============ simulation state ============ */
/* R9 — OFFGAS carries no pulses in the new topology (see the pulse-engine comment above); it
   stays TRUE empty glass, per the KEEP list's own "scheduled/TBD = empty". */
let running = true, pumpSpeed = 1, phase = 'BREWING';
let drainT = 0, matchT = 0;
const speedEl = root.querySelector('.kr-speed');
const runBtn = root.querySelector('.kr-runbtn');
const phaseEl = root.querySelector('.kr-phase');
const pulsecountEl = root.querySelector('.kr-pulsecount');
speedEl.addEventListener('input', () => pumpSpeed = parseFloat(speedEl.value));
runBtn.addEventListener('click', () => {
  running = !running;
  runBtn.innerHTML = running ? '&#10074;&#10074; PAUSE' : '&#9654; RUN';
});

/* cert R1 — a live result landing mid-view must NOT yank the fan's camera/dials/pause: the
   change-gated remount (toggle observer, below the mount) captures the outgoing mount's viewer
   state via controller.getViewerState() and hands it back here as opts.restoreState. Order
   matters: speed, then pitch (applyPitch rewrites views.HOME.pos), then the stage view — with
   camPos/camTgt SNAPPED to the restored view so the camera doesn't visibly re-fly from HOME. */
if (opts.restoreState) {
  const rs = opts.restoreState;
  if (rs.speed != null) { speedEl.value = rs.speed; pumpSpeed = parseFloat(rs.speed) || 1; }
  if (rs.pitch != null) { pitchEl.value = rs.pitch; applyPitch(+rs.pitch); }
  if (rs.running === false) { running = false; runBtn.innerHTML = '&#9654; RUN'; }
  /* an earlier revision — never restore the transient 'CHAMP' framing (an outgoing champMode mount reports it): if
     this mount replays the championship it drives curView='CHAMP' itself; if it does NOT, a CHAMP
     camera over a non-enlarged trophy is a broken state — fall back to HOME. */
  if (rs.view && views[rs.view] && rs.view !== 'CHAMP') {
    curView = rs.view;
    btns.forEach(x => x.classList.toggle('on', x.dataset.v === rs.view));
    applyGray(STAGE_CUT[rs.view]); setGroupsOpen(rs.view === 'GROUPS');
    camPos.set(...views[rs.view].pos); camTgt.set(...views[rs.view].tgt);
  }
}

/* ============================================================================
   an earlier revision — THE REAL DETONATION (turn4 headline fix). an earlier revision's eruption was a single
   tro.detonate() call: one 105-spark/9-flash burst, scored "confetti-like" with
   a measured-low climax_response. the maintainer's own dev fireworks are a SALVO — 11
   shell colours, randomized pacing, two-tone shells — and that is the corollary
   he asked for. So DETONATION now fires a scheduled multi-shot salvo through
   buildTrophy's genuine detonate(), each shot strobing the room (not just the
   trophy corner) via a full-viewport light-flash overlay + two point lights. */
const detFlashEl = root.querySelector('.kr-detflash');
let screenFlash = 0, flashTint = [1, 0.85, 0.6], flashShown = false;
let salvoQueue = [], salvoEnd = 0;
function scheduleSalvo(){
  salvoQueue = [];
  const shuffled = SHELLS.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const N = 9;   /* a real salvo, not one pop — reads as detonation, not confetti */
  let tAcc = 0;
  for (let i = 0; i < N; i++) {
    /* cert fix-before-promote (item 4) — WCAG 2.3.1 flash-rate FLOOR: each shot is a light+screen
       flash (fireShot), so consecutive shots must be >=0.34s apart (three-flashes-per-second limit).
       This floor applies ALWAYS (reduced-motion is not a photosensitivity proxy). Base 0.35s > 0.34s
       with margin even at zero jitter; the first queued shot is also >=0.35s after the on-arrival
       fireShot(explodeColor). Shots are SPREAD, not dropped (N unchanged); total salvo grows to
       ~4.1s + 1.15s tail (well under 2x the old ~2.8s+1.15s), keeping the celebratory feel. */
    tAcc += 0.35 + Math.random() * 0.20;
    salvoQueue.push({ t: tAcc, shell: shuffled[i % shuffled.length], fired: false });
  }
  salvoEnd = tAcc + 1.15;   /* afterglow tail before the trophy drains and resets */
}
function fireShot(shell){
  tro.detonate(shell);
  /* R9 FIX (detonation wash) — 34 -> 20: with real distance falloff now on `flash` (see its
     declaration above), a lower peak still reads as a strong local blast; paired with the falloff
     it stops the light from flooding the whole hall the way the old unattenuated 34 did. */
  flash.intensity = 20; flash.color.setRGB(shell[0], shell[1], shell[2]);
  screenFlash = 1; flashTint = shell;
}

/* ============================================================================
   an earlier revision — THE CHAMPIONSHIP SEQUENCE (ported from the verified mockup an earlier revision.html; the mockups host is
   the design source). On the LIVE site the trigger is NOT a button but the real result: either the
   final is ALREADY ft when a fan opts into 3D (POST-HOC MOUNT, skippable), or the MutationObserver
   sees the final flip sched/live -> ft while mounted and remounts THIS mount with opts.champLive
   (LIVE FLIP). Orchestration once triggered (champion = the REAL parsed winner, never fabricated — an earlier fix):
     t=0     LIFTOFF — the trophy's own detonate()/SHELLS rockets take off immediately (champion colour
             leads); shots spaced >=0.34s (WCAG 2.3.1, the site's own flash-rate floor).
     ~1-3s   ENLARGE — the trophy grows (scale 6.5) to cover MOST of the bracket + the walls recede
             behind a depth-tested scrim (setDim), composed FROM the dialled cup state (snapshot ease).
     ~3s     GRAND SHOW — the full 12-shell salvo (champion colour leading) + ticker-tape ribbons
             (champion colours + gold) + the CONGRATULATIONS <TEAM>! DOM banner (condensed caps,
             champion colour on the name).
     ~11s+   SETTLE — salvo tapers to occasional shells, ticker thins, banner corners, the trophy
             eases to ~60% of peak; the cascade stays stopped.
   setState 'CHAMP' means tick()'s ambient IDLE/RUNNING/EXPLODING branches never run, so the ambient
   loop can NEVER start a set or self-detonate while the championship owns the moment — the only two
   detonation paths are the two triggers above (task item 3). ============================================ */
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const champBanner = root.querySelector('.kr-banner');
const champBannerTeam = champBanner.querySelector('.cbteam');
const champTicker = root.querySelector('.kr-ticker');
const CHAMP = { ENLARGE_START:1.0, ENLARGE_END:3.0, SETTLE:11.0 };
/* enlarge targets — same coordinate frame as the mockup (identical scene base): the trophy grows to
   DOMINATE the frame and the camera pulls to a champion framing; the bracket recedes behind the
   dark depth-tested scrim (setDim). Peak vs settle (~60% of peak). */
const champCfg = {
  scale: 6.5, scaleSettle: 4.0,
  pos: new THREE.Vector3(0, 0.0, 7.0),
  view: { pos:[0, -1.5, 17], tgt:[0, -2.5, -6] },
  dim: 0.72
};
views.CHAMP = champCfg.view;
/* dark scrim: a big transparent plane just IN FRONT of the card wall (z~0) but BEHIND the enlarged
   trophy (z forward). depthTest:true + depthWrite:false means the opaque trophy (closer) occludes it
   while everything behind it (the whole bracket) dims — so the trophy owns the frame without dimming
   itself. renderOrder high so it paints last over the cards' own transparent layers. */
const champDimMat = new THREE.MeshBasicMaterial({ color:0x02040a, transparent:true, opacity:0, depthWrite:false, depthTest:true });
const champDim = new THREE.Mesh(new THREE.PlaneGeometry(80, 48), champDimMat);
champDim.position.set(0, 0, 2.2); champDim.renderOrder = 50; champDim.visible = false;
scene.add(champDim);
function setDim(k){ const o = champCfg.dim * THREE.MathUtils.clamp(k, 0, 1); champDimMat.opacity = o; champDim.visible = o > 0.002; }
let champMode = false, champPhase = 'idle', champT = 0, champWinner = null, champSnap = null, champSkippable = false;
let champShots = [], champSpawnAcc = 0, champShotAcc = 0;
/* an earlier revision#1 — 0 normally; ramps 0->1 (~300ms at enlarge start, in champTick) during the championship so
   the trophy reads as SOLID GOLD (the maintainer: "this thing in the middle looks bad"): the fill window/
   core/glow/meniscus fade out and stay hidden through grand/settle, then reset to 0 on champReset.
   Applied as a (1 - champFillHide) multiplier on the four fill-layer opacities in the trophy-fill
   block — a pure function of build-time bases, so no an earlier fix snapshot is needed. */
let champFillHide = 0;

function champEase(a, b, t){ return a + (b-a) * (1 - Math.pow(1 - THREE.MathUtils.clamp(t,0,1), 3)); }
function champRibbonColors(){ const hex = '#' + teamColor(champWinner).getHexString(); return [hex, hex, '#ffd54a', '#ffffff']; }
function spawnRibbon(cols){
  const el = document.createElement('div');
  el.className = 'kr-ttape';
  el.style.left = (Math.random()*100) + '%';   // % of the ticker (== room width), not the mockup's vw
  el.style.background = cols[(Math.random()*cols.length)|0];
  el.style.animationDuration = (2.2 + Math.random()*2.8) + 's';
  el.style.height = (14 + Math.random()*22) + 'px';
  el.style.width = (5 + Math.random()*7) + 'px';
  el.addEventListener('animationend', () => el.remove());
  champTicker.appendChild(el);
}
function fireGrandSalvo(){
  const c = teamColor(champWinner), champShell = [c.r, c.g, c.b];
  const shuffled = SHELLS.slice();
  for (let i = shuffled.length-1; i>0; i--){ const j=(Math.random()*(i+1))|0; [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  champShots.push({ t: champT, shell: champShell, fired:false });        // champion colour leads
  /* >=0.34s spacing per shot (WCAG 2.3.1 flash-rate floor — the site's own item-4 cert guard;
     the mockup's 0.14-0.40 finale pacing would exceed 3 flashes/sec). */
  let tAcc = 0;
  for (let i = 0; i < 11; i++){ tAcc += 0.36 + Math.random()*0.24; champShots.push({ t: champT + tAcc, shell: i%3===0 ? champShell : shuffled[i%shuffled.length], fired:false }); }
  champBanner.classList.add('show');
}
/* minimal restore — used only by __champSim's re-trigger (production never resets; the championship
   is terminal, and a real dispose/remount rebuilds fresh). Restores the trophy transform snapshot so
   a re-run eases from the true origin, and clears the banner/ticker/scrim. */
function champReset(){
  if (champSnap){
    troHost.scale.setScalar(champSnap.troScale); troHost.position.copy(champSnap.troPos);
    trophyFillHost.scale.setScalar(champSnap.fillScale); trophyFillHost.position.copy(champSnap.fillPos);
  }
  champMode = false; champPhase = 'idle'; champT = 0; champShots = []; champSpawnAcc = 0; champShotAcc = 0;
  champFillHide = 0;   // an earlier revision#1 — restore the fill window/core/glow/meniscus (cascade fill indicator works again)
  setDim(0);
  champBanner.classList.remove('show','corner');
  champTicker.innerHTML = '';
  flash.intensity = 0; screenFlash = 0;
  setState = 'IDLE'; phase = 'BREWING'; trophyTargetFrac = 0;
}
function startChampionship(winnerCode, o){
  o = o || {};
  if (champMode) champReset();                 // clean restart (only via __champSim)
  champWinner = winnerCode;
  champSkippable = !!o.skippable;
  /* snapshot the trophy transform we ease FROM (an earlier fix). Unlike the mockup there is NO state-flip /
     card-resolve here — the site only runs the championship when the final is ALREADY ft, so the
     FINAL card is already its resolved ft face (built at mount). */
  champSnap = { troScale: troHost.scale.x, troPos: troHost.position.clone(), fillScale: trophyFillHost.scale.x, fillPos: trophyFillHost.position.clone() };
  views.CHAMP = champCfg.view;
  const champColor = teamColor(winnerCode);
  const fd = segs['finalDrain']; if (fd){ const t = teamTubeOpts(champColor); retintTube(fd, t.wallColor, t.coreColor); }
  for (const p of pulses) killPulse(p); pulses.length = 0;   // suspend any ambient cascade; take over
  setState = 'CHAMP'; phase = 'CHAMPION';
  champMode = true; champT = 0; champShots = []; champSpawnAcc = 0; champShotAcc = 0;
  explodeColor = [champColor.r, champColor.g, champColor.b];
  trophyTargetFrac = 1;                          // trophy full + molten in the champion's colour
  champBannerTeam.textContent = (TEAM[winnerCode] || winnerCode).toUpperCase() + '!';
  champBannerTeam.style.color = '#' + champColor.getHexString();
  champBanner.classList.remove('corner');

  if (REDUCED){
    /* prefers-reduced-motion — no strobe/scale/camera ramp, no ticker: the resolved final card + a
       static banner + a prominent (not obscuring) trophy, immediately. champTick() early-returns for
       this path (an earlier fix) so this preset end-state is never stomped by a per-frame ramp. */
    champPhase = 'settle';
    troHost.scale.setScalar(champCfg.scaleSettle); troHost.position.copy(champCfg.pos);
    trophyFillHost.position.copy(troHost.position); trophyFillHost.scale.copy(troHost.scale);
    champFillHide = 1;   // an earlier revision#1 — hide the fill column immediately; champTick early-returns in reduced motion (an earlier fix), so this preset value is never stomped by the per-frame ramp
    setDim(1);
    champBanner.classList.add('show', 'corner');
    return;
  }
  /* liftoff — the trophy's own rockets take off IMMEDIATELY (opening salvo, champion colour first). */
  champPhase = 'liftoff';
  for (let i = 0; i < 3; i++) champShots.push({ t: i*0.36, shell: i===0 ? [champColor.r,champColor.g,champColor.b] : SHELLS[(Math.random()*SHELLS.length)|0], fired:false });
}
function champTick(dt){
  if (!champMode) return;
  /* prefers-reduced-motion — startChampionship() placed the full static end-state; do NOT animate it.
     an earlier fix: a per-frame ramp keyed on an absolute clock (champT starts at 0, SETTLE=11) entered early
     resolves to the ramp's START value (the PEAK scale), stomping the preset settle end-state —
     early-return is the fix. */
  if (REDUCED) return;
  champT += dt;
  for (const s of champShots){ if (!s.fired && champT >= s.t){ s.fired = true; fireShot(s.shell); } }
  flash.intensity = Math.max(0, flash.intensity - dt*30);   // decay the salvo point-light (the ambient DETONATION branch that normally does this isn't reached in CHAMP state)
  trophyTargetFrac = 1;
  /* an earlier revision#1 — quick ~300ms fade of the fill column tied to the enlarge phase start (champT reaches
     ENLARGE_START before the trophy grows), then held at 1 through grand/settle. champT only grows,
     so once past the ramp it stays hidden; during liftoff (champT<ENLARGE_START) it clamps to 0 so
     the fill still reads normally at pre-enlarge scale. Applied as fillVis in the trophy-fill block. */
  champFillHide = THREE.MathUtils.clamp((champT - CHAMP.ENLARGE_START)/0.3, 0, 1);

  if (champPhase === 'liftoff'){
    if (champT >= CHAMP.ENLARGE_START) champPhase = 'enlarge';
  } else if (champPhase === 'enlarge'){
    const k = THREE.MathUtils.clamp((champT - CHAMP.ENLARGE_START)/(CHAMP.ENLARGE_END - CHAMP.ENLARGE_START), 0, 1);
    troHost.scale.setScalar(champEase(champSnap.troScale, champCfg.scale, k));
    troHost.position.set(champEase(champSnap.troPos.x, champCfg.pos.x, k), champEase(champSnap.troPos.y, champCfg.pos.y, k), champEase(champSnap.troPos.z, champCfg.pos.z, k));
    trophyFillHost.position.copy(troHost.position); trophyFillHost.scale.copy(troHost.scale);
    setDim(k);
    if (curView !== 'CHAMP'){ curView = 'CHAMP'; btns.forEach(x=>x.classList.remove('on')); }
    if (k >= 1){ champPhase = 'grand'; fireGrandSalvo(); }
  } else if (champPhase === 'grand'){
    troHost.scale.setScalar(champCfg.scale); troHost.position.copy(champCfg.pos);
    trophyFillHost.position.copy(troHost.position); trophyFillHost.scale.copy(troHost.scale);
    setDim(1);
    champSpawnAcc += dt;
    while (champSpawnAcc > 0.03){ champSpawnAcc -= 0.03; spawnRibbon(champRibbonColors()); }
    if (champT >= CHAMP.SETTLE){ champPhase = 'settle'; champBanner.classList.add('corner'); champSpawnAcc = 0; }
  } else if (champPhase === 'settle'){
    troHost.scale.setScalar(champEase(champCfg.scale, champCfg.scaleSettle, THREE.MathUtils.clamp((champT - CHAMP.SETTLE)/2.5, 0, 1)));
    trophyFillHost.scale.copy(troHost.scale);
    champSpawnAcc += dt;
    while (champSpawnAcc > 0.5){ champSpawnAcc -= 0.5; if (Math.random()<0.6) spawnRibbon(champRibbonColors()); }
    champShotAcc += dt;
    if (champShotAcc > 1.6){ champShotAcc = 0; const c = teamColor(champWinner); fireShot(Math.random()<0.5 ? [c.r,c.g,c.b] : SHELLS[(Math.random()*SHELLS.length)|0]); }
  }
}
/* SKIP (task item 2, POST-HOC only) — any click inside the room, or Escape, jumps straight to the
   settled champion state. Capture-phase so it preempts the card-navigation click (on canvas, below)
   and the Escape-exits-3D handler (top of mount) — consumed so neither also fires. Stateless (no
   storage). Once settled, champSkipActive() is false so normal click-through / Escape-exit resume. */
function jumpToSettle(){
  if (!champMode || REDUCED) return;
  champPhase = 'settle';
  champT = Math.max(champT, CHAMP.SETTLE + 2.5);   // past the settle ramp so the scale is at scaleSettle
  troHost.scale.setScalar(champCfg.scaleSettle); troHost.position.copy(champCfg.pos);
  trophyFillHost.position.copy(troHost.position); trophyFillHost.scale.copy(troHost.scale);
  setDim(1);
  if (curView !== 'CHAMP'){ curView = 'CHAMP'; btns.forEach(x=>x.classList.remove('on')); }
  champBanner.classList.add('show', 'corner');
  champSpawnAcc = 0;
}
const champSkipActive = () => champMode && champSkippable && champPhase !== 'settle' && !REDUCED;
on(root, 'click', (e) => { if (champSkipActive()){ jumpToSettle(); e.stopPropagation(); e.preventDefault(); } }, true);
on(window, 'keydown', (e) => { if (e.key === 'Escape' && champSkipActive()){ jumpToSettle(); e.stopImmediatePropagation(); e.preventDefault(); } }, true);

/* VERIFICATION-ONLY hooks (same posture as the other window.__ hooks — no production behaviour
   depends on them; deleted at dispose via _winHooks). __champSim force-fires the sequence for the
   headless pass (defaults to the real parsed winner). __champState reports live phase, the trophy's
   screen-coverage of the bracket region, ticker count and banner text. */
window.__champSim = (winnerCode) => {
  const code = winnerCode || ((FINAL_STATE === 'ft' && !isTBD(FINAL_ROW[0])) ? FINAL_ROW[0] : 'ESP');
  startChampionship(code, { skippable: true });
  return code;
};
window.__champState = () => {
  const projPt = (v) => { const p = v.clone().project(camera); return [(p.x*0.5+0.5)*W(), (-p.y*0.5+0.5)*H()]; };
  const bbox = (corners) => { const a=[1e9,1e9,-1e9,-1e9]; for (const c of corners){ const s=projPt(c); a[0]=Math.min(a[0],s[0]);a[1]=Math.min(a[1],s[1]);a[2]=Math.max(a[2],s[0]);a[3]=Math.max(a[3],s[1]); } return a; };
  const BND = { width:2.4, depth:2.4, minY:-2.55, maxY:0.85 };   // trophy GLB local bounds (same GLB as the mockup)
  const sc = troHost.scale.x, P = troHost.position, tc = [];
  for (const lx of [-BND.width/2, BND.width/2])
    for (const ly of [BND.minY, BND.maxY])
      for (const lz of [-BND.depth/2, BND.depth/2])
        tc.push(new THREE.Vector3(P.x+lx*sc, P.y+ly*sc, P.z+lz*sc));
  const T = bbox(tc);
  const brc = []; for (const x of [-16,16]) for (const y of [-12,13]) brc.push(new THREE.Vector3(x,y,0));
  const BR = bbox(brc);
  const ox = Math.max(0, Math.min(T[2],BR[2]) - Math.max(T[0],BR[0]));
  const oy = Math.max(0, Math.min(T[3],BR[3]) - Math.max(T[1],BR[1]));
  const bw = Math.max(1, BR[2]-BR[0]), bh = Math.max(1, BR[3]-BR[1]);
  return {
    active: champMode, phase: champMode ? champPhase : 'idle', winner: champWinner, skippable: champSkippable, reduced: REDUCED,
    coverW: +(ox/bw).toFixed(3), coverH: +(oy/bh).toFixed(3), coverArea: +((ox*oy)/(bw*bh)).toFixed(3),
    troScale: +sc.toFixed(2), ticker: champTicker.childElementCount,
    banner: champBanner.classList.contains('show') ? champBannerTeam.textContent : '',
    bannerCorner: champBanner.classList.contains('corner'),
    shotsFired: champShots.filter(s => s.fired).length, shotsTotal: champShots.length, flash: +flash.intensity.toFixed(1),
    finalState: FINAL_STATE, finalWinner: (FINAL_STATE==='ft' && !isTBD(FINAL_ROW[0])) ? FINAL_ROW[0] : null,
    /* an earlier revision#1 — champFillHide (0=fill visible, 1=fully hidden/solid gold) exposed for the pale-blade check */
    fillHide: +champFillHide.toFixed(3), fillHidden: champFillHide >= 0.999,
    thirdDecided, curView
  };
};

/* ============================================================================
   an earlier revision championship AUTO-START — the two REAL trigger paths:
   • POST-HOC MOUNT (item 2): a fresh opt-in (no restoreState) with the final ALREADY ft plays the
     sequence once, SKIPPABLE.
   • LIVE FLIP (item 1): the toggle observer (below the mount) detects the final flipping
     sched/live -> ft while mounted, remounts carrying the fan's viewer state (R1) and passes
     opts.champLive so THIS fresh mount fires the FULL sequence (not skippable — the live moment).
   A plain observer remount that is NOT a fresh flip (some other card changed while the final was
   already ft) does NOT replay: restoreState present + !champLive. The champion is FINAL_ROW[0] (the
   settled winner, winner-first from the parse — never fabricated, an earlier fix). */
if (FINAL_STATE === 'ft' && !isTBD(FINAL_ROW[0]) && (!opts.restoreState || opts.champLive)) {
  startChampionship(FINAL_ROW[0], { skippable: !opts.champLive });
}

/* ============================================================================
   an earlier revision#2 — THE BRONZE CELEBRATION (the maintainer: "we need to celebrate the third place winner").
   A proportionate third-place moment localized at the 3rd-place JAR — never competing with the
   champion's grand show. One-shot on this 3D mount: when the play-off is DECIDED (THIRD_STATE ft)
   and the final is NOT yet ft, a few modest firework pops fire ABOVE the jar (bronze/amber/gold +
   one accent shell in the WINNER's own colour), a brief bronze ember sprinkle drifts around that
   corner ONLY, and a compact "BRONZE · <TEAM>" chip appears then PERSISTS small. Once the final is
   ft (the champion owns the room) no pops fire but the chip stays. Undecided third → nothing.
   prefers-reduced-motion: chip only, no pops. The winner is THIRD_ROW[0] — winner-first from the
   parse when ft (an earlier fix), never hardcoded. dispose()'s scene traverse frees the Points buffer +
   sprite texture and root.replaceChildren() clears the chip DOM (heap-stable toggle cycles). ==== */
const bronzeCode = THIRD_ROW[0];                                   // winner-first from the parse when ft
const BRONZE_SHELLS = [ [0.80,0.50,0.20], [1.00,0.69,0.29], [1.00,0.84,0.34] ]; // bronze / hot-bronze / gold (additive sprite colours <=1, no ACES clip — an earlier fix N/A)
const bronzeAnchor = new THREE.Vector3(OFFGAS.x, OFFGAS.y + OFFGAS.h/2 + 2.2, 0.2); // clearly ABOVE the jar (lower-right corner)
const bronzeChipEl = root.querySelector('.kr-bronze-chip');
const bronzeChipTeamEl = bronzeChipEl.querySelector('.bcteam');
/* ONE additive Points buffer, reused for the pops AND the localized ember sprinkle — the room's own
   burst technique (detonateFX / lib burst()) at a fraction of the size, anchored at the jar not the
   trophy. scene.add so the mount's dispose() traverse frees geometry + material + the sprite texture. */
const BPN = 280;
const bpPos = new Float32Array(BPN*3), bpVel = new Float32Array(BPN*3), bpCol = new Float32Array(BPN*3), bpBase = new Float32Array(BPN*3);
const bpLife = new Float32Array(BPN), bpDecay = new Float32Array(BPN), bpGrav = new Float32Array(BPN);
for (let i = 0; i < BPN; i++) { bpLife[i] = -1; bpPos[i*3+1] = -999; }
const bpGeo = new THREE.BufferGeometry();
bpGeo.setAttribute('position', new THREE.BufferAttribute(bpPos, 3));
bpGeo.setAttribute('color', new THREE.BufferAttribute(bpCol, 3));
const bpSpriteC = document.createElement('canvas'); bpSpriteC.width = bpSpriteC.height = 64;
const bpSpriteG = bpSpriteC.getContext('2d'), bpGrad = bpSpriteG.createRadialGradient(32,32,2,32,32,30);
bpGrad.addColorStop(0,'rgba(255,255,255,1)'); bpGrad.addColorStop(0.4,'rgba(255,255,255,0.85)'); bpGrad.addColorStop(1,'rgba(255,255,255,0)');
bpSpriteG.fillStyle = bpGrad; bpSpriteG.fillRect(0,0,64,64);
const bpMat = new THREE.PointsMaterial({size:0.44, map:new THREE.CanvasTexture(bpSpriteC), vertexColors:true, transparent:true, opacity:0.95, depthWrite:false, blending:THREE.AdditiveBlending});
const bronzePoints = new THREE.Points(bpGeo, bpMat); bronzePoints.frustumCulled = false; scene.add(bronzePoints);
let bpNext = 0;
function bpEmit(x,y,z, vx,vy,vz, shell, decay, grav){
  const i = bpNext = (bpNext+1) % BPN;
  bpPos[i*3]=x; bpPos[i*3+1]=y; bpPos[i*3+2]=z;
  bpVel[i*3]=vx; bpVel[i*3+1]=vy; bpVel[i*3+2]=vz;
  bpBase[i*3]=shell[0]; bpBase[i*3+1]=shell[1]; bpBase[i*3+2]=shell[2];
  bpCol[i*3]=shell[0]; bpCol[i*3+1]=shell[1]; bpCol[i*3+2]=shell[2];
  bpLife[i]=1; bpDecay[i]=decay; bpGrav[i]=grav;
}
function bronzePop(shell){
  const cx = bronzeAnchor.x + (Math.random()-0.5)*1.4, cy = bronzeAnchor.y + Math.random()*1.0, cz = bronzeAnchor.z + (Math.random()-0.5)*0.4;
  for (let k = 0; k < 55; k++){
    const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1), sp = 1.3 + Math.random()*2.2;   // reduced spread vs the trophy salvo
    bpEmit(cx, cy, cz, sp*Math.sin(ph)*Math.cos(th), Math.abs(sp*Math.cos(ph))*1.05, sp*Math.sin(ph)*Math.sin(th)*0.5, shell, 1.5, 3.2);
  }
  bpGeo.attributes.position.needsUpdate = true; bpGeo.attributes.color.needsUpdate = true;
}
function bronzeEmber(){
  const a = Math.random()*Math.PI*2, rr = Math.random()*0.9;
  const e = Math.random() < 0.5 ? BRONZE_SHELLS[0] : BRONZE_SHELLS[1];
  bpEmit(bronzeAnchor.x + Math.cos(a)*rr, bronzeAnchor.y - 0.7 + Math.random()*0.4, bronzeAnchor.z + Math.sin(a)*rr*0.4,
    (Math.random()-0.5)*0.35, 0.5 + Math.random()*0.6, (Math.random()-0.5)*0.2, e, 0.6, 0.8);
}
let bronzeShown = false, bronzeCelebActive = false, bronzeT = 0, bronzeEmberAcc = 0, bronzePopsFired = 0, bronzePops = [];
function startBronzeCeleb(){
  if (!thirdDecided) return;                                       // undecided third place → nothing (an earlier fix — data-gated: no chip, no pops)
  bronzeChipTeamEl.textContent = (TEAM[bronzeCode] || bronzeCode).toUpperCase();   // the site's existing naming pattern (full name, else code)
  bronzeChipTeamEl.style.color = '#' + teamColor(bronzeCode).getHexString();       // team name in the WINNER's audited data-color
  bronzeChipEl.classList.add('show');                              // the chip persists from here (settled state)
  bronzeShown = true;
  /* pops ONLY when entering with the 3rd place decided, the final NOT yet ft, motion allowed, and the
     champion not already owning the room. */
  if (REDUCED || FINAL_STATE === 'ft' || champMode) return;
  const c = teamColor(bronzeCode), bronzeAccentShell = [c.r, c.g, c.b];
  bronzeCelebActive = true; bronzeT = 0; bronzeEmberAcc = 0; bronzePopsFired = 0;
  bronzePops = [
    { t:0.5, shell:BRONZE_SHELLS[0], fired:false },
    { t:1.0, shell:bronzeAccentShell, fired:false },               // accent shell — the winner's own colour
    { t:1.5, shell:BRONZE_SHELLS[2], fired:false }
  ];
}
function bronzeTick(dt){
  if (champMode) bronzeCelebActive = false;                        // the champion owns the room — stop emitting (chip stays)
  if (bronzeCelebActive){
    bronzeT += dt;
    for (const p of bronzePops){ if (!p.fired && bronzeT >= p.t){ p.fired = true; bronzePop(p.shell); bronzePopsFired++; } }
    if (bronzeT < 3.0){ bronzeEmberAcc += dt; while (bronzeEmberAcc > 0.09){ bronzeEmberAcc -= 0.09; bronzeEmber(); } }
    if (bronzeT > 5.6) bronzeCelebActive = false;                  // pops + sprinkle done; only the persistent chip remains
  }
  let anyAlive = false;
  for (let i = 0; i < BPN; i++){
    if (bpLife[i] < 0) continue;
    anyAlive = true;
    bpLife[i] -= dt * bpDecay[i];
    if (bpLife[i] < 0){ bpPos[i*3+1] = -999; bpCol[i*3]=bpCol[i*3+1]=bpCol[i*3+2]=0; continue; }
    bpVel[i*3+1] -= bpGrav[i]*dt;
    bpPos[i*3] += bpVel[i*3]*dt; bpPos[i*3+1] += bpVel[i*3+1]*dt; bpPos[i*3+2] += bpVel[i*3+2]*dt;
    const fade = Math.min(1, bpLife[i]*1.6);
    bpCol[i*3]=bpBase[i*3]*fade; bpCol[i*3+1]=bpBase[i*3+1]*fade; bpCol[i*3+2]=bpBase[i*3+2]*fade;
  }
  if (anyAlive){ bpGeo.attributes.position.needsUpdate = true; bpGeo.attributes.color.needsUpdate = true; }
}
startBronzeCeleb();   // one-shot on entering the room (this 3D mount; runs AFTER the champion auto-start so champMode gates the pops)
/* VERIFICATION-ONLY (same posture as the other window.__ hooks; deleted at dispose via _winHooks).
   __bronzeReplay re-arms the pops so a headless pass captures a clean, fully-lit pre-pop baseline
   then measures the localized burst deterministically (an earlier fix). __bronzeState reports the live state. */
window.__bronzeReplay = () => { for (let i = 0; i < BPN; i++){ bpLife[i] = -1; bpPos[i*3+1] = -999; } bronzeCelebActive = false; bronzeShown = false; startBronzeCeleb(); return { bronzeCode, thirdDecided, finalState: FINAL_STATE, reduced: REDUCED, champ: champMode }; };
window.__bronzeState = () => ({ shown: bronzeShown, active: bronzeCelebActive, t: +bronzeT.toFixed(2), popsFired: bronzePopsFired, chip: bronzeChipEl.classList.contains('show') ? bronzeChipTeamEl.textContent : '', chipColor: bronzeChipTeamEl.style.color, decided: thirdDecided, code: bronzeCode, anchor: [bronzeAnchor.x, bronzeAnchor.y, bronzeAnchor.z] });

/* R9 verification hooks. __setFill is no longer meaningful (there is no single 0-100 sim variable
   any more — every card fills from its own arriving pulses) but is kept as a harmless no-op alias
   so old call sites don't throw. __detonate force-fires the trophy immediately, for testing.
   __pulseState() is the mandated mechanical-verification hook: live pulse counts per stage, the
   current leg/mass, and whether a second set could possibly be in flight (#4). */
window.__setFill = () => {};
window.__detonate = () => {
  if (setState === 'RUNNING') { for (const p of pulses) killPulse(p); pulses.length = 0; legIdx = LEGS.length-1; legT = legDur[legIdx]; endLeg(); }
};
const LEG_MASS = {toDist:12, toGroup:1, toR32:1, toR16:2, toQF:4, toSF:8, toFinal:16, toTrophy:32};
window.__pulseState = () => ({
  setState, phase, leg: legIdx >= 0 ? LEGS[legIdx] : null, legT, legDur: legDur[legIdx] || 0,
  massThisLeg: legIdx >= 0 ? LEG_MASS[LEGS[legIdx]] : 0,
  livePulses: pulses.length,
  counts: Object.assign({}, pulseCounts)   // cumulative pulses launched THIS set, per leg — toDist should read 1, toGroup 12, toR32 32, toR16 16, toQF 8, toSF 4, toFinal 2, toTrophy 1
});
/* verification hook only — read-only introspection for the headless Playwright pass (measuring
   real projected pixel heights from the live camera, exactly as updateCardLOD does). No production
   behavior depends on this. */
window.__dbg = {
  THREE, camera, dynCards,
  /* R9 #10 verification-only additions — read-only introspection so the headless pass can MEASURE
     tube material colours against the bracket data's own team colours, rather than eyeballing
     screenshots. No production behavior depends on any of this. */
  segs, teamColor, COLORS: parsed.COLORS, PARSED: parsed, R32_DATA, R16_DATA, QF_DATA, SF_DATA,
  r32, r16, qf, sf, FINAL, groupCards, buildLegPlan,
  /* an earlier revision verification-only additions — the three hero transmission materials (jar, distributor,
     pump — the optional 4th/5th canopy was evaluated and skipped, see the top-level report) + the
     objects a pixel-sample needs to project into screen space, for the headless pass's own
     budget/pixel-proof check. No production behavior depends on this. */
  OFFGAS, pumpBody, pumpCore, dist, distCore,
  glassMats: { jar: OFFGAS.hitMesh.material, pump: pumpGlassMat, distributor: distHousingMat },
  /* an earlier revision hood-rework verification-only additions — cau exposes the measured hood anchors
     (potMouth/hoodIntake/hoodDuctExit/hoodReady) so the headless pass can project them to screen
     space and pixel-verify catch/gather/send; scene lets it count transmissive materials (budget:
     exactly the 3 above); views lets it reproduce a framing. No production behavior depends on
     any of this. `pulses` is the live in-flight pulse array, exposed read-only so the headless
     pass can project the toDist mass to screen space each frame and prove it rides
     spurt->hood(hidden)->duct->pipe->distributor rather than teleporting past the hood. */
  cau, scene, views, pulses,
  /* Round-2b fix-before-promote verification-only hooks (read-only introspection for the headless
     pass; no production behavior depends on any of these). thirdResolved: whether the 3RD card took
     the resolved-face path (item 1). krv.*: live getters for the pointer/sway/hover/salvo state the
     harness proves items 3-6 against. */
  thirdResolved: !!ogResolved,
  krv: {
    hudHover: () => hudHover,
    leanAmt: () => leanAmt,
    hoveredGroup: () => hoveredGroupIdx,
    salvoTimes: () => salvoQueue.map((s) => s.t),
  }
};
/* an earlier revision verification hooks — same pattern as glass-poc/index.html (the proven recipe's own harness):
   window.__sample reads the drawing buffer directly (preserveDrawingBuffer:true is set on the
   renderer above for exactly this); window.__timeRenders bypasses rAF pacing entirely for an
   honest per-frame cost measurement, uncapped by vsync. Read-only, no production behavior depends
   on either. */
window.__sample = function(cssX, cssY){
  const gl = renderer.getContext();
  const w = canvas.width, h = canvas.height;
  const px = Math.max(0, Math.min(w - 1, Math.round(cssX)));
  const py = Math.max(0, Math.min(h - 1, h - 1 - Math.round(cssY)));
  const data = new Uint8Array(4);
  gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return [data[0], data[1], data[2], data[3]];
};
window.__timeRenders = function(n){
  const t0 = performance.now();
  for (let i = 0; i < n; i++) renderer.render(scene, camera);
  return (performance.now() - t0) / n;
};
window.__project = function(x, y, z){
  const p = new THREE.Vector3(x, y, z).project(camera);
  return { x: Math.round((p.x*0.5+0.5)*W()), y: Math.round((1-(p.y*0.5+0.5))*H()) };
};

/* ============================================================================
   THE HARD LEGIBILITY INVARIANT — TURN8 merge: "merge in r7d's more disciplined per-card LOD
   floors" (GPT-5.5's explicit instruction). r7f's own turn7 fix used a HOME-vs-stage-focus
   BOOLEAN branch (two globals switched by `isHome`) — it worked, but it is one extra piece of
   state a future edit can get out of sync with the camera's actual distance. r7d's system is
   simpler and provably correct at ANY distance, HOME or stage-focus alike, because it asks the
   ONE question that actually matters — "how many pixels is THIS card, right now" — and compares
   it to a floor that lives on the card itself:
     card.lodFloor — every match card defaults to MIN_LEGIBLE_PX (40); the 12 GROUP SUMMARY cards
       override it to the stricter GROUP_LOD_FLOOR (90), since their detail face packs 4 team
       codes into the same footprint a match card gives 2. No isHome branch, no second constant
       pair to keep in sync — one floor per card, one comparison, correct at every distance
       automatically (pitch dial included).
   GLYPH_HIDE_PX is r7f's own addition, kept: below THIS, even the collapsed 2-glyph face is too
   small to read (measured at HOME: R32/R16/OFF-GAS can fall this low) — text hides entirely, the
   glass keeps filling/draining by LEVEL (the brief's own stated fallback channel), and the row's
   distance-locked label (autoLabels, above) carries the stage's own count instead. (MIN_LEGIBLE_PX
   / GROUP_LOD_FLOOR / GLYPH_HIDE_PX are declared up near buildCard, above, so cards can read their
   own default at construction time.) */
const lodTop = new THREE.Vector3(), lodBot = new THREE.Vector3();
function updateCardLOD(card, camera, screenH){
  if (!card.texCollapsed) return;
  /* TRUE screen-space projection (NDC via the camera's actual view+projection matrices), not a
     flat Euclidean-distance estimate: a raw distance measure under-counts off-axis cards (e.g. the
     left/right ends of a wide row sit further from the camera in 3D than the center ones even
     though they occupy the SAME apparent size on screen), which produced a patchy, inconsistent
     LOD across a single row — verified by screenshot: GROUP A collapsed while GROUP B/C two cards
     over stayed in full detail at the identical HOME framing. Projecting the card's own top/bottom
     edge into NDC and reading the actual pixel delta is what a fan's eye measures, so every card in
     a row now flips tier together. */
  lodTop.set(card.x, card.y + card.h/2, 0).project(camera);
  lodBot.set(card.x, card.y - card.h/2, 0).project(camera);
  const projectedPx = Math.abs(lodTop.y - lodBot.y) * 0.5 * screenH;
  const px = isFinite(projectedPx) ? projectedPx : 0;

  const wantCollapsed = px < card.lodFloor;
  const wantHidden = px < GLYPH_HIDE_PX;

  if (wantCollapsed !== card.lodCollapsed) {
    card.textMat.map = wantCollapsed ? card.texCollapsed : card.texDetail;
    card.textMat.needsUpdate = true;
    card.lodCollapsed = wantCollapsed;
  }
  if (wantHidden !== card.lodHidden) {
    card.textMat.opacity = wantHidden ? 0 : 1;
    card.lodHidden = wantHidden;
  }
}

/* ============ animation loop ============ */
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
const leanPt = new THREE.Vector3(), lookPt = new THREE.Vector3(), leanAim = new THREE.Vector3();
function tick(nowMs){
  if (_disposed) return;
  _raf = requestAnimationFrame(tick);
  if (document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = nowMs || performance.now();

  updateGroupHover();

  /* an earlier revision — the pot->hood->pump route was built once at load from fallback anchors; rebuild it from
     the GLBs' MEASURED anchors the moment they're in (onHoodReady set the flag), but never while a
     toDist pulse could be riding those segs (setState RUNNING on leg 0) — the GLB-load race,
     handled instead of hoped away (an earlier fix). */
  if (potRouteDirty && (setState !== 'RUNNING' || legIdx > 0)) { buildPotRoute(); potRouteDirty = false; }

  /* an earlier revision — `|| champMode` so the terminal celebration plays even if the fan had PAUSED the ambient
     brew (setState is 'CHAMP', so the IDLE/RUNNING/EXPLODING branches below stay dormant; only
     champTick drives). The fan's `running` flag is preserved (R1) — this override never mutates it. */
  if (running || champMode) {
    piston.position.y = -9.8 + Math.sin(t*6*pumpSpeed)*0.55;
    pistonCap.position.y = piston.position.y + 1.1;
    flywheel.rotation.z += dt*3.4*pumpSpeed;

    /* R9 #4/#5/#6/#7 — the set/leg state machine. IDLE: the cauldron visibly brews (increasing
       stoke() frequency + a direct charge on fire/spill/distributor glow) for a random 2-15s
       (#7) before the NEXT set departs; RUNNING: exactly one set advances through its 8 legs in
       lockstep over one random 2-8s pot->trophy journey (#6); EXPLODING: the salvo + drain, then
       back to IDLE. No pulses exist and no new set can start except via this sequence — there is
       structurally never a second set in flight (#4). */
    if (setState === 'IDLE') {
      idleT -= dt*pumpSpeed;
      brewCharge = THREE.MathUtils.clamp(1 - idleT/idleDur, 0, 1);
      brewStokeClock -= dt*pumpSpeed;
      if (brewStokeClock <= 0) { cau.stoke(); brewStokeClock = 1.15 - 0.95*brewCharge; }
      if (idleT <= 0) startSet();
    } else if (setState === 'RUNNING') {
      legT += dt*pumpSpeed;
      const dur = legDur[legIdx] || 0.001;
      const frac = legT/dur;
      bulgedThisFrame = new Set();
      for (const p of pulses) positionPulseAtFrac(p, frac);
      for (const entry of prevBulged) { if (!bulgedThisFrame.has(entry)) resetBulge(entry); }
      prevBulged = bulgedThisFrame;
      if (LEGS[legIdx] === 'toTrophy') trophyTargetFrac = THREE.MathUtils.clamp(frac, 0, 1);
      if (frac >= 1) endLeg();
    }

    /* an earlier revision — the championship sequence (setState 'CHAMP') drives the trophy enlarge + salvo + ticker
       + banner itself, holding trophyTargetFrac=1 so the trophy-fill block below renders it full in
       the champion colour. The ambient IDLE/RUNNING/EXPLODING branches above never run in CHAMP. */
    if (champMode) champTick(dt);

    const flick = Math.sin(t*7.3) * 0.5 + Math.sin(t*13.1) * 0.3 + Math.sin(t*23.7) * 0.2;
    fireLight.intensity = 7.6 + flick*1.8 + brewCharge*5.5;
    potSpill.intensity = 26 + brewCharge*18;
    distGlow.intensity = 9 + brewCharge*9;

    cau.update(dt, now);
    tro.update(dt, now);

    matchTip.material.emissiveIntensity = 2.4 + Math.sin(t*11)*1.1;
    flameSprite.scale.set(0.54 + Math.sin(t*13)*0.08, 0.76 + Math.sin(t*17)*0.1, 1);

    pool.scale.setScalar(0.16 + 0.84*trophyTargetFrac);
    poolMat.emissiveIntensity = 0.35 + 2.1*trophyTargetFrac;
    poolMat.opacity = 0.5 + 0.4*trophyTargetFrac;

    /* the trophy's own interior fill — rises ONLY on the FINAL->TROPHY leg (the mass-32 pulse
       actually approaching), reaches 1 exactly on arrival (triggering the explosion, #3), then
       drains after the salvo. Colour is the champion's (#10), molten throughout. */
    if (trophyFluid) {
      const H = trophyMaxY - trophyMinY;
      const localFillY = trophyMinY + trophyTargetFrac * H * 0.98;
      const worldClipY = troHost.position.y + localFillY * troHost.scale.y;
      clipPlane.constant = worldClipY;
      const men = Math.max(0.02, profileRadiusFrac(THREE.MathUtils.clamp(trophyTargetFrac*0.98, 0, 1))) * trophyRadius;
      trophyMeniscus.position.set(0, localFillY, 0);
      trophyMeniscus.scale.setScalar(men);
      const showFill = trophyTargetFrac > 0.015;
      const vPulse = 0.5 + Math.sin(t*3.1)*0.5;
      trophyColScratch.copy(new THREE.Color(explodeColor[0], explodeColor[1], explodeColor[2])).lerp(LIVE_HI, vPulse*0.3);
      trophyFluidMat.color.copy(trophyColScratch);
      trophyGlowMat.color.copy(trophyColScratch);
      /* an earlier revision#1 — fillVis fades the WHOLE fill column (frosted window + coloured core + fill glow +
         meniscus) to nothing during the championship + settle so the trophy reads as SOLID GOLD at
         6.5x/4x scale; champFillHide is 0 the rest of the time, so the cascade's normal fill
         indicator (window/core at their build bases 0.10/0.55) is untouched. Pure function of the
         build-time bases x fillVis — an earlier fix-safe, no snapshot. */
      const fillVis = 1 - champFillHide;
      trophyMenMat.opacity = (showFill ? (0.68 + Math.sin(t*7)*0.15) : 0) * fillVis;
      trophyGlowMat.opacity = (showFill ? (0.5 + Math.sin(t*5.5)*0.12) : 0) * fillVis;
      trophyFluidMat.opacity = 0.55 * fillVis;
      trophyGlass.material.opacity = 0.10 * fillVis;
    }

    if (setState === 'EXPLODING' && phase === 'MATCH DROP') {
      matchT += dt;
      const k = Math.min(matchT/1.1, 1);
      matchGrp.position.set(
        THREE.MathUtils.lerp(MATCH_HOME.x, FINAL.x+0.4, k*k),
        THREE.MathUtils.lerp(MATCH_HOME.y, FINAL.y-0.6, k*k),
        THREE.MathUtils.lerp(MATCH_HOME.z, 0.5, k*k)
      );
      matchGrp.rotation.z = k*2.6;
      if (k >= 1) {
        phase = 'DETONATION'; drainT = 0;
        scheduleSalvo();
        fireShot(explodeColor);   /* #3/#10 — fires on ARRIVAL, first shot in the champion's colour */
        detonateFX();
        matchGrp.visible = false;
        /* the maintainer: "remove the zoom into the finals at the explosion" — the explosion fires wherever
           the viewer is already looking; no forced camera move, no curView mutation here. */
        /* the whole wall drains back to empty for the next set — "a card is empty until its
           pulses arrive" holds every cycle, not just the first. */
        for (const c of PULSE_TRACKED_CARDS) { c.fillTargetA = 0; c.fillTargetB = 0; }
      }
    } else if (setState === 'EXPLODING' && phase === 'DETONATION') {
      drainT += dt;
      for (const shot of salvoQueue) {
        if (!shot.fired && drainT >= shot.t) { shot.fired = true; fireShot(shot.shell); }
      }
      flash.intensity = Math.max(0, flash.intensity - dt*30);
      trophyTargetFrac = Math.max(0, 1 - drainT/1.875);
      if (drainT > salvoEnd) {
        setState = 'IDLE'; phase = 'BREWING';
        idleDur = 2 + Math.random()*13;   /* #7 — 2-15s, randomised post-explosion delay */
        idleT = idleDur;
        matchGrp.visible = true; matchGrp.rotation.z = 0;
        matchGrp.position.copy(MATCH_HOME);
      }
    }
    /* an earlier revision perf note: an always-composited full-viewport overlay (esp. w/ mix-blend-mode) tanked
       fps even at opacity 0 — measured ~4x regression vs an earlier revision. Fixed by keeping it display:none
       and only touching style/layer while a flash is actually decaying.
       an earlier revision (turn5 item 3, GPT-5.5: the salvo "could obscure the champion state") — this overlay
       used to peak at 0.6 alpha, which is a genuine whiteout at those shell colours (several
       SHELLS entries are pale/near-white). Cut to 0.16, then R9 found even THAT still bleached the
       dark hall, because a flat full-viewport fill washes every pixel equally regardless of how
       far it is from the trophy — the starfield and side walls got exactly as flooded as the
       explosion itself. FIX: same peak alpha, but now a radial gradient centred on the trophy's
       own screen position (the FINAL framing puts it just below center) that tapers to fully
       transparent by ~60% of the viewport — the burst still reads as a strong LOCAL flash right at
       the trophy, but the room's own dark depth survives at the edges, through every pop. The
       salvo's own cadence (9 shots, an earlier revision's proven rapid-fire pacing, measured strongest
       climax_response in the batch, 84.07) is untouched — only this wash. */
    screenFlash = Math.max(0, screenFlash - dt*4.2);
    if (detFlashEl) {
      const show = screenFlash > 0.003;
      if (show) {
        const rgb = `${Math.round(flashTint[0]*255)},${Math.round(flashTint[1]*255)},${Math.round(flashTint[2]*255)}`;
        detFlashEl.style.display = 'block';
        detFlashEl.style.opacity = (screenFlash*0.16).toFixed(3);
        detFlashEl.style.background = `radial-gradient(circle at 50% 66%, rgb(${rgb}) 0%, rgba(${rgb},0) 60%)`;
      } else if (flashShown) {
        detFlashEl.style.display = 'none';
      }
      flashShown = show;
    }

    if (burstAge < 3) {
      burstAge += dt;
      for (let i = 0; i < PN; i++) {
        pPos[i*3]   += pVel[i*3]*dt;
        pPos[i*3+1] += pVel[i*3+1]*dt;
        pPos[i*3+2] += pVel[i*3+2]*dt;
        pVel[i*3+1] -= 9*dt;
      }
      pGeo.attributes.position.needsUpdate = true;
      pMat.opacity = Math.max(0, 1 - burstAge/1.4);
    }
    for (const r of rings) {
      r.userData.age += dt;
      const a = r.userData.age;
      if (a > 0 && a < 1.6) {
        const k = a/1.6;
        r.scale.setScalar(0.3 + k*2.3);
        r.position.y = OFFGAS.y + OFFGAS.h/2 + k*2.6;
        r.material.opacity = 0.75*(1-k);
      } else r.material.opacity = 0;
    }

    for (const key in OFFGAS.inletPorts || {}) {
      const tip = OFFGAS.inletPorts[key];
      if (tip.userData.vent > 0) { tip.userData.vent -= dt; tip.material.emissiveIntensity = 1.3 + Math.max(0,tip.userData.vent)*3.0; }
      else tip.material.emissiveIntensity = 1.3;
    }

    for (const c of dynCards) updateCard(c, dt, t);
    updateThirdPools();   // an earlier revision — the decided 3rd-place jar's bronze pools track OFFGAS.fillA/fillB (set by updateCard above); no-op when undecided
    bronzeTick(dt);       // an earlier revision#2 — advance the third-place bronze celebration (pops + ember sprinkle) and its particle sim; no-op once the ~5.6s one-shot is done
    for (const c of dynCards) updateCardLOD(c, camera, H());
    /* TURN8 (Gemini) — ease the group-detail pop-in; a no-op for every other card (revealT sits
       at 1, the loop's own guard skips it) so this costs nothing outside an active hover. */
    for (const dc of groupDetail) {
      if (dc.grp.visible && dc.revealT < 1) {
        dc.revealT = Math.min(1, dc.revealT + dt*6.5);
        const k = 1 - Math.pow(1 - dc.revealT, 3);
        dc.grp.scale.setScalar(0.7 + 0.3*k);
      }
    }

    phaseEl.textContent = champMode ? ('CHAMPION · ' + (TEAM[champWinner] || champWinner || '').toUpperCase())
      : (phase === 'DETONATION' ? 'CHAMPION!' : (setState === 'IDLE' ? 'BREWING' : phase === 'MATCH DROP' ? 'MATCH DROP' : 'SET IN FLIGHT'));
    pulsecountEl.textContent = pulses.length + ' PULSES LIVE · LEG ' + (legIdx >= 0 ? (legIdx+1)+'/8' : '-');
  }

  const vw = views[curView];
  const ease = 1 - Math.pow(0.0018, dt);
  camPos.lerp(tmpV.set(...vw.pos), ease);
  camTgt.lerp(new THREE.Vector3(...vw.tgt), ease);
  smx += (mx - smx) * Math.min(dt*5, 1);
  smy += (my - smy) * Math.min(dt*5, 1);
  const off = camPos.clone().sub(camTgt);
  const yaw = -smx * 0.085, pitch = -smy * 0.055;
  off.applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
  const right = new THREE.Vector3().crossVectors(off, new THREE.Vector3(0,1,0)).normalize();
  off.applyAxisAngle(right, pitch);
  camera.position.copy(camTgt).add(off);

  const rr = Math.hypot(smx, smy);
  const leanTgt = hudHover ? 0 : THREE.MathUtils.smoothstep(rr, 0.22, 0.9) * (curView === 'HOME' ? 1 : 0.38);
  leanAmt += (leanTgt - leanAmt) * Math.min(dt*2.8, 1);
  if (leanAmt > 0.002) {
    const wx = THREE.MathUtils.clamp(smx, -1, 1) * FW * 0.38;
    const wy = FCY + THREE.MathUtils.clamp(-smy, -1, 1) * FH * 0.38;
    leanPt.set(wx, wy, FZ);
    camera.position.lerp(leanPt, leanAmt * 0.26);
    lookPt.copy(camTgt).lerp(leanAim.set(wx, wy, -4), leanAmt * 0.42);
    camera.lookAt(lookPt);
  } else {
    camera.lookAt(camTgt);
  }

  const fishTarget = STAGE_FISH[curView] || 0;
  fishAmt += (fishTarget - fishAmt) * Math.min(dt*2.0, 1);
  camera.fov = BASE_FOV + fishAmt*7;
  camera.updateProjectionMatrix();
  bgGroup.position.z = -fishAmt*5.5;
  bgGroup.scale.setScalar(1 + fishAmt*0.22);
  /* TURN8 FIX #1 (cont.) — cauGroup recedes with the same walls but SHRINKS instead of growing:
     at HOME/GROUPS (fishAmt 0/.12) it is ~full size, looming as the machine's source; by SF/QF/
     FINAL (fishAmt .32-.48) it has receded further AND shrunk up to ~11%, so its screen footprint
     only ever gets smaller as the camera moves toward the bracket's own close framings — never
     bigger, never intruding on the card read. */
  cauGroup.position.z = -fishAmt*5.5;
  cauGroup.scale.setScalar(1 - fishAmt*0.23);

  /* auto-sized labels (TURN7 FIX #3) — re-derive each label's world scale from the LIVE camera
     distance every frame so its on-screen height never drops below its own targetPx, at any view
     or pitch-dial position. Cheap: ~9 labels, one distance + one trig call each. */
  const vFOVh = camera.fov * Math.PI/180;
  for (const al of autoLabels) {
    const d = camera.position.distanceTo(al.grp.position);
    const worldPerPx = 2*d*Math.tan(vFOVh/2) / H();
    const hWorld = al.targetPx * worldPerPx;
    al.grp.scale.setScalar(hWorld / al.baseH);
  }

  renderer.render(scene, camera);
}
tick();

on(window, 'resize', () => {
  camera.aspect = W()/H();
  camera.updateProjectionMatrix();
  renderer.setSize(W(), H());
});
/* ============================ ported scene (an earlier revision) ends ============================ */

  // expose the verification hooks on the returned controller too (Playwright reaches window.__* directly)
  const controller = {
    THREE, scene, camera, renderer, dispose,
    /* cert R1 — the viewer state a change-gated remount must carry across (view/dials/pause);
       read live so it reflects whatever the fan last touched, not mount-time values. */
    getViewerState: () => ({ view: curView, speed: speedEl.value, pitch: pitchEl.value, running, finalState: FINAL_STATE }),
    /* an earlier revision — true while the championship sequence owns the mount (liftoff..settle, terminal). The
       observer uses this to NEVER dispose a mount mid-championship: a change-gated remount for later
       DOM churn (i18n/hydration/another match's live tick) would LOSE the moment (task item 1). */
    isChamp: () => champMode,
    hooks: { pulseState: window.__pulseState, detonate: window.__detonate, sample: window.__sample, project: window.__project, dbg: window.__dbg },
  };

  function dispose() {
    if (_disposed) return;
    _disposed = true;
    try { if (_raf) cancelAnimationFrame(_raf); } catch (e) {}
    for (const [t, ev, fn, o] of _listeners) { try { t.removeEventListener(ev, fn, o); } catch (e) {} }
    _listeners.length = 0;
    // dispose all GL resources so repeated 2D<->3D toggling never leaks a context
    try { scene.traverse((o) => { if (o.geometry) o.geometry.dispose && o.geometry.dispose(); const m = o.material; if (m) { (Array.isArray(m) ? m : [m]).forEach((x) => { if (!x) return; for (const k in x) { const v = x[k]; if (v && v.isTexture && v.dispose) v.dispose(); } x.dispose && x.dispose(); }); } }); } catch (e) {}
    try { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } catch (e) {}
    for (const h of _winHooks) { try { delete window[h]; } catch (e) {} }
    /* cert R2 — clear the mount signature: a stale __krSig on a disposed root made a re-mount's
       change-gate compare against a dead mount and (with two toggles in flight) blank the Room. */
    try { delete root.__krSig; } catch (e) {}
    try { root.replaceChildren(); root.classList.remove('kr-root'); } catch (e) {}
  }

  return controller;
}

/* ============================================================================
 * [2D | 3D] TOGGLE — the opt-in gateway (pattern proven by the historical bracket-3d.js).
 * Default ALWAYS 2D (the certified Bracket Monument is what people see first). The toggle is NOT
 * offered at all when: no WebGL, prefers-reduced-motion, viewport < 900px wide, or deviceMemory <= 2.
 * ============================================================================ */
(function () {
  const wrap = document.querySelector('.bracket-wrap');
  if (!wrap) return;
  const win = wrap.querySelector('.bracket-window');
  const stages = wrap.querySelector('.bracket-stages');
  if (!win || !stages) return;

  function hasWebGL() {
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; }
  }
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lowMem = !!(navigator.deviceMemory && navigator.deviceMemory <= 2);
  /* cert R8 — DESKTOP-ONLY BY DESIGN, disclosed: the Room is offered only at >=900px viewports
     (plus WebGL / motion / memory floors below). Phones and small tablets get the certified 2D
     Monument ONLY — the predecessor bracket-3d.js's mobile pinch/swipe input was deliberately NOT
     ported (the Room's HUD dials + hover raycasts are pointer-tuned; a first-class touch pass is
     a scoped follow-up, not a silent degradation). Checked once at load, like the sibling gates. */
  const tiny = () => window.innerWidth < 900;
  // Offer the toggle only where the Room can run well; otherwise the page is pure certified 2D.
  if (!hasWebGL() || reduced || lowMem || tiny()) return;

  /* R10 KILL-SWITCH (owner 2026-07-18) — a runtime config flag can disable the whole 3D Room for
     everyone WITHOUT a site redeploy, mirroring the ops-flags -> config.json precedent (worker/
     admin.mjs ops_flags baked to /data/config.json). The client reads flags.knockoutRoom3d from the
     same-origin /data/config.json the bake emits; only an explicit `false` disables. A missing key,
     an unreachable config, or the default all leave the Room ENABLED (fail-open — the certified
     default stays offered). When disabled: install() never runs, so no toggle is injected,
     mountKnockoutRoom is never reached, three.js/the GLBs are never fetched (loadMods only runs on
     opt-in). */
  fetch('/data/config.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((cfg) => {
      if (cfg && cfg.flags && cfg.flags.knockoutRoom3d === false) return; // killed: page stays pure 2D
      install();
    });

  function install() {
  // inject the CSS once
  if (!document.getElementById('kr-style')) { const st = document.createElement('style'); st.id = 'kr-style'; st.textContent = KR_CSS; document.head.appendChild(st); }

  let host = null, controller = null, mode = '2d', busy = false;

  const seg = document.createElement('div');
  seg.className = 'bk-viewseg kr-viewseg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Bracket view');
  seg.innerHTML =
    '<button type="button" class="bk-btn kr-view on" data-view="2d" aria-pressed="true">2D</button>' +
    '<button type="button" class="bk-btn kr-view" data-view="3d" aria-pressed="false">3D</button>';
  stages.appendChild(seg);
  const btns = Array.prototype.slice.call(seg.querySelectorAll('.kr-view'));
  const setPressed = (m) => btns.forEach((b) => { const onb = b.dataset.view === m; b.classList.toggle('on', onb); b.setAttribute('aria-pressed', onb ? 'true' : 'false'); });

  let mo = null, resyncTimer = 0;
  function startObserver() {
    const halves = win.querySelector('.bracket.halves');
    if (!halves || typeof MutationObserver === 'undefined') return;
    mo = new MutationObserver(() => {
      clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        if (mode !== '3d' || !controller) return;
        try {
          // change-gated remount: only rebuild when the parsed bracket state actually changed.
          // cert R1: capture the outgoing mount's viewer state BEFORE dispose and hand it to the
          // new mount, so a result landing mid-view never yanks the fan's camera/dials/pause.
          const nextParsed = parseBracket(win);
          const next = nextParsed.sig;
          if (host && host.__krSig && next !== host.__krSig) {
            const c = controller;
            /* an earlier revision — never dispose a mount mid-championship (task item 1: a plain remount would lose
               the moment). The championship is terminal (the final is the last match), so once it is
               playing, later sig churn must not interrupt it. */
            if (c && c._real && c._real.isChamp && c._real.isChamp()) return;
            controller = null;
            const vs = (c && c._real && c._real.getViewerState) ? c._real.getViewerState() : null;
            /* an earlier revision LIVE FLIP (item 1) — the final going sched/live -> ft while the Room is mounted.
               Remount carrying the fan's viewer state (R1) and tell the fresh mount to fire the FULL
               championship (champLive). Any OTHER change (or the final already ft) is a plain remount
               that does NOT replay the sequence. isTBD isn't in this scope; the parse only reports
               FINAL_STATE 'ft' WITH a real winner (.bbrow.w — an earlier fix), so an inline __TBD guard suffices. */
            const fw = nextParsed.FINAL_ROW && nextParsed.FINAL_ROW[0];
            const nowFtFinal = nextParsed.FINAL_STATE === 'ft' && typeof fw === 'string' && fw.indexOf('__TBD') !== 0;
            const champLive = !!(vs && vs.finalState !== 'ft' && nowFtFinal);
            c.dispose(); controller = mountAsync(vs, champLive);
          }
        } catch (e) {}
      }, 900);
    });
    mo.observe(halves, { subtree: true, childList: true, characterData: true, attributes: true });
  }
  function stopObserver() { if (mo) { mo.disconnect(); mo = null; } clearTimeout(resyncTimer); }

  function mountAsync(restoreState, champLive) {
    const c = { dispose() { if (this._real) this._real.dispose(); else this._pendingDispose = true; } };
    mountKnockoutRoom(host, { onExit: to2D, bracketWin: win, restoreState, champLive }).then((real) => { c._real = real; if (c._pendingDispose) real.dispose(); }).catch(() => { to2D(); });
    return c;
  }

  async function to3D() {
    if (mode === '3d' || busy) return;
    busy = true;
    try {
      host = document.createElement('div');
      host.className = 'kr-host';
      win.insertAdjacentElement('afterend', host);
      win.style.display = 'none';
      controller = mountAsync();
      mode = '3d';
      setPressed('3d');
      startObserver();
    } catch (e) {
      to2D();
    } finally { busy = false; }
  }

  function to2D() {
    if (mode === '2d') { return; }
    stopObserver();
    try { if (controller) controller.dispose(); } catch (e) {}
    controller = null;
    try { if (host) host.remove(); } catch (e) {}
    host = null;
    win.style.display = '';
    if (!win.getAttribute('style')) win.removeAttribute('style');
    mode = '2d';
    setPressed('2d');
    /* cert fix-before-promote (item 3) — exiting 3D (toggle, Escape, or a lost GL context) used to
       drop focus to <body>; return it to the toggle control so keyboard users are not stranded. */
    const twoBtn = btns.find((b) => b.dataset.view === '2d');
    if (twoBtn) { try { twoBtn.focus(); } catch (e) {} }
  }

  seg.addEventListener('click', (e) => { const b = e.target.closest('.kr-view'); if (!b) return; b.dataset.view === '3d' ? to3D() : to2D(); });
  } // end install()
})();
