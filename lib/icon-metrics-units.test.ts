import assert from 'node:assert/strict';
import test from 'node:test';

const { getArtworkDimensionsInUnits }: typeof import('./icon-metrics-units') = await import(new URL('./icon-metrics-units.ts', import.meta.url).href);

test('artwork dimensions distinguish a small square from its larger canvas and preview', () => {
  const result = getArtworkDimensionsInUnits('<svg width="240" height="240" viewBox="0 0 24 24"/>', { x: 128, y: 128, width: 256, height: 256 });
  assert.deepEqual(result, { artwork: { width: 12, height: 12 }, canvas: { width: 24, height: 24 } });
});

test('rectangular artboards retain a uniform conversion despite measurement letterboxing', () => {
  assert.deepEqual(getArtworkDimensionsInUnits('<svg viewBox="-6 4 48 24"/>', { x: 128, y: 192, width: 256, height: 128 }), {
    artwork: { width: 24, height: 12 }, canvas: { width: 48, height: 24 },
  });
  assert.deepEqual(getArtworkDimensionsInUnits('<svg viewBox="10 20 24 48"/>', { x: 192, y: 128, width: 128, height: 256 }), {
    artwork: { width: 12, height: 24 }, canvas: { width: 24, height: 48 },
  });
});

test('dimensions use numeric source sizes when no viewBox exists and do not invent an unknown canvas', () => {
  assert.deepEqual(getArtworkDimensionsInUnits('<svg width="32px" height="16px"/>', { x: 0, y: 128, width: 512, height: 256 }), {
    artwork: { width: 32, height: 16 }, canvas: { width: 32, height: 16 },
  });
  assert.equal(getArtworkDimensionsInUnits('<svg/>', { x: 128, y: 128, width: 256, height: 256 }), null);
});
