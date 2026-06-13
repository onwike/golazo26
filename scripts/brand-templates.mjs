// brand-templates.mjs — pure SVG-string functions. f(colors, T)
// only — no fs, no network. All artwork original; generic football vocabulary
// exclusively (ball/pitch/goal/burst). No shields, no trophies, no mascots.

const burstRays = (cx, cy, r0, T, angles = [-70, -40, -10, 20], lens = [9, 13, 11, 8]) =>
  angles.map((a, i) => {
    const rad = ((a - 90) * Math.PI) / 180;
    const [x1, y1] = [cx + r0 * Math.cos(rad), cy + r0 * Math.sin(rad)];
    const [x2, y2] = [cx + (r0 + lens[i]) * Math.cos(rad), cy + (r0 + lens[i]) * Math.sin(rad)];
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }).join(' ');

// Concept A — "Ball-O burst": the identity mark (header, favicon)
export function markBallO(T, { ink = T.ink, accent = T.accent } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round">
<circle cx="28" cy="38" r="17" stroke="${ink}" stroke-width="4"/>
<path d="M28 30.5 L35.1 35.7 32.4 44.1 H23.6 L20.9 35.7 Z" stroke="${ink}" stroke-width="3"/>
<path d="M28 30.5 V21 M35.1 35.7 L44.7 32.9 M32.4 44.1 L38 51.8 M23.6 44.1 L18 51.8 M20.9 35.7 L11.3 32.9" stroke="${ink}" stroke-width="3"/>
<path d="${burstRays(28, 38, 22, T)}" stroke="${accent}" stroke-width="${T.strokeW + 1}"/>
</svg>`;
}

// favicon: standalone file with dark-mode ink swap; flat variant for rasterizers
export function faviconSVG(T) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round">
<style>:root{--i:#15181d;--a:#0a7d33}@media(prefers-color-scheme:dark){:root{--i:#e9edf3;--a:#2ee06f}}</style>
<circle cx="28" cy="38" r="17" stroke="var(--i)" stroke-width="5"/>
<path d="M28 30.5 L35.1 35.7 32.4 44.1 H23.6 L20.9 35.7 Z" stroke="var(--i)" stroke-width="4"/>
<path d="M28 30.5 V21 M35.1 35.7 L44.7 32.9 M32.4 44.1 L38 51.8 M23.6 44.1 L18 51.8 M20.9 35.7 L11.3 32.9" stroke="var(--i)" stroke-width="3.5"/>
<path d="${burstRays(28, 38, 22, { strokeW: 4 })}" stroke="var(--a)" stroke-width="5"/>
</svg>`;
}
export const faviconFlatSVG = () => faviconSVG({}).replace(/<style>.*?<\/style>/s, '').replaceAll('var(--i)', '#15181d').replaceAll('var(--a)', '#0a7d33');

