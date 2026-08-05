// Bracket 3D floating scene — a progressive enhancement OVER the shipped 2D telescope bracket
// (the design plan3DScene_v1). The 2D telescope (.bracket-window + bracket-zoom.js +
// bracket-connectors.js) is the certified floor and stays BYTE-UNTOUCHED; this module only ADDS a
// [2D|3D] toggle + a fresh .bracket-scene sibling, and in 3D mode display:none's .bracket-window AS A
// UNIT (so bracket-connectors.js needs no edit — its measurements just degenerate to zero).
//
// PHASE 0 (this file, scaffold): feature-detect WebGL, inject the toggle (DEFAULT 2D, GL created ONLY
// on opt-in), lazy-load the VENDORED Three (same-origin /vendor/, no CDN/CSP), dispose on toggle-back
// (no GL-context leak across cycles), fail safe to 2D on any error. Phases 1-4 fill in build3D() with
// the real cards/tubes/light-race/interaction/perf. Nothing here loads Three on the default page path.
(function () {
  const wrap = document.querySelector('.bracket-wrap');
  if (!wrap) return;
  const win = wrap.querySelector('.bracket-window');
  const stages = wrap.querySelector('.bracket-stages');
  if (!win || !stages) return;

  // Feature-detect a REAL WebGL context (don't assume). No context → no toggle at all → pure 2D floor.
  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }
  // Low-power / tiny-viewport heuristics — the 3D scene is a pay-per-use enhancement; on a weak device
  // cap the pixel ratio, and on a viewport too narrow to render the constellation legibly keep the
  // certified 2D telescope (no toggle at all). the maintainer's 375px is supported; only drop far below that.
  const lowPower = () => (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  const tinyViewport = () => window.innerWidth < 340;
  if (!hasWebGL() || tinyViewport()) return; // no WebGL or too narrow → pure 2D floor, no toggle

  const KEY = 'g26-bracket-view';
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let controller = null; // the live 3D scene controller (Phase 1+); null in 2D
  let mode = '2d';
  let busy = false;

  // Fresh, non-clipped container — NEVER inside .bracket-window/.bcol (both overflow:hidden, which
  // would clip the CSS3D preserve-3d transforms). Sibling immediately after the 2D window.
  const sceneEl = document.createElement('div');
  sceneEl.className = 'bracket-scene';
  sceneEl.hidden = true;
  win.insertAdjacentElement('afterend', sceneEl);

  // [2D | 3D] toggle — default 2D; never auto-enters 3D on reduced-motion (manual opt-in still allowed).
  const seg = document.createElement('div');
  seg.className = 'bk-viewseg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Bracket view');
  seg.innerHTML =
    '<button type="button" class="bk-view on" data-view="2d" aria-pressed="true">2D</button>' +
    '<button type="button" class="bk-view" data-view="3d" aria-pressed="false">3D</button>';
  stages.appendChild(seg);
  const btns = Array.prototype.slice.call(seg.querySelectorAll('.bk-view'));
  const setPressed = (m) => btns.forEach((b) => {
    const on = b.dataset.view === m;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  async function to3D() {
    if (mode === '3d' || busy) return;
    busy = true;
    try {
      // Lazy-load the vendored bundle — this is the ONLY place Three is fetched, and only on opt-in.
      const [THREE, css3d, bgu] = await Promise.all([
        import('/vendor/three.module.min.js'),
        import('/vendor/CSS3DRenderer.js'),
        import('/vendor/BufferGeometryUtils.js'),
      ]);
      // Show + size the scene host FIRST (hide the 2D telescope AS A UNIT — connectors.js untouched),
      // THEN build so the renderers measure the real container size (not 0 while hidden).
      win.style.display = 'none';
      sceneEl.hidden = false;
      controller = buildScene(THREE, css3d, bgu, sceneEl, wrap);
      mode = '3d';
      setPressed('3d');
      try { localStorage.setItem(KEY, '3d'); } catch (e) {}
    } catch (e) {
      // vendored import failed / GL init threw → stay on the certified 2D floor
      teardown();
      win.style.display = '';
      sceneEl.hidden = true;
      mode = '2d';
      setPressed('2d');
    } finally { busy = false; }
  }

  function to2D(remember) {
    if (busy) return;
    teardown();
    sceneEl.hidden = true;
    win.style.display = '';
    mode = '2d';
    setPressed('2d');
    if (remember !== false) { try { localStorage.setItem(KEY, '2d'); } catch (e) {} }
  }

  // Toggle-cycle-safe teardown (the design plan §8 B): dispose the controller + empty the container so
  // repeated 2D<->3D cycling never leaks a WebGL context.
  function teardown() {
    try { if (controller && controller.dispose) controller.dispose(); } catch (e) {}
    controller = null;
    sceneEl.replaceChildren();
  }

  // ---- PHASE 1: the floating cards (CSS3DObject from the real .bbox DOM) ----
  // Cards are CLONES of the real baked .bbox leaves (crisp DOM, real Monument styling = one source of
  // truth). §8 D: neutralize the app.js hooks on each clone (data-mno→data-scene-mno, strip
  // data-match-teams + inner [data-match]) so the certified live-tick + healIdentity only ever touch
  // the 2D originals — the 2D window stays in the DOM (display:none) and app.js keeps hydrating it;
  // Phase 3 mirrors that live state onto the clones.
  const ROUND = { 'b-r32': 0, 'b-r16': 1, 'b-qf': 2, 'b-sf': 3, 'b-final': 4 };
  const MAXR = 4;

  function buildScene(THREE, css3d, bgu, host, wrapEl) {
    if (!(THREE && THREE.Scene && css3d && css3d.CSS3DRenderer)) throw new Error('vendored three/css3d missing exports');
    const { CSS3DRenderer, CSS3DObject } = css3d;
    const w2d = wrapEl.querySelector('.bracket-window');

    const glwrap = document.createElement('div'); glwrap.className = 'b3d-gl';
    const csswrap = document.createElement('div'); csswrap.className = 'b3d-css';
    host.append(glwrap, csswrap);

    // Mobile card reader: floating cards are small on a phone, so a tap opens a
    // readable full-width sheet with the tie's real detail. Desktop uses the in-scene focus-forward.
    const reader = document.createElement('div');
    reader.className = 'b3d-reader'; reader.hidden = true;
    host.appendChild(reader);

    const W = () => host.clientWidth || 1, H = () => host.clientHeight || 1;
    const mobile = W() <= 480;

    const three = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, W() / H(), 1, 4000);
    camera.position.set(0, 36, mobile ? 560 : 720);
    camera.lookAt(0, 0, 0);

    const wgl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    wgl.setPixelRatio(Math.min(devicePixelRatio, lowPower() ? 1.5 : 2)); // fill rate is the mobile bottleneck — cap it, tighter on low-power
    // GL-context loss (driver reset / too many contexts) → fall back to the certified 2D telescope, no dead canvas.
    wgl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); try { to2D(true); } catch (err) {} }, false);
    wgl.setSize(W(), H());
    wgl.setClearColor(0x000000, 0);
    glwrap.appendChild(wgl.domElement);

    const css = new CSS3DRenderer();
    css.setSize(W(), H());
    css.domElement.style.position = 'absolute';
    css.domElement.style.inset = '0';
    csswrap.appendChild(css.domElement);

    const render = () => { wgl.render(three, camera); css.render(three, camera); };

    // Real KO columns (skip the off/group columns — the constellation is R32→Final).
    const cols = Array.prototype.slice.call(w2d.querySelectorAll('.bcol'))
      .filter((c) => !c.classList.contains('off') && [...c.classList].some((k) => k in ROUND));
    const DX = mobile ? 120 : 150, DZ = 150, DY = mobile ? 58 : 68;
    const objs = [];
    const anchors = {}; // match_no → inner-edge Vector3 (tube endpoints)
    const finalLeaf = w2d.querySelector('.bcol.b-final .bbox');
    const finalMno = finalLeaf ? (finalLeaf.dataset.mno || '') : '';

    cols.forEach((col) => {
      const round = ROUND[[...col.classList].find((k) => k in ROUND)];
      const wing = col.classList.contains('side-l') ? -1 : col.classList.contains('side-r') ? 1 : 0;
      const leaves = Array.prototype.slice.call(col.querySelectorAll('.bbox'));
      const n = leaves.length;
      leaves.forEach((leaf, i) => {
        const clone = leaf.cloneNode(true);
        clone.removeAttribute('data-match-teams');
        if (clone.dataset.mno != null) { clone.setAttribute('data-scene-mno', clone.dataset.mno); clone.removeAttribute('data-mno'); }
        clone.querySelectorAll('[data-match]').forEach((el) => el.removeAttribute('data-match'));
        clone.classList.add('b3d-card'); // keep the natural <a href> link (focusable; first-tap opens, second navigates)
        // The .b-final column holds TWO ties — the real Final AND the 3rd-place playoff. Only the real
        // Final (matches finalMno) is the hero; the 3rd-place is a distinct secondary card (below, no gold).
        const isFinal = round === MAXR && leaf.dataset.mno === finalMno;
        if (isFinal) clone.classList.add('b3d-final'); // hero: gold border + red glow (folds in #342)
        const obj = new CSS3DObject(clone);
        let x, y, z, ry, s;
        if (isFinal) {
          // Hero anchor: the Final is raised + forward, where the camera rests by default (gold .b3d-final).
          x = 0; y = mobile ? 6 : 30; z = DZ * 1.25; ry = 0; s = mobile ? 1.1 : 1.2;
        } else if (round === MAXR) {
          // 3rd-place playoff (also in .b-final): a distinct secondary card BELOW + behind the hero Final,
          // never stacked on it, never gold.
          x = 0; y = mobile ? -32 : -46; z = DZ * 0.55; ry = 0; s = 0.82;
        } else {
          // INVERTED topology (the maintainer 0666): the climax (fewest teams) anchors the centre; the MOST teams
          // (R32) radiate OUTWARD. out = depth from centre — r32=3 (outer/back) … sf=0 (inner/near Final).
          const out = (MAXR - 1 - round);
          x = wing * ((mobile ? 132 : 150) + out * DX);
          y = (i - (n - 1) / 2) * DY;
          z = -out * DZ * 0.55;
          ry = wing > 0 ? -0.22 : 0.22; s = 0.92;
        }
        const baseScale = s * (mobile ? 0.62 : 0.42);
        obj.position.set(x, y, z);
        obj.rotation.y = ry;
        obj.scale.setScalar(baseScale);
        three.add(obj);
        obj.userData = { origin: leaf, el: clone, feeds: leaf.dataset.feeds || '', sceneMno: leaf.dataset.mno || '', wing, round,
          baseZ: z, baseY: y, ry, baseScale, targetZScale: 0, zsc: 0, final: isFinal };
        // inner-edge anchor toward centre (tube endpoints, Phase 2)
        obj.userData.anchor = new THREE.Vector3(x - wing * 6, y, z);
        if (leaf.dataset.mno) anchors[leaf.dataset.mno] = obj.userData.anchor;
        objs.push(obj);
      });
    });

    // ---- CAMERA — focus-by-default (design-critique rework 0663/0666). The scene LANDS framed on ONE
    // legible region (the hero Final + its SF feeders, or a live tie) — NEVER the whole tree. The full
    // constellation is an opt-in OVERVIEW. Click a card, a stage chip, or the Overview button to fly the
    // camera to a new focus; it eases there (reduced-motion snaps). One source of truth: a target frame
    // {cx,cy,cz = lookAt point, dist = pull-back along +Z}. ----
    const VFOV = 46 * Math.PI / 180;
    const ELEV = mobile ? 10 : 22; // slight downward tilt → cards read as a lit stage, not a flat wall
    const fitV = (vExtent) => (vExtent / 2) / Math.tan(VFOV / 2);
    const fitH = (hExtent) => (hExtent / 2) / Math.tan(Math.atan(Math.tan(VFOV / 2) * (W() / H())));
    const extentX = Math.max(1, ...objs.map((o) => Math.abs(o.position.x))) + (mobile ? 70 : 60);
    const extentY = Math.max(1, ...objs.map((o) => Math.abs(o.position.y))) + DY;
    const extentZ = Math.max(0, ...objs.map((o) => o.position.z));

    // Free-look controls (the maintainer 0673): drag TILTS/orbits (bounded), wheel ZOOMS, WASD MOVES the focus
    // (click-to-engage). yaw/pitch overlay the focus framing — at 0/0 the camera is the original straight-on
    // framed view, so every frame* computation below is unchanged. A dev-only slider tunes the range live.
    const IS_DEV = !!(self.__G26_DEV__);
    const minDist = fitV(DY * 1.7), maxDist = Math.max(fitV(extentY * 2 + DY), fitH(extentX * 2)) + extentZ;
    const MOBILITY = { yaw: 0.6, pitch: 0.42 }; // generous but bounded (rad); scaled live by the dev slider
    let mobility = 1;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const yawMax = () => MOBILITY.yaw * mobility, pitchMax = () => MOBILITY.pitch * mobility;
    const fcam = { cx: 0, cy: 0, cz: 0, dist: 500, yaw: 0, pitch: 0, tcx: 0, tcy: 0, tcz: 0, tdist: 500, mode: 'focus' };
    let camMoving = true, focusRound = MAXR;
    const applyFcam = () => {
      const cp = Math.cos(fcam.pitch), sp = Math.sin(fcam.pitch), cyw = Math.cos(fcam.yaw), syw = Math.sin(fcam.yaw);
      camera.position.set(fcam.cx + fcam.dist * cp * syw, fcam.cy + ELEV + fcam.dist * sp, fcam.cz + fcam.dist * cp * cyw);
      camera.lookAt(fcam.cx, fcam.cy, fcam.cz);
    };
    function frameTo(cx, cy, cz, dist, mode) {
      fcam.tcx = cx; fcam.tcy = cy; fcam.tcz = cz; fcam.tdist = dist; fcam.mode = mode || 'focus'; camMoving = true;
      if (reduced) { fcam.cx = cx; fcam.cy = cy; fcam.cz = cz; fcam.dist = dist; applyFcam(); render(); }
    }
    const STAGEKEY = { 0: 'r32', 1: 'r16', 2: 'qf', 3: 'sf', 4: 'final' }, CHIPR = { r32: 0, r16: 1, qf: 2, sf: 3 };
    const chips = Array.prototype.slice.call(stages.querySelectorAll('[data-bk-stage]'));
    function syncChips() { // "you are here" — light the chip for the focused round (null in overview)
      const key = focusRound < 0 ? null : STAGEKEY[focusRound];
      chips.forEach((c) => c.classList.toggle('on', key != null && c.getAttribute('data-bk-stage') === key));
    }
    function frameNode(obj) {
      const p = obj.position;
      frameTo(p.x, p.y, p.z, Math.max(fitV(DY * (mobile ? 2.4 : 2.9)), fitH(mobile ? 150 : 200)), 'node');
      focusRound = obj.userData.round; syncChips();
    }
    function frameRound(round) {
      const rs = objs.filter((o) => o.userData.round === round);
      if (!rs.length) return;
      const ys = rs.map((o) => o.position.y), xs = rs.map((o) => o.position.x), zs = rs.map((o) => o.position.z);
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const vE = Math.min((Math.max(...ys) - Math.min(...ys)) + DY * 1.6, extentY * 2);
      const hE = (Math.max(...xs) - Math.min(...xs)) + (mobile ? 160 : 200);
      frameTo(0, cy, cz, Math.max(fitV(vE), fitH(hE)), 'round');
      focusRound = round; syncChips();
    }
    function frameFinalRegion() { // the hero rest frame — the Final crowning its two SF feeders, always legible
      const fin = objs.find((o) => o.userData.final);
      const feeders = objs.filter((o) => o.userData.round === MAXR - 1);
      const set = fin ? [fin].concat(feeders) : feeders;
      if (!set.length) { overview(); return; }
      const ys = set.map((o) => o.position.y), xs = set.map((o) => o.position.x), zs = set.map((o) => o.position.z);
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const vE = (Math.max(...ys) - Math.min(...ys)) + DY * 2.4;
      const hE = (Math.max(...xs) - Math.min(...xs)) + (mobile ? 170 : 240); // fit BOTH SF feeders + the Final
      frameTo(0, cy, cz, Math.max(fitV(vE), fitH(hE), 240), 'focus');
      focusRound = MAXR; syncChips();
    }
    function overview() { // the full constellation — opt-in spectacle, not the landing state
      frameTo(0, 0, extentZ * 0.25, Math.max(fitV(extentY * 2 + DY), fitH(extentX * 2)) + extentZ, 'overview');
      focusRound = -1; syncChips();
    }
    function reframe() { // keep the current focus legible across resizes
      if (fcam.mode === 'overview') overview();
      else if (fcam.mode === 'round') frameRound(focusRound);
      else if (fcam.mode === 'node' && openObj) frameNode(openObj);
      else frameFinalRegion();
    }
    // Round traversal (the maintainer 0663 "arrows/swipe to traverse rounds"): step the focus one round toward the
    // Final (+1) or toward R32 (-1), clamped. From the overview, a step drops into the Final.
    function stepRound(dir) {
      let r = focusRound < 0 ? MAXR : focusRound;
      r = Math.max(0, Math.min(MAXR, r + dir));
      (r === MAXR) ? frameFinalRegion() : frameRound(r);
    }
    // Arrow keys traverse rounds (keyboard a11y): →/↑ toward the Final, ←/↓ toward R32. Listener on the
    // scene host — card keydowns bubble up here, so arrows only act while the bracket is focused (they
    // never hijack page scroll elsewhere). Removed on dispose (host persists across toggle cycles).
    const onKey = (e) => {
      let dir = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dir = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dir = -1;
      else return;
      e.preventDefault(); e.stopPropagation(); stepRound(dir);
    };
    host.addEventListener('keydown', onKey);

    // Stage chips fly the 3D camera while the scene is live (capture-phase → beats bracket-zoom's own
    // per-button handler; dispose removes it, so the 2D telescope stays untouched). 'group' → overview;
    // each KO chip → that round; 'final' → the hero region.
    const onChip = (e) => {
      const b = e.target.closest('[data-bk-stage]'); if (!b) return;
      const st = b.getAttribute('data-bk-stage');
      e.stopPropagation(); e.preventDefault();
      if (st === 'group') overview();
      else if (st === 'final') frameFinalRegion();
      else if (st in CHIPR) frameRound(CHIPR[st]);
    };
    stages.addEventListener('click', onChip, true);

    // Overview toggle button (opt-in spectacle). Lives in the scene corner; removed on dispose.
    const ovBtn = document.createElement('button');
    ovBtn.type = 'button'; ovBtn.className = 'b3d-overview'; ovBtn.textContent = 'Overview';
    ovBtn.setAttribute('aria-label', 'Toggle full-bracket overview');
    ovBtn.addEventListener('click', () => { const toOv = fcam.mode !== 'overview'; toOv ? overview() : frameFinalRegion(); ovBtn.textContent = toOv ? 'Focus' : 'Overview'; });
    host.appendChild(ovBtn);

    // ---- PHASE 2: curved TubeGeometry arrows with UV-scroll light-racing ----
    // Real curved 3D arrows (child inner-edge → parent inner-edge, bowed toward centre) with a glowing
    // band flowing TOWARD the Final. Baked-unlit: MeshBasicMaterial + an emissive strip texture (no
    // real lights, no bloom pass). Merged into ~3 draw calls by state bucket (perf budget §1.3). State
    // read from the LIVE 2D original's pill (one source of truth), same buckets bracket-connectors uses.
    const { mergeGeometries } = bgu;
    const COL = { ft: 0x2ee06f, live: 0xff5a4d, sched: 0x3a4658 };
    const COLHEX = { ft: '#2ee06f', live: '#ff5a4d', sched: '#3a4658' };
    const stateOf = (leaf) => leaf.querySelector('.bbst .pill.live') ? 'live'
      : (leaf.querySelector('.bbst .pill.ft') ? 'ft' : 'sched');
    function stripTexture(hex) {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#05070c'; cx.fillRect(0, 0, 64, 8);
      const g = cx.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.38, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, hex); g.addColorStop(0.62, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g; cx.fillRect(0, 0, 64, 8);
      const tx = new THREE.CanvasTexture(cv);
      tx.wrapS = THREE.RepeatWrapping; tx.wrapT = THREE.ClampToEdgeWrapping;
      return tx;
    }
    // Built as a FUNCTION so the §8 D live-mirror can rebuild the arrows when a tie's live state flips
    // (scheduled→live→decided), re-bucketing the tube colour. Disposes the prior meshes first.
    const tubeGroup = new THREE.Group(); three.add(tubeGroup);
    const tubeMats = {}, flowInfo = {};
    function buildTubes() {
      tubeGroup.children.slice().forEach((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } });
      tubeGroup.clear();
      Object.keys(tubeMats).forEach((k) => { delete tubeMats[k]; delete flowInfo[k]; });
      objs.forEach((o) => { o.userData._tubeState = stateOf(o.userData.origin); }); // seed so the mirror won't spuriously rebuild
      const buckets = { ft: [], live: [], sched: [] };
      objs.forEach((obj) => {
        const feeds = obj.userData.feeds;
        if (!feeds || !anchors[feeds]) return; // Final / third-place / unresolved parent → no arrow
        const p0 = obj.userData.anchor, p1 = anchors[feeds];
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        mid.x *= 0.55; mid.z += 40; mid.y += 6;
        const curve = new THREE.CatmullRomCurve3([p0.clone(), mid, p1.clone()]);
        const finalInbound = feeds === finalMno;
        buckets[stateOf(obj.userData.origin)].push({ geo: new THREE.TubeGeometry(curve, 24, finalInbound ? 2.6 : 2.0, 6, false), curve, finalInbound });
      });
      Object.keys(buckets).forEach((st) => {
        if (!buckets[st].length) return;
        const merged = mergeGeometries(buckets[st].map((b) => b.geo), false);
        const tex = stripTexture(COLHEX[st]); tex.repeat.set(6, 1);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: st === 'sched' ? 0.5 : 0.95 });
        tubeGroup.add(new THREE.Mesh(merged, mat));
        tubeMats[st] = mat;
        flowInfo[st] = { speed: st === 'live' ? 1.35 : st === 'ft' ? 0.5 : 0.16 };
        tubeGroup.add(new THREE.Mesh(merged.clone(), new THREE.MeshBasicMaterial({ color: COL[st], transparent: true, opacity: st === 'sched' ? 0.10 : 0.16, depthWrite: false })));
        // arrowhead cones — bake each transform INTO its geometry + merge per bucket, so the whole
        // bucket's arrowheads are ONE draw call (perf budget §1.3: <30 draw calls total, not ~28 cones).
        const coneGeos = buckets[st].map((b) => {
          const t1 = b.curve.getPointAt(1), dir = t1.clone().sub(b.curve.getPointAt(0.94)).normalize();
          const cg = new THREE.ConeGeometry(b.finalInbound ? 7 : 5, b.finalInbound ? 16 : 12, 8);
          cg.applyMatrix4(new THREE.Matrix4().compose(t1, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), new THREE.Vector3(1, 1, 1)));
          return cg;
        });
        if (coneGeos.length) {
          tubeGroup.add(new THREE.Mesh(mergeGeometries(coneGeos, false),
            new THREE.MeshBasicMaterial({ color: COL[st], transparent: true, opacity: st === 'sched' ? 0.4 : 0.85, depthWrite: false })));
        }
      });
    }
    buildTubes();

    // ---- Round labels (wayfinding): 2D has column headers; 3D dropped them. One small CSS3D label above
    // each round's top card, per wing (Final gets one). Cheap DOM in the CSS layer, no GL cost. ----
    const RLABEL = { 0: 'ROUND OF 32', 1: 'ROUND OF 16', 2: 'QUARTERS', 3: 'SEMIS', 4: 'FINAL' };
    (function roundLabels() {
      const groups = {};
      objs.forEach((o) => { const k = o.userData.round + ':' + o.userData.wing; (groups[k] = groups[k] || []).push(o); });
      Object.keys(groups).forEach((k) => {
        const g = groups[k], top = g.reduce((a, b) => (b.position.y > a.position.y ? b : a)), r = top.userData.round;
        const d = document.createElement('div'); d.className = 'b3d-rlabel'; d.textContent = RLABEL[r];
        const lo = new CSS3DObject(d);
        lo.position.set(top.position.x, top.position.y + (r === MAXR ? 70 : DY * 0.72), top.position.z);
        lo.scale.setScalar(top.userData.baseScale * 0.92);
        three.add(lo);
      });
    })();

    // Land FOCUSED, not on the whole tree (the core critique fix): a live tie if one is running, else the
    // hero Final region. Snap the very first frame (no fly-in from nowhere); every navigation after eases.
    (function initialFocus() {
      const live = objs.find((o) => stateOf(o.userData.origin) === 'live');
      live ? frameNode(live) : frameFinalRegion();
      fcam.cx = fcam.tcx; fcam.cy = fcam.tcy; fcam.cz = fcam.tcz; fcam.dist = fcam.tdist; camMoving = false; applyFcam();
    })();

    // ---- PHASE 3: interaction — tap a card to bring it forward + reveal its A6 detail ----
    // §8 C: cloneNode drops the listeners bracket-zoom.js bound to the 2D .bbox, so re-attach the A6
    // reveal here, scoped to the scene clones (bracket-zoom.js stays diff=0). Reuse the shipped
    // .bk-reveal class → the clone's real .bk-detail shows. First tap opens+reveals; a second tap on an
    // already-open card follows its href to the match page (the 2D A6 touch pattern). Esc / click-away closes.
    let openObj = null;
    // reduced-motion has no render loop, so apply the focus-forward transform INSTANTLY + paint once.
    function applyInstant(obj) {
      const u = obj.userData; u.zsc = u.targetZScale || 0;
      obj.position.z = u.baseZ + u.zsc * 200;
      obj.position.y = u.baseY - u.zsc * 6;
      obj.scale.setScalar(u.baseScale * (1 + u.zsc * 0.6));
      obj.rotation.y = u.ry * (1 - u.zsc);
      render();
    }
    function fillReader(obj) {
      reader.replaceChildren();
      const card = obj.userData.el.cloneNode(true); // the real .bbox content at normal (readable) size
      card.classList.add('bk-reveal'); card.classList.remove('b3d-card');
      const close = document.createElement('button');
      close.className = 'b3d-reader-x'; close.type = 'button'; close.setAttribute('aria-label', 'Close');
      close.textContent = '×';
      close.addEventListener('click', (e) => { e.stopPropagation(); closeCard(); });
      reader.append(close, card);
    }
    function openCard(obj) {
      if (openObj === obj) return;
      if (openObj) closeCard();
      openObj = obj;
      obj.userData.el.classList.add('bk-reveal');
      obj.userData.targetZScale = 1;
      if (reduced) applyInstant(obj);
      if (mobile) { fillReader(obj); reader.hidden = false; }
    }
    function closeCard() {
      if (!openObj) return;
      const obj = openObj;
      obj.userData.el.classList.remove('bk-reveal');
      obj.userData.targetZScale = 0;
      openObj = null;
      if (reduced) applyInstant(obj);
      reader.hidden = true; reader.replaceChildren();
    }
    objs.forEach((obj) => {
      const el = obj.userData.el;
      el.addEventListener('click', (e) => { if (openObj !== obj) { e.preventDefault(); frameNode(obj); openCard(obj); } });
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeCard(); } });
      el.addEventListener('focus', () => { if (el.matches(':focus-visible')) { frameNode(obj); openCard(obj); } });
      el.addEventListener('blur', () => { if (openObj === obj) closeCard(); });
    });
    css.domElement.addEventListener('click', (e) => { if (e.target === css.domElement) closeCard(); });

    // Mobile touch (the maintainer 0668): one-finger drag PANS the focus point; two-finger PINCH ZOOMS between a
    // close legible frame and the full constellation (pinch together → zoom out reveals the whole tree;
    // spread → zoom in). A clean tap still opens a card. Pan is in world units at the current focus depth,
    // clamped to the constellation extent; zoom is clamped [close-legible, overview] so it can't get lost.
    // Handlers are NAMED so dispose() can remove them — host (.bracket-scene) persists across 2D↔3D toggles,
    // so anonymous listeners would accumulate on every re-entry (§8 B cycle-safe teardown).
    let onTouchStart = null, onTouchMove = null, onTouchEnd = null;
    if (mobile) {
      const pinchOf = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      let dragging = false, startX = 0, startY = 0, startCx = 0, startCy = 0, moved = 0, startT = 0, lastX = 0, lastY = 0;
      let pinching = false, startPinch = 0, startDist = 0;
      onTouchStart = (e) => {
        if (e.touches.length === 2) { pinching = true; dragging = false; startPinch = pinchOf(e.touches); startDist = fcam.tdist; }
        else if (e.touches.length === 1) { dragging = true; moved = 0; startT = performance.now(); startX = lastX = e.touches[0].clientX; startY = lastY = e.touches[0].clientY; startCx = fcam.tcx; startCy = fcam.tcy; }
      };
      onTouchMove = (e) => {
        if (pinching && e.touches.length === 2) {
          const ratio = startPinch / Math.max(1, pinchOf(e.touches)); // spread → <1 (zoom in); together → >1 (zoom out → reveal the constellation)
          fcam.tdist = fcam.dist = Math.max(minDist, Math.min(maxDist, startDist * ratio));
          camMoving = true; applyFcam();
          if (e.cancelable) e.preventDefault();
          return;
        }
        if (!dragging || e.touches.length !== 1) return;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        const dx = lastX - startX, dy = lastY - startY;
        moved = Math.max(moved, Math.hypot(dx, dy));
        const scale = (fcam.dist * 2 * Math.tan(VFOV / 2) * (W() / H())) / host.clientWidth; // px → world at depth
        fcam.tcx = Math.max(-extentX, Math.min(extentX, startCx - dx * scale));
        fcam.tcy = Math.max(-extentY, Math.min(extentY, startCy + dy * scale));
        camMoving = true;
        if (moved > 6 && e.cancelable) e.preventDefault();
      };
      onTouchEnd = (e) => {
        if (e.touches.length > 0) return;
        // a fast, horizontal-dominant one-finger flick TRAVERSES rounds (swipe left → toward the Final,
        // right → toward R32); a slow / short / vertical drag stays a pan. frameRound overrides its pan.
        if (dragging && !pinching) {
          const fdx = lastX - startX, fdy = lastY - startY, fdt = performance.now() - startT;
          if (Math.abs(fdx) > 55 && Math.abs(fdx) > Math.abs(fdy) * 1.6 && fdt < 400) stepRound(fdx < 0 ? 1 : -1);
        }
        dragging = false; pinching = false;
      };
      host.addEventListener('touchstart', onTouchStart, { passive: true });
      host.addEventListener('touchmove', onTouchMove, { passive: false });
      host.addEventListener('touchend', onTouchEnd, { passive: true });
    }

    // ---- Desktop free-look (the maintainer 0673): wheel-zoom (always-on over the scene), drag TILT/orbit (bounded),
    // WASD movement (click-to-engage; Esc / click-away releases; never hijacks page keys until engaged).
    // Named handlers → dispose removes them all (host + window + document persist across toggles). ----
    let onWheel = null, onMouseDown = null, onMouseMove = null, onMouseUp = null, onSceneClick = null, onDocDown = null, onWasdDown = null, onWasdUp = null, mobSlider = null;
    let engaged = false;
    const wasd = new Set();
    const engage = () => { if (!engaged) { engaged = true; host.classList.add('b3d-engaged'); } };
    const disengage = () => { if (engaged) { engaged = false; wasd.clear(); host.classList.remove('b3d-engaged'); } };
    // Wheel = free zoom, always available while the pointer is over the scene (works during tilt/pan too).
    onWheel = (e) => {
      e.preventDefault();
      fcam.tdist = fcam.dist = clamp(fcam.dist * Math.exp(e.deltaY * 0.0012), minDist, maxDist);
      camMoving = false; applyFcam(); render();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    if (!mobile) {
      // Drag = bounded tilt/orbit about the focus point (generous, not free-spin). move/up on window so a
      // drag that leaves the host keeps tracking; a no-move press stays a click (card fly-to + engage).
      let odrag = false, ox = 0, oy = 0, oyaw = 0, opitch = 0, omoved = 0;
      onMouseDown = (e) => { if (e.button !== 0) return; odrag = true; omoved = 0; ox = e.clientX; oy = e.clientY; oyaw = fcam.yaw; opitch = fcam.pitch; };
      onMouseMove = (e) => {
        if (!odrag) return;
        const dx = e.clientX - ox, dy = e.clientY - oy; omoved = Math.max(omoved, Math.hypot(dx, dy));
        if (omoved < 3) return;
        fcam.yaw = clamp(oyaw + dx * 0.0042, -yawMax(), yawMax());
        fcam.pitch = clamp(opitch - dy * 0.0040, -pitchMax(), pitchMax());
        camMoving = false; applyFcam(); render();
      };
      onMouseUp = () => { odrag = false; };
      host.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      // WASD moves the focus once ENGAGED: click the scene to engage, Esc / click-away releases. Until
      // engaged, w/a/s/d are ignored (no page-key hijack).
      onSceneClick = () => engage();
      onDocDown = (e) => { if (!host.contains(e.target)) disengage(); };
      onWasdDown = (e) => {
        if (!engaged) return;
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (k === 'w' || k === 'a' || k === 's' || k === 'd') { wasd.add(k); e.preventDefault(); }
        else if (k === 'Escape') disengage();
      };
      onWasdUp = (e) => { wasd.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); };
      host.addEventListener('click', onSceneClick);
      document.addEventListener('mousedown', onDocDown, true);
      window.addEventListener('keydown', onWasdDown);
      window.addEventListener('keyup', onWasdUp);
    }
    // Dev-only mobility slider (the maintainer 0673): tune the tilt/movement range LIVE on dev. Gated on the baked
    // __G26_DEV__ flag → PHYSICALLY ABSENT from the prod bake (build.mjs emits __G26_DEV__ only under G26_DEV).
    if (IS_DEV) {
      mobSlider = document.createElement('label');
      mobSlider.className = 'b3d-mob';
      mobSlider.innerHTML = '<span>Mobility</span><input type="range" min="0" max="150" value="100" aria-label="Camera mobility range (dev only)">';
      const inp = mobSlider.querySelector('input');
      inp.addEventListener('input', () => {
        mobility = (+inp.value) / 100;
        fcam.yaw = clamp(fcam.yaw, -yawMax(), yawMax());
        fcam.pitch = clamp(fcam.pitch, -pitchMax(), pitchMax());
        applyFcam(); render();
      });
      host.appendChild(mobSlider);
    }

    // ---- §8 D LIVE-STATE MIRROR (an internal review fix) ----
    // The clones are static snapshots; app.js hydrates the 2D ORIGINS (score/pill, bk-live/bk-today glow,
    // healed team names, winner-row + --bkw kit edge) on its 45-60s tick. Copy those live updates onto the
    // clones so the 3D showpiece isn't frozen for live matches. CHANGE-GATED per card (cheap when nothing
    // moved), FAIL-SOFT (a hiccup never breaks the scene), and it rebuilds the tubes only when a tie's
    // state actually flips. A light 2s interval covers BOTH the animated loop and the reduced-motion static
    // path (no rAF there); it renders on any change so reduced-motion repaints too.
    function mirrorState() {
      try {
        let changed = false, tubesDirty = false;
        objs.forEach((obj) => {
          const origin = obj.userData.origin, el = obj.userData.el;
          const bbst = origin.querySelector('.bbst');
          const sig = origin.className + '|' + (bbst ? bbst.innerHTML : '') + '|'
            + Array.prototype.map.call(origin.querySelectorAll('.bbnm'), (n) => n.textContent).join('~') + '|'
            + Array.prototype.map.call(origin.querySelectorAll('.bbrow'), (r) => (r.getAttribute('class') || '') + (r.getAttribute('style') || '')).join('~');
          if (sig === obj.userData._sig) return;
          obj.userData._sig = sig; changed = true;
          const cBbst = el.querySelector('.bbst');
          if (bbst && cBbst) cBbst.innerHTML = bbst.innerHTML;                    // score + pill
          const oN = origin.querySelectorAll('.bbnm'), cN = el.querySelectorAll('.bbnm');
          oN.forEach((n, i) => { if (cN[i]) cN[i].textContent = n.textContent; }); // healed team names
          el.classList.toggle('bk-live', origin.classList.contains('bk-live'));    // live glow
          el.classList.toggle('bk-today', origin.classList.contains('bk-today'));  // today
          const oR = origin.querySelectorAll('.bbrow'), cR = el.querySelectorAll('.bbrow');
          oR.forEach((r, i) => { if (cR[i]) { cR[i].setAttribute('class', r.getAttribute('class') || ''); const s = r.getAttribute('style'); if (s) cR[i].setAttribute('style', s); else cR[i].removeAttribute('style'); } }); // winner row + --bkw kit edge
          if (stateOf(origin) !== obj.userData._tubeState) tubesDirty = true;       // tie state flipped → recolour its arrow
        });
        if (tubesDirty) buildTubes();
        if (changed) render();
      } catch (e) { /* fail-soft: never break the scene on a mirror hiccup */ }
    }
    const mirrorTimer = setInterval(mirrorState, 2000);

    // ---- throttled render loop (24fps) + light-race. Phase 4 adds orbit + full reduced-motion/low-power. ----
    const FRAME = 1000 / 24;
    let last = performance.now(), acc = 0, running = true, disposed = false;
    function frame(now) {
      if (disposed || !running) return;
      requestAnimationFrame(frame);
      if (document.hidden) return; // pause the loop on a backgrounded tab (battery/heat)
      const delta = now - last; last = now; acc += delta;
      if (acc < FRAME) return;             // throttle to ~24fps
      acc = acc % FRAME;
      const dt = Math.min(delta, 80) / 1000;
      if (camMoving) { // ease the camera toward its focus target (replaces the old whole-tree auto-orbit)
        const k = Math.min(1, dt * 3.4);
        fcam.cx += (fcam.tcx - fcam.cx) * k; fcam.cy += (fcam.tcy - fcam.cy) * k;
        fcam.cz += (fcam.tcz - fcam.cz) * k; fcam.dist += (fcam.tdist - fcam.dist) * k;
        if (Math.abs(fcam.tdist - fcam.dist) < 0.6 && Math.hypot(fcam.tcx - fcam.cx, fcam.tcy - fcam.cy, fcam.tcz - fcam.cz) < 0.6) {
          fcam.cx = fcam.tcx; fcam.cy = fcam.tcy; fcam.cz = fcam.tcz; fcam.dist = fcam.tdist; camMoving = false;
        }
        applyFcam();
      }
      if (engaged && wasd.size) { // WASD moves the focus point (pan speed scales with zoom); clamped to extent
        const spd = clamp(fcam.dist * 0.85, 60, 900) * dt;
        let mx = 0, my = 0;
        if (wasd.has('a')) mx -= 1; if (wasd.has('d')) mx += 1;
        if (wasd.has('w')) my += 1; if (wasd.has('s')) my -= 1;
        if (mx || my) {
          fcam.cx = fcam.tcx = clamp(fcam.cx + mx * spd, -extentX, extentX);
          fcam.cy = fcam.tcy = clamp(fcam.cy + my * spd, -extentY, extentY);
          camMoving = false; applyFcam();
        }
      }
      Object.keys(tubeMats).forEach((st) => { tubeMats[st].map.offset.x -= flowInfo[st].speed * dt; });
      // ease the open card forward to a focus plane (translateZ toward camera + scale up + face front)
      objs.forEach((obj) => {
        const u = obj.userData, tzs = u.targetZScale || 0;
        if (u.zsc === tzs) return;
        u.zsc += (tzs - u.zsc) * Math.min(1, dt * 8);
        if (Math.abs(tzs - u.zsc) < 0.002) u.zsc = tzs;
        obj.position.z = u.baseZ + u.zsc * 200;
        obj.position.y = u.baseY - u.zsc * 6;
        obj.scale.setScalar(u.baseScale * (1 + u.zsc * 0.6));
        obj.rotation.y = u.ry * (1 - u.zsc);
      });
      render();
    }
    render(); // warm-up paint (cards land even if the tab starts hidden)
    if (!reduced) requestAnimationFrame(frame); // reduced-motion → static tubes, no loop (Phase 4 hardens)

    const onResize = () => { wgl.setSize(W(), H()); css.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); reframe(); render(); };
    window.addEventListener('resize', onResize);
    const onVis = () => { if (!document.hidden && running) last = performance.now(); }; // avoid a delta spike on re-show
    document.addEventListener('visibilitychange', onVis);

    return {
      THREE, three, camera, objs, render,
      dispose() {
        running = false; disposed = true;
        clearInterval(mirrorTimer);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVis);
        try { stages.removeEventListener('click', onChip, true); host.removeEventListener('keydown', onKey); ovBtn.remove(); } catch (e) {}
        // host persists across 2D↔3D toggles → remove its touch listeners too (else they accumulate per cycle)
        try { if (onTouchStart) host.removeEventListener('touchstart', onTouchStart); if (onTouchMove) host.removeEventListener('touchmove', onTouchMove); if (onTouchEnd) host.removeEventListener('touchend', onTouchEnd); } catch (e) {}
        // desktop free-look listeners (the maintainer 0673) — host + window + document persist, so remove them all
        try {
          if (onWheel) host.removeEventListener('wheel', onWheel);
          if (onMouseDown) host.removeEventListener('mousedown', onMouseDown);
          if (onMouseMove) window.removeEventListener('mousemove', onMouseMove);
          if (onMouseUp) window.removeEventListener('mouseup', onMouseUp);
          if (onSceneClick) host.removeEventListener('click', onSceneClick);
          if (onDocDown) document.removeEventListener('mousedown', onDocDown, true);
          if (onWasdDown) window.removeEventListener('keydown', onWasdDown);
          if (onWasdUp) window.removeEventListener('keyup', onWasdUp);
          if (mobSlider) mobSlider.remove();
        } catch (e) {}
        // restore the chips' highlight to the 2D telescope's current stage (bracket-zoom owns them in 2D)
        try { const cur = w2d.getAttribute('data-stage'); chips.forEach((c) => c.classList.toggle('on', c.getAttribute('data-bk-stage') === cur)); } catch (e) {}
        try { three.traverse((o) => { if (o.geometry) o.geometry.dispose && o.geometry.dispose(); if (o.material) { const m = o.material; (Array.isArray(m) ? m : [m]).forEach((x) => { if (x) { if (x.map) x.map.dispose && x.map.dispose(); x.dispose && x.dispose(); } }); } }); } catch (e) {}
        try { wgl.dispose(); wgl.forceContextLoss(); } catch (e) {}
        try { glwrap.remove(); csswrap.remove(); } catch (e) {}
      },
    };
  }

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('.bk-view');
    if (!b) return;
    b.dataset.view === '3d' ? to3D() : to2D();
  });

  // Remembered choice — but NEVER auto-enter 3D under reduced-motion (respect the pref for auto-entry;
  // manual opt-in stays available, where Phase 4 renders the static, no-loop form).
  let remembered = null;
  try { remembered = localStorage.getItem(KEY); } catch (e) {}
  if (remembered === '3d' && !reduced) to3D();
})();
