// brand-tokens.mjs — the one table that skins every brand asset.
// Directions: A "broadcast" (scheduled matches + global shell), B "print"
// (live matches), R "record" (finished matches). data/brand-direction.json
// picks the GLOBAL shell direction; per-match-state skins always use all three.

export const DIRECTIONS = {
  broadcast: {
    key: 'broadcast',
    bg: '#0b0e14', surface: '#11151d', card: '#161b23',
    ink: '#e9edf3', muted: '#8b95a3',
    accent: '#2ee06f', accent2: '#ff3d7f',
    strokeW: 2.75, wobble: 0, cornerR: 6, stripeAngle: 22,
    lineOpacity: 0.14, texture: 'scanlines',
  },
  print: {
    key: 'print',
    bg: '#faf5ec', surface: '#fffdf7', card: '#fffdf7',
    ink: '#2b2620', muted: '#6e6258',
    accent: '#0a7d33', accent2: '#c2410c',
    strokeW: 2.5, wobble: 1.0, cornerR: 3, stripeAngle: 14,
    lineOpacity: 0.10, texture: 'grain',
  },
  record: {
    key: 'record',
    bg: '#f4f5f6', surface: '#fbfbfc', card: '#ffffff',
    ink: '#272c33', muted: '#5c6570',
    accent: '#39424c', accent2: '#0a7d33',
    strokeW: 2, wobble: 0, cornerR: 8, stripeAngle: 18,
    lineOpacity: 0.06, texture: 'none',
  },
};

// simple HSL lightness clamp for on-light/on-dark contrast variants
export function adjustForContrast(hex, mode) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  l = mode === 'onLight' ? Math.min(l, 0.34) : Math.max(l, 0.62);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r2, g2, b2] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r2, g2, b2].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

// chalk-wobble: replace straight path segments with subtle quadratics.
// amplitude = wobble% of viewBox size; deterministic (seeded by coords).
export function wobblePath(d, T, vb = 64) {
  if (!T.wobble) return d;
  const amp = (T.wobble / 100) * vb;
  const jitter = (x, y, k) => {
    const s = Math.sin(x * 12.9898 + y * 78.233 + k) * 43758.5453;
    return (s - Math.floor(s) - 0.5) * 2 * amp;
  };
  return d.replace(/([ML]) ?(-?[\d.]+)[ ,](-?[\d.]+)/g, (m, cmd, x, y) =>
    `${cmd}${(+x + jitter(+x, +y, 1)).toFixed(2)} ${(+y + jitter(+x, +y, 2)).toFixed(2)}`);
}