// Concept C — "Top-corner 26": hero/OG art
export function topCorner26(T, scale = 1) {
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round" transform="scale(${scale})">
<path d="M10 56 V14 H86 V56" stroke="${T.ink}" stroke-width="5" stroke-linecap="square"/>
<path d="M29 14 V52 M48 14 V52 M67 14 V52 M10 27 H86 M10 40 H86" stroke="${T.ink}" stroke-width="1.25" opacity=".3"/>
<path d="M6 60 Q34 8 72 26" stroke="${T.ink}" stroke-width="2.5" stroke-dasharray="1 7"/>
<circle cx="74" cy="27" r="8" fill="${T.accent}" stroke="none"/>
</g>`;
}

// per-team banner: diagonal flag-color stripes + pitch motif
export function teamBanner(c, T) {
  const dx = Math.tan((T.stripeAngle * Math.PI) / 180) * 240;
  const stripe = (x, w, fill, o = 1) =>
    `<polygon points="${(x + dx).toFixed(0)},0 ${(x + w + dx).toFixed(0)},0 ${(x + w - dx).toFixed(0)},240 ${(x - dx).toFixed(0)},240" fill="${fill}" opacity="${o}"/>`;
  const tex = T.texture === 'scanlines'
    ? `<g opacity=".05" stroke="${T.ink}" stroke-width="1">${Array.from({ length: 30 }, (_, i) => `<path d="M0 ${i * 8} H1200"/>`).join('')}</g>`
    : T.texture === 'grain'
      ? `<g fill="${T.ink}" opacity=".05">${Array.from({ length: 12 }, (_, r) => Array.from({ length: 60 }, (_, col) => ((r * 7 + col * 13) % 5 === 0 ? `<circle cx="${col * 20 + (r % 2) * 10}" cy="${r * 20 + 8}" r=".7"/>` : '')).join('')).join('')}</g>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" preserveAspectRatio="xMidYMid slice" role="img" aria-label="">
<rect width="1200" height="240" fill="${T.surface}"/>
${stripe(700, 150, c.ui.primary)}
${stripe(880, 90, c.ui.secondary, 0.92)}
${stripe(995, 24, c.colors[2] ?? c.ui.primary, 0.85)}
<circle cx="130" cy="240" r="150" fill="none" stroke="${T.ink}" stroke-width="2" opacity="${T.lineOpacity}"/>
<path d="M0 26 H1200" stroke="${T.ink}" stroke-width="1" opacity="${(T.lineOpacity * 0.6).toFixed(3)}"/>
${tex}
</svg>`;
}

// chalk-doodle sprite (symbols; currentColor; sized by consumer)
export function doodlesSVG(T, wobble) {
  const W = (d) => wobble(d);
  return `<svg xmlns="http://www.w3.org/2000/svg">
<symbol id="d-ball" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${T.strokeW}" stroke-linecap="round" stroke-linejoin="round">
<circle cx="12" cy="12" r="9"/><path d="${W('M12 8.6 L15.2 11 14 14.8 H10 L8.8 11 Z')}"/><path d="${W('M12 8.6 V3.5 M15.2 11 L20 9.5 M14 14.8 L17 19 M10 14.8 L7 19 M8.8 11 L4 9.5')}"/>
</symbol>
<symbol id="d-goal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${T.strokeW}" stroke-linecap="round">
<path d="${W('M3 19 V8 H21 V19')}"/><path d="M7.5 8 V16.5 M12 8 V16.5 M16.5 8 V16.5 M3 11.5 H21 M3 15 H21" stroke-width="1" opacity=".35"/>
</symbol>
<symbol id="d-whistle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${T.strokeW}" stroke-linecap="round" stroke-linejoin="round">
<circle cx="10" cy="14" r="6"/><path d="${W('M14.8 9.6 L21 7.6 V11.4 L16 12.8')}"/><circle cx="10" cy="14" r="1.6" fill="currentColor" stroke="none"/><path d="${W('M8 7 Q10 3 14 4')}" opacity=".5"/>
</symbol>
<symbol id="d-boot" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${T.strokeW}" stroke-linecap="round" stroke-linejoin="round">
<path d="${W('M4 16 Q4 8 9 8 H11 Q12 11 15 12 Q18 13 21 14 V18 H4 Z')}"/><path d="M6 20 v1.6 M10 20 v1.6 M14 20 v1.6 M18 20 v1.6 M9.5 10 l2.4 1.4 M8.6 12.2 l2.4 1.4"/>
</symbol>
<symbol id="d-stadium" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${T.strokeW}" stroke-linecap="round">
<path d="${W('M2 16 a10 5 0 0 1 20 0')}"/><path d="${W('M6 16 a6 2.5 0 0 1 12 0')}" opacity=".6"/><path d="M5 9 L7 4 M19 9 L17 4"/>
</symbol>
<symbol id="d-burst" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${T.strokeW}" stroke-linecap="round">
<path d="M12 9 V3 M16 10.5 L20.5 6.5 M17.5 14 H23 M7 10.5 L3 6.5"/>
</symbol>
</svg>`;
}

// abstract-pitch hero background
export function heroSVG(T) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320" fill="none">
<g stroke="${T.ink}" stroke-width="2" opacity="${T.lineOpacity}">
<circle cx="600" cy="470" r="220"/>
<path d="M600 0 V320"/>
<rect x="1020" y="40" width="180" height="240"/>
<path d="M1020 130 A70 70 0 0 0 1020 230"/>
<path d="M0 84 A84 84 0 0 0 84 0"/>
</g>
<g stroke="${T.accent}" stroke-width="4" stroke-linecap="round" opacity=".9">
<path d="${burstRays(1100, 60, 16, T, [-60, -20, 25], [12, 16, 10])}"/>
</g>
</svg>`;
}

// OG composition (1200x630): direction bg + goal art + lockup + claim
export function ogSVG(T, { title = 'Golazo 26', claim = 'Every match. Every way to watch. Free first.', banner = null } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${T.bg}"/>
${banner ? `<g opacity=".5" transform="translate(0,390) scale(1)">${banner.replace(/<\/?svg[^>]*>/g, '')}</g>` : ''}
<g transform="translate(640,90) scale(5.2)" opacity=".95">${topCorner26(T)}</g>
<g transform="translate(80,150) scale(2.6)">${markBallO(T).replace(/<\/?svg[^>]*>/g, '')}</g>
<text x="80" y="420" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-weight="800" font-size="92" fill="${T.ink}" letter-spacing="2">${title}</text>
<text x="82" y="478" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-weight="500" font-size="34" fill="${T.muted}">${claim}</text>
<text x="82" y="560" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-weight="600" font-size="26" fill="${T.accent}">golazo26.onwike.workers.dev</text>
</svg>`;
}
