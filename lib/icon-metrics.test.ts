import assert from 'node:assert/strict';
import test from 'node:test';

const metrics: typeof import('./icon-metrics') = await import(new URL('./icon-metrics.ts', import.meta.url).href);
const { analyzeAlphaBounds, METRICS_ALPHA_THRESHOLD } = metrics;

function pixels(width: number, height: number, paint: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // White artwork must count, just like black artwork.
    data.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 3);
    data[(y * width + x) * 4 + 3] = paint(x, y);
  }
  return data;
}

test('visible artwork is measured instead of the square canvas', () => {
  const result = analyzeAlphaBounds(pixels(100, 100, (x, y) => x >= 30 && x < 70 && y >= 40 && y < 60 ? 255 : 0), 100, 100)!;
  assert.deepEqual(result.bounds, { x: 30, y: 40, width: 40, height: 20 });
  assert.equal(result.ratio, 2);
  assert.equal(result.squareDeviationPercent, 100);
  assert.equal(result.nearSquare, false);
  assert.deepEqual(result.centroid, { x: 50, y: 50 });
  assert.equal(result.centerOffset.distancePercent, 0);
  assert.equal(result.touchesCanvasEdge, false);
});

test('negative space and alpha-weighted mass affect balance independently of 1:1 bounds', () => {
  const result = analyzeAlphaBounds(pixels(10, 10, (x, y) => y >= 2 && y < 8 && x >= 2 && x < 8 ? (x < 4 ? 255 : 85) : 0), 10, 10)!;
  assert.equal(result.nearSquare, true);
  assert.equal(result.ratio, 1);
  assert.equal(result.centroid.x, 4.2);
  assert.equal(result.centroid.y, 5);
  assert.ok(Math.abs(result.centerOffset.distancePercent - 8) < 1e-10);
  const hollow = analyzeAlphaBounds(pixels(10, 10, (x, y) => x >= 2 && x < 8 && y >= 2 && y < 8 && !(x >= 4 && y >= 4) ? 255 : 0), 10, 10)!;
  assert.equal(hollow.ratio, 1);
  assert.ok(hollow.centroid.x < 5 && hollow.centroid.y < 5);
});

test('near-square tolerance is symmetric for horizontal and vertical artwork', () => {
  const horizontal = analyzeAlphaBounds(pixels(32, 32, (x, y) => x < 21 && y < 20 ? 255 : 0), 32, 32)!;
  const vertical = analyzeAlphaBounds(pixels(32, 32, (x, y) => x < 20 && y < 21 ? 255 : 0), 32, 32)!;
  assert.equal(horizontal.nearSquare, true);
  assert.equal(vertical.nearSquare, true);
  assert.equal(horizontal.squareDeviationPercent, vertical.squareDeviationPercent);
  assert.equal(analyzeAlphaBounds(pixels(32, 32, (x, y) => x < 22 && y < 20 ? 255 : 0), 32, 32)!.nearSquare, false);
});

test('transparent art and invisible fringe cannot produce a passing measurement', () => {
  assert.equal(analyzeAlphaBounds(pixels(12, 12, () => 0), 12, 12), null);
  assert.equal(analyzeAlphaBounds(pixels(12, 12, () => METRICS_ALPHA_THRESHOLD - 1), 12, 12), null);
  const result = analyzeAlphaBounds(pixels(12, 12, (x, y) => x === 6 && y === 6 ? METRICS_ALPHA_THRESHOLD : 1), 12, 12)!;
  assert.deepEqual(result.bounds, { x: 6, y: 6, width: 1, height: 1 });
  assert.deepEqual(result.centroid, { x: 6.5, y: 6.5 });
});

test('edge contact and rectangular rasters report meaningful normalized offsets', () => {
  const result = analyzeAlphaBounds(pixels(20, 10, (x, y) => x < 4 && y < 4 ? 255 : 0), 20, 10)!;
  assert.equal(result.touchesCanvasEdge, true);
  assert.deepEqual(result.centroid, { x: 2, y: 2 });
  assert.deepEqual(result.centerOffset, { xPercent: -40, yPercent: -30, distancePercent: 50 });
});

test('malformed rasters do not return fabricated geometry', () => {
  assert.throws(() => analyzeAlphaBounds(new Uint8Array(3), 1, 1), /complete/);
  assert.throws(() => analyzeAlphaBounds([], 0, 0), /complete/);
  assert.throws(() => analyzeAlphaBounds([], 1.5, 2), /complete/);
  assert.throws(() => analyzeAlphaBounds([0, 0, 0, Number.NaN], 1, 1), /invalid alpha/);
});
