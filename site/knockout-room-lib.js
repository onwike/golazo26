/* site/knockout-room-lib.js — ported verbatim from the pixel-verified museum-preview lib
   (knockout-room/lib/artifacts.js). THREE-free reusable builders: buildCauldron / buildTrophy.
   Brought home into golazo26 as the 3D bracket experience's cauldron + trophy rigs.
   DO NOT edit the rig logic — it carries measured GLB anchors + earlier fixes. */
/* Golazo 26 knockout-room — the REAL dev artifacts as reusable builders.
   Faithful port of the dev bracket-map.js cauldron + trophy rigs, refactored to add meshes into a
   caller-supplied THREE scene/group (the room draws them; no private overlay canvas). Every mockup
   imports these so all six carry the genuine artifacts identically.

   buildCauldron(THREE, GLTFLoader, {parent, glbBase, scale, onReady, onHoodReady}) ->
       { group, stoke(), update(dt, now),            // stoke() = a launch: stokes the fire + burps the hood
         potMouth(), hoodIntake(), hoodDuctExit(),   // world-space anchors, measured from the GLBs (an earlier fix)
         hoodReceive(durationSec), hoodReady() }     // catch->gather->send sync for a host's pulses
   buildTrophy(THREE, GLTFLoader, {parent, glbBase, scale, onReady}) ->
       { group, detonate(shell?), update(dt, now) }

   2026-07-16: buildCauldron's fire (flame licks / log material / fire-light flicker / ember sparks)
   and earth texture upgraded from the pixel-verified PoC at knockout-room/fire-poc/index.html
   (REPORT.md has the technique breakdown + verification evidence). Public API and every existing
   caller contract preserved exactly — see the per-section notes below for what changed and why. */

export const SHELLS = [
  [0.91, 0.78, 0.48], [1.0, 0.42, 0.36], [0.42, 0.72, 1.0], [0.69, 0.5, 1.0],
  [0.18, 0.88, 0.44], [1.0, 0.5, 0.69], [0.24, 0.9, 0.86], [1.0, 0.62, 0.26],
  [0.78, 1.0, 0.38], [1.0, 0.36, 0.86], [0.8, 0.9, 1.0],
];

/* ============================================================================================
   Fire helpers — ported from the pixel-verified PoC (fire-poc/index.html). Kept as small, generic,
   THREE-free functions (canvas builders return a <canvas>, callers wrap in THREE.CanvasTexture)
   or pure-JS math (noise/pink-noise), so nothing here duplicates state across builder calls.
   ============================================================================================ */

/* shared GLSL noise for the flame shader (verbatim from the PoC — already pixel-verified under
   ACES, see fire-poc/REPORT.md "Colour ramp survives ACES"). */
const NOISE_GLSL = `
float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash21(i), b = hash21(i + vec2(1.0,0.0));
  float c = hash21(i + vec2(0.0,1.0)), d = hash21(i + vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, amp = 0.5;
  for(int i=0;i<5;i++){ v += amp*vnoise(p); p *= 2.03; amp *= 0.52; }
  return v;
}
vec2 curlish(vec2 p, float t){
  float n1 = vnoise(p + vec2(3.1, t));
  float n2 = vnoise(p + vec2(-7.7, t*0.87));
  return vec2(n1 - 0.5, n2 - 0.5);
}`;

/* an earlier fix: this billboard trick transforms only the quad's pivot through modelViewMatrix, then adds
   the uv-derived offset in raw view-space units — it deliberately bypasses the object's own scale
   matrix (needed so a custom fragment shader can drive the shape), so the CALLER must multiply
   uScale by the ancestor chain's world scale explicitly (done in update(), via worldScaleOf()) or
   the flame silently renders undersized at any host scale other than the one it was eyeballed at. */
const FLAME_VERT = `precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uScale;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xy += vec2(position.x * uScale.x, (position.y + 0.5) * uScale.y);
  gl_Position = projectionMatrix * mvPosition;
}`;

const FLAME_FRAG = `precision highp float;
varying vec2 vUv;
uniform float uTime, uLife, uStoke, uSeed;
${NOISE_GLSL}
vec3 rampColor(float t){
  vec3 black  = vec3(0.03, 0.01, 0.01);
  vec3 red    = vec3(0.55, 0.07, 0.02);
  vec3 orange = vec3(1.00, 0.40, 0.06);
  vec3 yellow = vec3(1.00, 0.78, 0.24);
  vec3 white  = vec3(1.00, 0.95, 0.80);
  vec3 c = mix(black, red, smoothstep(0.0, 0.22, t));
  c = mix(c, orange, smoothstep(0.18, 0.50, t));
  c = mix(c, yellow, smoothstep(0.45, 0.75, t));
  c = mix(c, white,  smoothstep(0.72, 0.98, t));
  return c;
}
void main(){
  float rise = uTime * (1.5 + uStoke * 1.4);
  vec2 flowP = vec2(vUv.x * 2.6 + uSeed * 12.0, vUv.y * 3.4 - rise);
  vec2 curl = curlish(flowP * 0.8, uTime * 0.6 + uSeed) * (0.5 + uStoke * 0.35);
  float n = fbm(flowP + curl * 1.6);
  /* an earlier fix: raw fbm sits ~0.3-0.7, too narrow to erode the quad's CENTER (only the silhouette edge
     ever crossed a tight threshold, reading as a near-solid card). Remapped wide + gated through a
     wide smoothstep so the noise visibly dissolves the whole body, not just its edge. */
  float nSharp = n * 2.1 - 0.62;
  float taper = mix(1.0, 0.16, pow(vUv.y, 1.05));
  float edgeDist = abs(vUv.x - 0.5) / max(0.035, 0.5 * taper);
  float body = nSharp - edgeDist * 1.5 - vUv.y * 0.25;
  float erosion = smoothstep(-0.28, 0.30, body);
  float baseFade = smoothstep(0.0, 0.14, vUv.y);
  float tipFade = 1.0 - smoothstep(0.7, 1.0, vUv.y - n * 0.22);
  float alpha = erosion * baseFade * tipFade * uLife;
  if (alpha < 0.02) discard;
  float heat = clamp(nSharp * 0.9 - vUv.y * 0.5 + 0.35, 0.0, 1.0);
  gl_FragColor = vec4(rampColor(heat), alpha);
}`;

const FLAME_N = 5, FLAME_SIZE_MULT = 1.15;

/* ---------- pink (1/f) noise — Voss-McCartney, NOT Math.random() per frame (verbatim from PoC) --- */
class PinkNoise {
  constructor(n = 6) {
    this.n = n; this.rows = new Array(n).fill(0); this.index = 0; this.max = (1 << n);
    this.runningSum = 0;
    for (let i = 0; i < n; i++) { this.rows[i] = Math.random() * 2 - 1; this.runningSum += this.rows[i]; }
  }
  next() {
    const lastIndex = this.index;
    this.index = (this.index + 1) % this.max;
    let diff = this.index ^ lastIndex;
    for (let i = 0; i < this.n && diff; i++) {
      if (diff & (1 << i)) { this.runningSum -= this.rows[i]; this.rows[i] = Math.random() * 2 - 1; this.runningSum += this.rows[i]; }
    }
    return this.runningSum / this.n; // ~ -1..1
  }
}
function makeSteppedPink(stepSec, octaves) {
  const p = new PinkNoise(octaves);
  let acc = 0, a = p.next(), b = p.next();
  return {
    tick(dt) {
      acc += dt;
      while (acc >= stepSec) { acc -= stepSec; a = b; b = p.next(); }
      return a + (b - a) * (acc / stepSec);
    }
  };
}

