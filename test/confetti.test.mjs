// Unit tests for the deterministic core of the goal-celebration module.
// Zero-dep: node:test + node:assert. Pins the behaviour the renderer relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationMs, forceFor, originFor, resolveColors } from '../site/confetti.js';

test('durationMs: 5–10s, scales with the team tally, clamped', () => {
  assert.equal(durationMs(1), 5000);          // 1st goal = 5s
  assert.equal(durationMs(2), 6250);
  assert.equal(durationMs(5), 10000);         // hits the 10s cap
  assert.equal(durationMs(9), 10000);         // stays clamped
  assert.equal(durationMs(0), 5000);          // guard: never below 1 goal
  assert.ok(durationMs(3) > durationMs(2));   // monotonic
});

test('forceFor: floored so an equaliser still pops, scales with |diff|, capped', () => {
  const eq = forceFor(0);                      // 1–1 equaliser, diff 0
  assert.ok(eq.particles >= 80, 'equaliser still gets a real burst (floor)');
  const big = forceFor(4);
  assert.ok(big.particles > eq.particles, 'a bigger lead erupts more');
  assert.ok(big.velocity > eq.velocity && big.spread > eq.spread);
  assert.deepEqual(forceFor(7), forceFor(5));  // capped at |diff| 5
  assert.deepEqual(forceFor(-3), forceFor(3)); // magnitude only
  assert.ok(forceFor(5).particles <= 300, 'particle count capped for GPU safety');
});

test('originFor: home from the left edge, away from the right, any viewport', () => {
  assert.deepEqual(originFor('home', 1440), { x: 0, edge: 'left', dir: 1 });
  assert.deepEqual(originFor('away', 1440), { x: 1440, edge: 'right', dir: -1 });
  assert.equal(originFor('home', 375).x, 0);    // mobile: still left
  assert.equal(originFor('away', 375).x, 375);  // mobile: still right edge
});

test('resolveColors: always ≥2; single-colour flags fall back to [primary, white]', () => {
  assert.deepEqual(resolveColors({ colors: ['#d7141a', '#11457e', '#eeeeee'] }).length, 3);
  // Switzerland-style single-colour entry → primary + flag white
  const swiss = resolveColors({ colors: ['#d32d27'], ui: { primary: '#d32d27', secondary: '#d7dadd' } });
  assert.equal(swiss.length, 2);
  assert.equal(swiss[0], '#d32d27');
  assert.equal(swiss[1], '#d7dadd');
  // pathological empty entry still yields 2 usable colours
  assert.ok(resolveColors({}).length >= 2);
  assert.ok(resolveColors(null).length >= 2);
});