/* ---------- cheap 2D value noise for CPU-side ember curl drift ----------
   Ember sparks stay on THREE.Points + PointsMaterial (built-in size attenuation) rather than a
   custom GPU point-size shader: a hand-rolled gl_PointSize formula needs the renderer's actual
   pixel height, which this shared lib has no access to (no renderer/opts.renderer passed in) —
   exactly the missing ingredient that caused an earlier fix in the PoC. THREE's built-in attenuation already
   gets that right internally, so curl motion is computed here in JS instead and fed to the same
   Points buffer the fire particles already use. */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function vnoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const ux = xf * xf * (3 - 2 * xf), uy = yf * yf * (3 - 2 * yf);
  const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}
function curlish2(seed, t) {
  const n1 = vnoise2(seed * 0.37 + 3.1, t);
  const n2 = vnoise2(seed * 0.51 - 7.7, t * 0.87 + 4.2);
  return [n1 - 0.5, n2 - 0.5];
}

/* effective world scale of a node — walks the ancestor chain multiplying scale.x (every scale in
   this rig is applied via setScalar, so uniform x/y/z). Used to compensate the flame billboard
   (an earlier fix) at whatever host scale the caller applied to cauHost (verified 3.6-6.3 across builds). */
function worldScaleOf(obj) {
  let s = 1, n = obj;
  while (n) { if (n.scale) s *= n.scale.x; n = n.parent; }
  return s;
}

/* ---------- log bark textures (ported from the PoC's composition fix #2) ----------
   The original log meshes were flat-color MeshStandardMaterial on a low-poly 8-sided cylinder —
   fine far away, but a single uniform base color with no texture variance reads as flat plastic
   once brightened by the nearby fireLight. Charred-bark diffuse + a separate emissive-only
   ember-tip texture (immune to fireLight's own intensity, since emissive is additive regardless of
   scene lights) fixes that identically to the verified PoC. */
function makeBarkColorCanvas(baseHex) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = baseHex; g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 64, w = 1 + Math.random() * 2.5;
    g.fillStyle = Math.random() < 0.55 ? `rgba(0,0,0,${0.18 + Math.random() * 0.28})` : `rgba(120,70,35,${0.10 + Math.random() * 0.16})`;
    g.fillRect(x, 0, w, 128);
  }
  for (let i = 0; i < 10; i++) {
    g.fillStyle = `rgba(0,0,0,${0.22 + Math.random() * 0.3})`;
    g.beginPath(); g.ellipse(Math.random() * 64, Math.random() * 128, 5 + Math.random() * 9, 3 + Math.random() * 7, 0, 0, Math.PI * 2); g.fill();
  }
  return c;
}
function makeEmberGlowCanvas() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  const grad = g.createLinearGradient(0, 0, 0, 46);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.55, 'rgba(255,180,90,0.55)'); grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 46);
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) { const x0 = 12 + i * 16; g.beginPath(); g.moveTo(x0, 2); g.lineTo(x0 + 5, 20); g.lineTo(x0 - 3, 34); g.stroke(); }
  return c;
}

/* ---------- earth textures — richer procedural globe, still 100% canvas (zero fetches) ----------
   The previous earth texture was flat color blobs (solid-navy ocean, solid-green ellipse
   continents) — reads as a beach ball, not a world. This adds: a latitude-shaded ocean gradient,
   two-tone landmasses (lowland + highland patches per continent, three hue families so it doesn't
   read as one repeated shape), ocean depth/current mottling, textured polar caps (gradient + jagged
   edge instead of a flat bar), and a separate low-alpha cloud layer sprite-sphere so it turns at a
   slightly different rate than the surface (the "clouds" mesh below, added as a child of earth). */
function makeEarthCanvas() {
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const ocean = g.createLinearGradient(0, 0, 0, H);
  ocean.addColorStop(0.00, '#081c33'); ocean.addColorStop(0.20, '#0d2b4e');
  ocean.addColorStop(0.50, '#134166'); ocean.addColorStop(0.80, '#0d2b4e'); ocean.addColorStop(1.00, '#081c33');
  g.fillStyle = ocean; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W, y = 20 + Math.random() * (H - 40);
    g.fillStyle = Math.random() < 0.5 ? `rgba(40,90,140,${0.10 + Math.random() * 0.12})` : `rgba(8,20,40,${0.10 + Math.random() * 0.12})`;
    g.beginPath(); g.ellipse(x, y, 18 + Math.random() * 30, 8 + Math.random() * 14, Math.random() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  function landmass(cx, cy, s, hue) {
    const lowland = hue === 'arid' ? '#a98a4a' : hue === 'tropical' ? '#3d7a3a' : '#2ea45f';
    const highland = hue === 'arid' ? '#8a6a34' : hue === 'tropical' ? '#2a5c2a' : '#1f7a44';
    const blobs = 4 + Math.floor(Math.random() * 3);
    g.fillStyle = lowland;
    for (let i = 0; i < blobs; i++) {
      const bx = cx + (Math.random() - 0.5) * s * 1.4, by = cy + (Math.random() - 0.5) * s * 0.8;
      g.beginPath(); g.ellipse(bx, by, s * (0.3 + Math.random() * 0.25), s * (0.18 + Math.random() * 0.16), Math.random() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = highland;
    for (let i = 0; i < Math.floor(blobs / 2) + 1; i++) {
      const bx = cx + (Math.random() - 0.5) * s * 0.9, by = cy + (Math.random() - 0.5) * s * 0.5;
      g.beginPath(); g.ellipse(bx, by, s * 0.14, s * 0.09, Math.random() * Math.PI, 0, Math.PI * 2); g.fill();
    }
  }
  [[70, 96, 46, 'temperate'], [150, 70, 34, 'arid'], [230, 110, 50, 'tropical'], [330, 80, 40, 'temperate'],
   [290, 150, 30, 'arid'], [430, 90, 42, 'temperate'], [400, 160, 26, 'tropical'], [90, 160, 28, 'tropical']]
    .forEach(([x, y, s, hue]) => landmass(x, y, s, hue));
  function polarCap(y0, dir) {
    const grad = g.createLinearGradient(0, y0, 0, y0 + dir * 22);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, dir > 0 ? y0 : y0 + dir * 22, W, 22);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let x = 0; x < W; x += 10) {
      const jag = 4 + Math.random() * 10;
      g.fillRect(x, dir > 0 ? y0 - jag + 14 : y0 + jag - 14, 9, jag);
    }
  }
  polarCap(0, 1); polarCap(H - 14, -1);
  return c;
}
function makeCloudCanvas() {
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const y = 30 + Math.random() * (H - 60), x = Math.random() * W;
    const rw = 26 + Math.random() * 46, rh = 8 + Math.random() * 14;
    const a = 0.10 + Math.random() * 0.28;
    const grad = g.createRadialGradient(x, y, 0, x, y, Math.max(rw, rh));
    grad.addColorStop(0, `rgba(255,255,255,${a})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(x, y, rw, rh, Math.random() * Math.PI, 0, Math.PI * 2); g.fill();
    if (x < rw) { g.beginPath(); g.ellipse(x + W, y, rw, rh, 0, 0, Math.PI * 2); g.fill(); }
    if (x > W - rw) { g.beginPath(); g.ellipse(x - W, y, rw, rh, 0, 0, Math.PI * 2); g.fill(); }
  }
  return c;
}

export function buildCauldron(THREE, GLTFLoader, opts) {
  opts = opts || {};
  const glbBase = opts.glbBase || './glb/';
  const group = new THREE.Group();
  if (opts.scale) group.scale.setScalar(opts.scale);
  (opts.parent || {}).add && opts.parent.add(group);
  /* earth/hood seating heights — re-measured once the real vessel GLB loads (fix: r1d report,
     2026-07-15: earth previously sat at a hardcoded y regardless of the loaded model's actual
     proportions, reading as vertically detached from the bowl; now it tracks the same measured
     rim height the FIFA band uses, and the hood is pinned a fixed, believable gap above it). */
  let earthBaseY = 0.62, hoodBaseY = 1.85;
  /* poolY = the measured molten surface. The rig previously scattered hardcoded Y constants
     (molten 0.32, bubbles 0.2, burp 0.5) that silently assumed one particular GLB scale, so moving
     any one part broke its siblings. Everything in the boil now references this single anchor. */
  let poolY = 0.32;
  /* fireBaseY = the measured base of the firepit assembly (flames/embers/ember-bed/smoke/
     fireLight), captured from the same vessel-load measurement as mouthY/poolY above (an earlier fix
     discipline: no literal Y for new fire elements). The fallback -3.3 matches what the loader's
     own o.position formula (-bb.min.y - 3.3) always resolves the vessel's base to, pre-load. */
  let fireBaseY = -3.3;

  /* the Rodin cauldron vessel */
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1.56, 1.62, 0.52, 48, 1, true),
    null /* set below */);
  new GLTFLoader().load(glbBase + 'wc-cauldron.glb', (g) => {
    const o = g.scene, bb0 = new THREE.Box3().setFromObject(o), sz = bb0.getSize(new THREE.Vector3());
    o.scale.setScalar(4.1 / Math.max(0.001, sz.x));
    const bb = new THREE.Box3().setFromObject(o), c = bb.getCenter(new THREE.Vector3());
    o.position.set(-c.x, -bb.min.y - 3.3, -c.z);
    // measure the vessel in LOCAL space (before parenting) so the FIFA band is sized in group-local
    // units — measuring after group.add double-applies any host scale (fix: KA2 report, 2026-07-14)
    const vb = new THREE.Box3().setFromObject(o), vs = vb.getSize(new THREE.Vector3());
    band.scale.setScalar((vs.x / 2 * 1.13) / 1.56);
    band.position.y = vb.min.y + vs.y * 0.60;
    /* Seat the earth in the vessel's MOUTH — not at the band's height.
       Previous fix set earthBaseY = band.position.y, but the FIFA band belongs on the vessel's
       BELLY (60% of height); pinning the earth there buried it inside the solid bronze body
       (measured: mouth at vb.min.y+vs.y, earth 1.26 units below it), and the hood then sat a
       mere 0.29 above a 3.15-tall vessel, capping the opening. Net effect: the boil was
       structurally invisible, which four independent turn-2 builds each reported and correctly
       declined to patch from inside a single mockup.
       the maintainer's requirement is explicit — "I want a perspective that will allow me to see what is
       boiling in the pot" — and it cannot be met while the world sits inside the pot's belly under
       a lid. So: earth rides IN the opening, and the hood is a suspended canopy with a real gap
       above the rim, which is also what lets the burp visibly travel up into it. */
    const mouthY = vb.min.y + vs.y;
    earthBaseY = mouthY - vs.y * 0.06;   // riding in the opening, just below the rim line
    hoodBaseY = mouthY + vs.y * 0.38;    // clear canopy above the mouth: sightline + burp travel
    /* The molten pool was ALSO hardcoded (y=0.32, fixed r=1.55) and never tracked the model, so it
       floated above the rim like a saucer once the earth moved. Third instance of the same bug in
       this rig — a constant where a measurement belongs. Seat it just inside the measured mouth and
       size it to the vessel, so the earth sits IN the boil rather than on a floating disc. */
    poolY = mouthY - vs.y * 0.11;
    molten.position.y = poolY;
    molten.scale.setScalar((vs.x * 0.30) / 1.55);
    earth.position.y = earthBaseY;
    atmo.position.copy(earth.position);
    hood.position.y = hoodBaseY;
    /* fireBaseY: same discipline applied to the firepit. vb.min.y is where the loaded/normalized
       vessel's own base lands — captured here (not re-hardcoded) so flames/fireLight/emberBed
       track the real measurement rather than an assumption. */
    fireBaseY = vb.min.y;
    flames.forEach((F) => { F.mesh.position.y = fireBaseY + 0.55; });
    fireLight.position.y = fireBaseY + 0.8; fireLightBase.copy(fireLight.position);
    emberBed.position.y = fireBaseY;
    group.add(o);
    vesselLoaded = true;   /* the hood anchors depend on hoodBaseY (set just above), so
                              onHoodReady only fires once BOTH GLBs are measured — see fireHoodReady() */
    fireHoodReady();
    if (opts.onReady) opts.onReady('cauldron');
  }, undefined, () => { if (opts.onReady) opts.onReady('cauldron-fail'); });

  /* HOOD — 2026-07-16: no longer decorative. The hood is the machine's collector: it CATCHES the
     pot's spurt in its intake mouth, GATHERS it (interior molten glow building through the funnel,
     brightest at the throat) and SENDS it out of its side duct — which is where the pipes actually
     connect (the maintainer: "the hood is actually what is connected to all the pipes"). Everything below
     is measured from the loaded GLB (an earlier fix — the fallbacks only cover the async-load window; a host
     wanting exact anchors waits for opts.onHoodReady and calls the exposed anchor functions, which
     recompute in world space on every call because hosts scale/move the group). */
  const hood = new THREE.Group();
  let hoodLoaded = false, vesselLoaded = false;
  /* hood-group-LOCAL anchors, re-measured from wc-hood.glb geometry on load (fallbacks until then) */
  const intakeLocal = new THREE.Vector3(0, 0.05, 0);      // funnel intake mouth (bottom aperture)
  const ductExitLocal = new THREE.Vector3(1.9, 1.05, 0);  // side duct's exit opening
  let funnelR = 1.3;                                       // interior radius at the mouth (with margin, an earlier fix)
  function fireHoodReady(){ if (hoodLoaded && vesselLoaded && opts.onHoodReady) opts.onHoodReady(); }
  new GLTFLoader().load(glbBase + 'wc-hood.glb', (hg) => {
    const ho = hg.scene, hbb0 = new THREE.Box3().setFromObject(ho), hsz = hbb0.getSize(new THREE.Vector3());
    ho.scale.setScalar(4.6 / Math.max(0.001, hsz.x));
    const hbb = new THREE.Box3().setFromObject(ho), hc = hbb.getCenter(new THREE.Vector3());
    ho.position.set(-hc.x, -hbb.min.y, -hc.z);
    /* an earlier fix — measure intake + duct exit from the LOADED geometry, in hood-group-local space
       (ho is not parented yet, so updateMatrixWorld(true) on it as a root bakes its own
       scale+position into matrixWorld — i.e. exactly the hood-local frame; measuring after
       hood.add() would still be pre-host-scale here, but this order keeps it unambiguous, an earlier fix). */
    ho.updateMatrixWorld(true);
    const pts = [];
    const sv = new THREE.Vector3();
    ho.traverse((n) => {
      if (!n.isMesh || !n.geometry || !n.geometry.attributes.position) return;
      const pa = n.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pa.count / 6000));
      for (let i = 0; i < pa.count; i += step) {
        sv.fromBufferAttribute(pa, i).applyMatrix4(n.matrixWorld);
        pts.push(sv.x, sv.y, sv.z);
      }
    });
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      if (pts[i] < mnx) mnx = pts[i]; if (pts[i] > mxx) mxx = pts[i];
      if (pts[i+1] < mny) mny = pts[i+1]; if (pts[i+1] > mxy) mxy = pts[i+1];
      if (pts[i+2] < mnz) mnz = pts[i+2]; if (pts[i+2] > mxz) mxz = pts[i+2];
    }
    const hgt = Math.max(0.001, mxy - mny);
    /* duct direction = the horizontal direction with the greatest reach from the origin. The GLB
       was just re-centered on its FULL bbox (funnel + duct), so the duct side necessarily reaches
       further from x=z=0 than the funnel's own radius does on any other side. */
    const reach = [[mxx, 1, 0], [-mnx, -1, 0], [mxz, 0, 1], [-mnz, 0, -1]].sort((a, b) => b[0] - a[0]);
    const [dReach, ddx, ddz] = reach[0];
    /* duct exit = centroid of the sampled vertices in the outermost 6% of that reach (the rim of
       the side opening), so the anchor sits at the opening's real center, not a bbox corner */
    let ex = 0, ey = 0, ez = 0, en = 0;
    const cut = dReach * 0.94;
    for (let i = 0; i < pts.length; i += 3) {
      if (pts[i] * ddx + pts[i+2] * ddz >= cut) { ex += pts[i]; ey += pts[i+1]; ez += pts[i+2]; en++; }
    }
    if (en > 0) ductExitLocal.set(ex / en, ey / en, ez / en);
    /* intake mouth = centroid of the lowest 8% band (the funnel's bottom aperture rim) */
    let ix = 0, iz = 0, inn = 0;
    const yCut = mny + hgt * 0.08;
    for (let i = 0; i < pts.length; i += 3) {
      if (pts[i+1] <= yCut) { ix += pts[i]; iz += pts[i+2]; inn++; }
    }
    if (inn > 0) intakeLocal.set(ix / inn, mny + hgt * 0.03, iz / inn);
    /* interior radius: the half-extent PERPENDICULAR to the duct (unpolluted by the duct's own
       reach), pulled in — so the gather-glow cone below stays inside the shell (an earlier fix) */
    funnelR = Math.max(0.2, (ddz !== 0 ? Math.min(mxx, -mnx) : Math.min(mxz, -mnz)) * 0.62);
    const throatY = THREE.MathUtils.clamp(ductExitLocal.y, hgt * 0.35, hgt * 0.9);
    /* re-seat the gather rig (built below with fallback sizes) onto the measured funnel */
    gatherCone.geometry.dispose();
    gatherCone.geometry = new THREE.CylinderGeometry(funnelR * 0.30, funnelR * 0.95, Math.max(0.2, throatY - intakeLocal.y), 16, 1, true);
    gatherCone.position.set(0, (intakeLocal.y + throatY) / 2, 0);
    throatGlow.position.set(0, throatY, 0);
    throatGlow.scale.setScalar(funnelR * 0.42);
    ductFlash.position.copy(ductExitLocal);
    ductFlash.scale.setScalar(Math.max(0.2, funnelR * 0.34));
    hoodGlow.position.set(0, throatY * 0.75, 0);
    hood.add(ho);
    hoodLoaded = true;
    fireHoodReady();
  });
  /* hoodGlow: finite distance 8 + default decay 2 — real falloff (an earlier fix) */
  const hoodGlow = new THREE.PointLight(0xe8c67a, 0, 8); hoodGlow.position.set(0, 0.4, 0.6); hood.add(hoodGlow);
  /* gather-glow rig — the hood's interior lighting up while it holds a charge (hoodReceive()).
     Additive MeshBasicMaterial throughout: no emissiveIntensity anywhere near the ACES ~1.7 clip
     (an earlier fix) and no transmission (a host's transmissive-material budget is untouched). Sizes are
     fallbacks; the loader above re-derives them from the measured funnel (an earlier fix). */
  const gatherMat = new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const gatherCone = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.2, 1.0, 16, 1, true), gatherMat);
  gatherCone.position.set(0, 0.55, 0); hood.add(gatherCone);
  const throatMat = new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const throatGlow = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), throatMat);
  throatGlow.scale.setScalar(0.4); throatGlow.position.set(0, 1.0, 0); hood.add(throatGlow);
  const ductFlashMat = new THREE.MeshBasicMaterial({ color: 0xffc75e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const ductFlash = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), ductFlashMat);
  ductFlash.scale.setScalar(0.3); ductFlash.position.copy(ductExitLocal); hood.add(ductFlash);
  /* hoodReceive(durationSec) — a host synchronises the hood's catch->gather->send envelope with
     its own pulse timing: call it the moment the mass enters the intake, passing how long the
     mass will stay inside; the interior glow builds over that window and the duct flashes its
     send exactly as it ends. Idle burps (below) drive a smaller version of the same envelope. */
  let hoodT = -1, hoodDur = 0.5, ductT = -1, gatherLevel = 0, gatherPeak = 1;
  function hoodReceive(durationSec, peak) {
    hoodT = 0; hoodDur = Math.max(0.12, durationSec || 0.5); gatherPeak = peak || 1;
  }
  hood.position.set(0, hoodBaseY, 0); group.add(hood);

  /* the burp glob */
  const burpM = new THREE.MeshStandardMaterial({ color: 0x7a5a1a, emissive: 0xffc75e, emissiveIntensity: 1.8, roughness: 0.3 });
  const burp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), burpM); burp.visible = false; group.add(burp);
  let burpT = -1;

  /* fire light — real falloff (distance 30, decay 2 explicit; an earlier fix), flicker driven by pink noise
     below instead of naive sin+random (see update()). Position anchored off fireBaseY (an earlier fix). */
  const fireLight = new THREE.PointLight(0xff9a4d, 1.9, 30, 2); fireLight.position.set(0, fireBaseY + 0.8, 2.2); group.add(fireLight);
  const fireLightBase = fireLight.position.clone();
  const pinkLight = makeSteppedPink(0.05, 6);
  const pinkJitterX = makeSteppedPink(0.07, 5);
  const pinkJitterZ = makeSteppedPink(0.09, 5);
  const pinkBed = makeSteppedPink(0.06, 5);

  /* pulsing coal bed under the logs — new, anchored off fireBaseY */
  const emberBedMat = new THREE.MeshBasicMaterial({ color: 0xff8a2e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const emberBed = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20), emberBedMat);
  emberBed.rotation.x = -Math.PI / 2; emberBed.position.set(0, fireBaseY, 0.5); group.add(emberBed);

  /* molten surface + bubbles */
  const moltenM = new THREE.MeshStandardMaterial({ color: 0x8a6420, emissive: 0xf0b64a, emissiveIntensity: 0.75, roughness: 0.5 });
  const molten = new THREE.Mesh(new THREE.CircleGeometry(1.55, 36), moltenM);
  molten.rotation.x = -Math.PI / 2; molten.position.y = 0.32; group.add(molten);
  const bubbles = [];
  for (let i = 0; i < 9; i++) {
    const bub = new THREE.Mesh(new THREE.SphereGeometry(0.07 + Math.random() * 0.07, 8, 6), moltenM);
    bub.visible = false; group.add(bub);
    bubbles.push({ m: bub, t: Math.random() * 2.4, a: Math.random() * Math.PI * 2, r: 0.35 + Math.random() * 0.95 });
  }

  /* the earth turning in the brew — richer procedural texture (albedo + separate cloud layer) */
  const earthTex = new THREE.CanvasTexture(makeEarthCanvas());
  const earth = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 24),
    new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.75, metalness: 0.05, emissive: 0x11304f, emissiveIntensity: 0.5 }));
  earth.rotation.z = 0.41; earth.scale.setScalar(1.35); earth.position.set(0, earthBaseY, 0); group.add(earth);
  const cloudTex = new THREE.CanvasTexture(makeCloudCanvas());
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(0.635, 28, 20),
    new THREE.MeshStandardMaterial({ map: cloudTex, transparent: true, depthWrite: false, roughness: 1, metalness: 0 }));
  earth.add(clouds); // child of earth: inherits position/bob for free, own extra spin in update()
  const gc = document.createElement('canvas'); gc.width = gc.height = 64;
  const gg = gc.getContext('2d'), gr = gg.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, 'rgba(120,190,255,.5)'); gr.addColorStop(1, 'rgba(120,190,255,0)');
  gg.fillStyle = gr; gg.fillRect(0, 0, 64, 64);
  const atmo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false }));
  atmo.scale.set(2.1, 2.1, 1); atmo.position.copy(earth.position); group.add(atmo);

  /* FIFA on glass — semi-transparent lettering + wordmark, flames read through, rim-light legible */
  const lc = document.createElement('canvas'); lc.width = 1024; lc.height = 128;
  const lg = lc.getContext('2d'); lg.clearRect(0, 0, 1024, 128); lg.textAlign = 'center'; lg.textBaseline = 'middle';
  function glassWord(cx, txt, font, skew) {
    lg.save(); lg.translate(cx, 64); if (skew) lg.transform(1, 0, -0.22, 1, 0, 0); lg.font = font;
    const grad = lg.createLinearGradient(0, -44, 0, 44);
    grad.addColorStop(0, 'rgba(255,243,201,.62)'); grad.addColorStop(0.45, 'rgba(240,205,126,.5)'); grad.addColorStop(1, 'rgba(176,138,60,.55)');
    lg.strokeStyle = 'rgba(10,7,2,.85)'; lg.lineWidth = 12; lg.strokeText(txt, 0, 0);
    lg.fillStyle = grad; lg.fillText(txt, 0, 0);
    lg.lineWidth = 2.5; lg.strokeStyle = 'rgba(255,248,220,.95)'; lg.strokeText(txt, 0, -1.5); lg.restore();
  }
  [128, 640].forEach((cx) => glassWord(cx, 'F I F A', '900 100px Georgia, "Times New Roman", serif', false));
  [384, 896].forEach((cx) => glassWord(cx, 'FIFA', '900 italic 104px "Arial Narrow", "Helvetica Neue", Arial, sans-serif', true));
  [256, 512, 768, 1024].forEach((cx) => { lg.fillStyle = 'rgba(232,198,122,.75)'; lg.beginPath(); lg.arc(cx - 8, 64, 6, 0, 7); lg.fill(); });
  const ltex = new THREE.CanvasTexture(lc); ltex.wrapS = THREE.RepeatWrapping;
  band.material = new THREE.MeshBasicMaterial({ map: ltex, transparent: true, side: THREE.FrontSide, depthWrite: false });
  band.position.set(0, -1.05, 0); band.renderOrder = 10; group.add(band);

  /* firewood + embers — charred-bark diffuse + separate emissive ember-tip texture (PoC composition
     fix #2): a flat MeshStandardMaterial color on a low-poly cylinder next to a bright point light
     blows the material's own dark hue out to flat plastic; texture variance survives that. */
  const barkTex = new THREE.CanvasTexture(makeBarkColorCanvas('#241407'));
  const emberBarkTex = new THREE.CanvasTexture(makeBarkColorCanvas('#1c0f06'));
  const emberGlowTex = new THREE.CanvasTexture(makeEmberGlowCanvas());
  const barkM = new THREE.MeshStandardMaterial({ map: barkTex, color: 0xffffff, roughness: 0.95, metalness: 0 });
  const endM = new THREE.MeshStandardMaterial({ map: emberBarkTex, color: 0xffffff, roughness: 0.85, metalness: 0, emissiveMap: emberGlowTex, emissive: 0xff8a3a, emissiveIntensity: 1.3 });
  [[0.12, -0.2, 0], [-0.55, 0.5, 0.12], [0.9, -0.85, -0.1], [-1.15, 1.9, 0.05], [0.4, 1.25, -0.14]].forEach((l, i) => {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.7, 8), i % 2 ? barkM : endM);
    log.rotation.z = Math.PI / 2 + l[0]; log.rotation.y = l[1];
    log.position.set(l[2] * 2.4, -3.26 + i * 0.09, 0.3 + l[2]); group.add(log);
  });
  [[-0.45, 0.2], [0.5, 0.05], [0, 0.35]].forEach((e) => {
    const emb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x331608, emissive: 0xff7a30, emissiveIntensity: 1.6 }));
    emb.position.set(e[0] * 1.4, -3.18, 0.4 + e[1]); group.add(emb);
  });

  /* flame licks — 5-octave FBM shader flames (noise-erosion edges, ACES-safe ramp) replacing the
     old canvas-sprite teardrop tongues. Random per-instance ignite/die on a smoothed life envelope
     preserves the maintainer's "random tongue count for a live fire" behaviour. Anchored off fireBaseY
     (an earlier fix); uScale compensated by host world scale each frame (an earlier fix, see update()). */
  const flameGroup = new THREE.Group(); group.add(flameGroup);
  const flamePlane = new THREE.PlaneGeometry(1, 1);
  const flames = [];
  for (let tg = 0; tg < FLAME_N; tg++) {
    const mat = new THREE.RawShaderMaterial({
      uniforms: { uScale: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uLife: { value: 0 }, uStoke: { value: 0 }, uSeed: { value: Math.random() * 20 } },
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(flamePlane, mat);
    const ang = (tg / FLAME_N) * Math.PI * 2;
    mesh.position.set(Math.cos(ang) * (0.5 + Math.random() * 0.7), fireBaseY + 0.55, Math.sin(ang) * 0.35 + 0.6);
    mesh.renderOrder = 5; mesh.visible = false;
    flameGroup.add(mesh);
    flames.push({ mesh, mat, life: 0, target: 0, next: 0, h: 0.9, targetH: 0.9, on: true });
  }

  /* fire particles / ember sparks — same 130-particle buffer as before, now curl-drifted (JS value
     noise, see curlish2 above) and additively blended for a glowing-spark read instead of a flat
     blended dot; spawn position anchored off fireBaseY (an earlier fix). */
  const FN = 130, fpos2 = new Float32Array(FN * 3), fvel2 = [], flife2 = new Float32Array(FN), fcols2 = new Float32Array(FN * 3);
  for (let i = 0; i < FN; i++) { flife2[i] = -1; fvel2.push([0, 0, 0]); fpos2[i * 3 + 1] = -999; }
  const fgeo2 = new THREE.BufferGeometry();
  fgeo2.setAttribute('position', new THREE.BufferAttribute(fpos2, 3));
  fgeo2.setAttribute('color', new THREE.BufferAttribute(fcols2, 3));
  const sc2 = document.createElement('canvas'); sc2.width = sc2.height = 64;
  const sg2 = sc2.getContext('2d'), gr2 = sg2.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr2.addColorStop(0, 'rgba(255,255,255,1)'); gr2.addColorStop(0.4, 'rgba(255,255,255,.8)'); gr2.addColorStop(1, 'rgba(255,255,255,0)');
  sg2.fillStyle = gr2; sg2.fillRect(0, 0, 64, 64);
  const fmat2 = new THREE.PointsMaterial({ size: 0.38, map: new THREE.CanvasTexture(sc2), vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  const fire = new THREE.Points(fgeo2, fmat2); fire.frustumCulled = false; group.add(fire);

  /* smoke — faint slow-drifting billboards above the flames (new; PoC item #4). THREE.Sprite's
     built-in billboard shader already reads the ancestor world scale correctly (unlike the flame
     billboard trick above), so no manual host-scale compensation is needed here. */
  const smokeTexCanvas = document.createElement('canvas'); smokeTexCanvas.width = smokeTexCanvas.height = 64;
  const stx = smokeTexCanvas.getContext('2d'), sgrad = stx.createRadialGradient(32, 32, 2, 32, 32, 30);
  sgrad.addColorStop(0, 'rgba(255,255,255,1)'); sgrad.addColorStop(1, 'rgba(255,255,255,0)');
  stx.fillStyle = sgrad; stx.fillRect(0, 0, 64, 64);
  const smokeTex = new THREE.CanvasTexture(smokeTexCanvas);
  const smoke = [];
  for (let i = 0; i < 3; i++) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x332c26, transparent: true, opacity: 0, depthWrite: false }));
    spr.scale.setScalar(1.4 + Math.random() * 0.6);
    group.add(spr);
    smoke.push({ s: spr, t: Math.random() * 6, dur: 5 + Math.random() * 2.5, x0: (Math.random() - 0.5) * 0.9 });
  }
  /* NOTE: the PoC's screen-space heat-haze grab-pass (render scene to a texture, sample it wobbled
     behind the flame) is deliberately NOT included here — it needs a renderer/WebGLRenderTarget
     this shared lib has no access to (buildCauldron only receives {THREE, GLTFLoader, opts}, never
     the renderer). A build that owns its renderer can add it as a per-build opt-in the same way
     fire-poc/index.html does (HAZE_VERT/HAZE_FRAG + a grab-pass render before the main render). */

  let fi = 0, brew = 0, emitAcc = 0, simTime = 0;
  function stoke() { brew = 0.8; burpT = 0; }
  function update(dt, now) {
    simTime += dt;
    if (burpT >= 0) {
      burpT += dt; const bt = burpT / 0.62;
      /* the burp travels pool -> the hood's MEASURED intake mouth (an earlier fix — it used to rise a
         hardcoded 2.0 units and vanish mid-air; now it visibly disappears INTO the aperture:
         it ends just past the mouth plane, shrinking hard over the last stretch as it's
         swallowed, and the hood answers with a small catch-gather of its own). */
      const y0 = poolY + 0.18;
      const y1 = hood.position.y + intakeLocal.y + 0.15;
      /* the arrival mini-gather only fires if no host-synced hold is active — a burp landing
         mid-hold must never restart/shrink the pulse's own envelope */
      if (bt >= 1) { burpT = -1; burp.visible = false; hoodGlow.intensity = 2.4; if (hoodT < 0) hoodReceive(0.4, 0.45); }
      else {
        burp.visible = true;
        burp.position.set(intakeLocal.x * bt, y0 + (y1 - y0) * bt, 0.2 + (intakeLocal.z - 0.2) * bt);
        const swallow = bt > 0.82 ? 1 - (bt - 0.82) / 0.18 * 0.85 : 1;
        burp.scale.setScalar((1 - bt * 0.45) * swallow);
      }
    }
    hoodGlow.intensity = Math.max(0, hoodGlow.intensity - dt * 4);
    /* the hood's catch->gather->send envelope (hoodReceive). gather builds through the hold
       window and releases as the duct flashes its send — the funnel visibly lights up from the
       mouth toward the throat while it holds the charge, then hands it out the side duct. */
    let gatherTgt = 0;
    if (hoodT >= 0) {
      hoodT += dt;
      const hk = hoodT / hoodDur;
      if (hk >= 1) { hoodT = -1; ductT = 0; gatherTgt = gatherPeak; }
      else gatherTgt = gatherPeak * Math.min(1, hk * 4) * (0.55 + 0.45 * hk); // fast catch, building toward the send
    }
    gatherLevel += (gatherTgt - gatherLevel) * Math.min(1, dt * 9);
    const gFlick = 1 + Math.sin(simTime * 13.7) * 0.12 + Math.sin(simTime * 7.3) * 0.08;
    gatherMat.opacity = Math.min(0.85, 0.55 * gatherLevel * gFlick);
    throatMat.opacity = Math.min(0.95, 0.9 * gatherLevel * gFlick);   // brightest at the throat
    hoodGlow.intensity = Math.max(hoodGlow.intensity, gatherLevel * 4.2);
    if (ductT >= 0) {
      ductT += dt;
      const dRem = 1 - ductT / 0.45;
      if (dRem <= 0) { ductT = -1; ductFlashMat.opacity = 0; }
      else {
        ductFlashMat.opacity = 0.9 * dRem;
        ductFlash.scale.setScalar(Math.max(0.2, funnelR * 0.34) * (1 + (1 - dRem) * 1.4));
      }
    } else if (gatherLevel < 0.02) ductFlashMat.opacity = 0;
    for (let bz = 0; bz < bubbles.length; bz++) {
      const B2 = bubbles[bz]; B2.t += dt; const cyc = 1.1 + (bz % 4) * 0.35; const ph = (B2.t % cyc) / cyc;
      if (ph < 0.7) { B2.m.visible = true; B2.m.position.set(Math.cos(B2.a) * B2.r, poolY - 0.12 + ph * 0.22, Math.sin(B2.a) * B2.r * 0.5 + 0.2); B2.m.scale.setScalar(0.7 + ph * 0.5); }
      else if (ph < 0.82) { B2.m.scale.setScalar(1.2 + (ph - 0.7) * 3.5); B2.m.visible = (Math.floor(B2.t * 30) % 2) === 0; }
      else { B2.m.visible = false; if (ph > 0.98) { B2.a = Math.random() * Math.PI * 2; B2.r = 0.35 + Math.random() * 0.95; } }
    }
    brew = Math.max(0, brew - dt);
    earth.rotation.y += dt * 0.35; band.rotation.y -= dt * 0.16;
    clouds.rotation.y += dt * 0.55; // independent drift on top of earth's own spin
    earth.position.y = earthBaseY + Math.sin(now / 1400) * 0.07 + Math.sin(now / 420) * 0.02;
    earth.rotation.x = Math.sin(now / 2600) * 0.06; atmo.position.copy(earth.position);

    const hostScale = worldScaleOf(group);

    /* flames: random ignite/die (the maintainer's "random tongue count"), smoothed life envelope, height
       variation — brew (the stoke() coupling) raises ignite odds, height, and flicker turbulence,
       so a launch reads as the fire visibly flaring up, not just the light. */
    for (let tq = 0; tq < flames.length; tq++) {
      const F = flames[tq];
      if (now > F.next) { F.on = Math.random() < 0.62 + brew * 0.3; F.targetH = 0.6 + Math.random() * (0.8 + brew * 0.8); F.next = now + 260 + Math.random() * 640; }
      F.target = F.on ? 1 : 0;
      F.life += (F.target - F.life) * Math.min(1, dt * 3.4);
      if (F.life < 0.004) F.life = 0;
      F.h += (F.targetH - F.h) * dt * 1.8;
      const flick = 1 + Math.sin(simTime * (5.5 + tq) + tq * 2.1) * 0.10;
      F.mat.uniforms.uScale.value.set(
        (0.62 + F.h * 0.20) * hostScale * FLAME_SIZE_MULT,
        F.h * flick * (1 + brew * 0.35) * hostScale * FLAME_SIZE_MULT
      );
      F.mat.uniforms.uLife.value = F.life;
      F.mat.uniforms.uTime.value = simTime;
      F.mat.uniforms.uStoke.value = brew;
      F.mesh.visible = F.life > 0.003;
    }

    /* fire light: Voss-McCartney pink noise, not Math.random() per frame — measurably smoother
       frame-to-frame than the naive sin+random flicker it replaces (fire-poc/REPORT.md), same
       mean/amplitude envelope as before so every build's tuned brightness carries over unchanged.
       Base raised by brew, not swing amplitude (an earlier fix — swing size is what breaks the smoothness
       property). Real falloff preserved (distance 30, decay 2 explicit; an earlier fix). */
    const pl = pinkLight.tick(dt);
    fireLight.intensity = 1.55 + pl * 0.28 + brew * 1.8;
    fireLight.position.set(
      fireLightBase.x + pinkJitterX.tick(dt) * 0.05,
      fireLightBase.y,
      fireLightBase.z + pinkJitterZ.tick(dt) * 0.05
    );
    const bedPulse = 0.45 + pinkBed.tick(dt) * 0.25 + brew * 0.4;
    emberBedMat.opacity = Math.max(0, Math.min(0.7, bedPulse));

    /* ember sparks: curl-drifted (JS value noise), additive blend, warm-to-dark ramp over life */
    emitAcc += dt * (72 + brew * 110);
    while (emitAcc >= 1) {
      emitAcc -= 1; const i2 = fi = (fi + 1) % FN;
      const a = Math.random() * Math.PI * 2, rr = 0.7 + Math.random() * 0.65;
      fpos2[i2 * 3] = Math.cos(a) * rr * 1.35; fpos2[i2 * 3 + 1] = fireBaseY + 0.05; fpos2[i2 * 3 + 2] = Math.sin(a) * rr * 0.6 + 0.6;
      fvel2[i2] = [(Math.random() - 0.5) * 0.3, 1.1 + Math.random() * 0.9 + brew * 0.7, (Math.random() - 0.5) * 0.2]; flife2[i2] = 1;
    }
    for (let i3 = 0; i3 < FN; i3++) {
      if (flife2[i3] < 0) continue; flife2[i3] -= dt * 1.25;
      if (flife2[i3] < 0) { fpos2[i3 * 3 + 1] = -999; fcols2[i3 * 3] = fcols2[i3 * 3 + 1] = fcols2[i3 * 3 + 2] = 0; continue; }
      const [cx, cz] = curlish2(i3, simTime * 0.6 + fpos2[i3 * 3] * 0.05);
      fpos2[i3 * 3] += (fvel2[i3][0] + cx * 0.55) * dt; fpos2[i3 * 3 + 1] += fvel2[i3][1] * dt; fpos2[i3 * 3 + 2] += (fvel2[i3][2] + cz * 0.4) * dt;
      const lf = flife2[i3]; fcols2[i3 * 3] = 1; fcols2[i3 * 3 + 1] = 0.35 + lf * 0.55; fcols2[i3 * 3 + 2] = Math.max(0, lf - 0.6) * 0.9;
    }
    fgeo2.attributes.position.needsUpdate = true; fgeo2.attributes.color.needsUpdate = true;

    /* smoke: faint rise + fade, anchored off fireBaseY (an earlier fix) */
    for (const S of smoke) {
      S.t += dt; const ph = (S.t % S.dur) / S.dur;
      S.s.position.set(S.x0 + Math.sin(now / 2000 + S.x0 * 10) * 0.15, fireBaseY + 1.55 + ph * 3.4, 0.4 + Math.sin(now / 1700) * 0.1);
      S.s.scale.setScalar(1.3 + ph * 1.1);
      const fadeIn = Math.min(1, ph * 6), fadeOut = Math.min(1, (1 - ph) * 3);
      S.s.material.opacity = 0.16 * fadeIn * fadeOut * (1 - brew * 0.3);
    }
  }
  /* 2026-07-16 ADDITIVE API (every existing {group,stoke,update} caller unchanged):
     - potMouth()/hoodIntake()/hoodDuctExit() — WORLD-space anchors, recomputed on every call
       (never cached: the GLBs load async and hosts scale/move the group — an earlier fix). Until hoodReady()
       is true they return the fallback-geometry positions; opts.onHoodReady fires exactly once,
       when BOTH GLBs are in and every anchor is genuinely measured.
     - hoodReceive(durationSec) — drive the hood's catch->gather->send envelope in sync with a
       host's own pulse timing (see the comment at its definition). */
  function potMouth() { group.updateWorldMatrix(true, false); return group.localToWorld(new THREE.Vector3(0, poolY + 0.15, 0.2)); }
  function hoodIntake() { hood.updateWorldMatrix(true, false); return hood.localToWorld(intakeLocal.clone()); }
  function hoodDuctExit() { hood.updateWorldMatrix(true, false); return hood.localToWorld(ductExitLocal.clone()); }
  function hoodReady() { return hoodLoaded && vesselLoaded; }
  return { group, stoke, update, potMouth, hoodIntake, hoodDuctExit, hoodReceive, hoodReady };
}

export function buildTrophy(THREE, GLTFLoader, opts) {
  opts = opts || {};
  const glbBase = opts.glbBase || './glb/';
  const group = new THREE.Group();
  if (opts.scale) group.scale.setScalar(opts.scale);
  (opts.parent || {}).add && opts.parent.add(group);
  const glow = new THREE.PointLight(0xe8c67a, 1.1, 30); glow.position.set(0, -2.4, 2.4); group.add(glow);
  const pivot = new THREE.Group(); group.add(pivot);
  new GLTFLoader().load(glbBase + 'wc-trophy.glb', (g) => {
    const o = g.scene, bb0 = new THREE.Box3().setFromObject(o), sz = bb0.getSize(new THREE.Vector3());
    o.scale.setScalar(3.4 / Math.max(0.001, sz.y));
    const bb = new THREE.Box3().setFromObject(o), c = bb.getCenter(new THREE.Vector3());
    o.position.set(-c.x, -bb.min.y - 2.55, -c.z); pivot.add(o);
    /* an earlier revision: expose the measured, POST-SCALE local bounds (in the same local frame the GLB was just
       positioned into: x/z centered on 0, y from -2.55 at the base) so a caller can shape a fluid
       mesh to the trophy's OWN silhouette instead of bolting a same-size guess beside it. Optional —
       existing callers that don't pass onBounds are unaffected. */
    if (opts.onBounds) {
      const bsz = bb.getSize(new THREE.Vector3());
      opts.onBounds({ height: bsz.y, width: bsz.x, depth: bsz.z, minY: -2.55, maxY: -2.55 + bsz.y });
    }
    if (opts.onReady) opts.onReady('trophy');
  }, undefined, () => { if (opts.onReady) opts.onReady('trophy-fail'); });

  const N = 420, pos = new Float32Array(N * 3), vel = [], life = new Float32Array(N), cols = new Float32Array(N * 3), base = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { life[i] = -1; vel.push([0, 0, 0]); pos[i * 3 + 1] = -999; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const spr = document.createElement('canvas'); spr.width = spr.height = 64;
  const sg = spr.getContext('2d'), grd = sg.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  sg.fillStyle = grd; sg.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(spr);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.22, map: tex, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  pts.frustumCulled = false; group.add(pts);
  const NF = 64, fpos = new Float32Array(NF * 3), fvel = [], flife = new Float32Array(NF), fcols = new Float32Array(NF * 3);
  for (let f0 = 0; f0 < NF; f0++) { flife[f0] = -1; fvel.push([0, 0, 0]); fpos[f0 * 3 + 1] = -999; }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fgeo.setAttribute('color', new THREE.BufferAttribute(fcols, 3));
  const fpts = new THREE.Points(fgeo, new THREE.PointsMaterial({ size: 0.62, map: tex, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  fpts.frustumCulled = false; group.add(fpts);
  let nextP = 0, nextF = 0, side = 1;
  const igniteQueue = [];
  function burst(sd, forced) {
    const shell = forced || SHELLS[Math.floor(Math.random() * SHELLS.length)];
    const second = Math.random() < 0.33 ? SHELLS[Math.floor(Math.random() * SHELLS.length)] : [1, 1, 1];
    for (let k = 0; k < 105; k++) {
      const i2 = nextP = (nextP + 1) % N;
      const th = Math.random() * Math.PI * 2, up = 0.95 + Math.random() * 1.2, r = 0.75 + Math.random() * 1.25;
      pos[i2 * 3] = sd * 0.24; pos[i2 * 3 + 1] = 0.95; pos[i2 * 3 + 2] = 0;
      vel[i2] = [Math.cos(th) * r, up, Math.sin(th) * r * 0.55]; life[i2] = 1;
      const pc = Math.random() < 0.3 ? second : shell;
      base[i2 * 3] = pc[0]; base[i2 * 3 + 1] = pc[1]; base[i2 * 3 + 2] = pc[2];
    }
    for (let k2 = 0; k2 < 9; k2++) {
      const i4 = nextF = (nextF + 1) % NF;
      fpos[i4 * 3] = sd * 0.24 + (Math.random() - 0.5) * 0.12; fpos[i4 * 3 + 1] = 0.95 + (Math.random() - 0.5) * 0.12; fpos[i4 * 3 + 2] = 0;
      fvel[i4] = [(Math.random() - 0.5) * 0.5, 0.4 + Math.random() * 0.5, 0]; flife[i4] = 1;
      fcols[i4 * 3] = 1; fcols[i4 * 3 + 1] = 0.98; fcols[i4 * 3 + 2] = 0.9;
    }
    fgeo.attributes.color.needsUpdate = true;
  }
  function detonate(shell) { igniteQueue.push(shell || SHELLS[Math.floor(Math.random() * SHELLS.length)]); }
  function update(dt, now) {
    pivot.rotation.y += dt * 0.55;
    while (igniteQueue.length) { burst(side, igniteQueue.shift()); side = -side; }
    for (let i3 = 0; i3 < N; i3++) {
      if (life[i3] < 0) continue; life[i3] -= dt * 0.5;
      if (life[i3] < 0) { pos[i3 * 3 + 1] = -999; cols[i3 * 3] = cols[i3 * 3 + 1] = cols[i3 * 3 + 2] = 0; continue; }
      vel[i3][1] -= dt * 2.5;
      pos[i3 * 3] += vel[i3][0] * dt; pos[i3 * 3 + 1] += vel[i3][1] * dt; pos[i3 * 3 + 2] += vel[i3][2] * dt;
      const fade = Math.min(1, life[i3] * 1.7), tw = life[i3] < 0.45 && Math.random() < 0.12 ? 0.25 : 1;
      cols[i3 * 3] = base[i3 * 3] * fade * tw; cols[i3 * 3 + 1] = base[i3 * 3 + 1] * fade * tw; cols[i3 * 3 + 2] = base[i3 * 3 + 2] * fade * tw;
    }
    for (let i5 = 0; i5 < NF; i5++) {
      if (flife[i5] < 0) continue; flife[i5] -= dt * 3.2;
      if (flife[i5] < 0) { fpos[i5 * 3 + 1] = -999; continue; }
      fpos[i5 * 3] += fvel[i5][0] * dt; fpos[i5 * 3 + 1] += fvel[i5][1] * dt;
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; fgeo.attributes.position.needsUpdate = true;
  }
  /* an earlier revision: expose `pivot` (additive, existing {group,detonate,update} callers unaffected) — it's the
     node that actually spins (`pivot.rotation.y += dt*0.55` above) and that the loaded GLB is
     centered into per onBounds' local frame. A caller shaping fluid to the trophy's own cup interior
     needs to parent that fluid to THIS node, not `group`, or the liquid sits still while the trophy
     visibly rotates away from it — the exact "reads as an adjacent vessel" failure the maintainer flagged. */
  return { group, pivot, detonate, update };
}
