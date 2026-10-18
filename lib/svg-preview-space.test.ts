import assert from 'node:assert/strict';
import test from 'node:test';
const { getSvgCanvas, getSvgPreviewSpace }: typeof import('./svg-preview-space') = await import(new URL('./svg-preview-space.ts', import.meta.url).href);

test('preview cells follow the document canvas even when its export pixel size differs', () => {
  const svg = '<svg width="240" height="240" viewBox="0 0 24 24"><path stroke-width="1"/></svg>';
  assert.deepEqual(getSvgCanvas(svg), { x: 0, y: 0, width: 24, height: 24 });
  assert.deepEqual(getSvgPreviewSpace(svg)?.viewport, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(getSvgCanvas(svg.replace('0 0 24 24', '0 0 48 48')), { x: 0, y: 0, width: 48, height: 48 });
});

test('offset rectangular sources keep their document coordinates and contained viewport', () => {
  const space = getSvgPreviewSpace("<svg viewBox='-6, 4, 48, 24'></svg>");
  assert.deepEqual(space, {
    canvas: { x: -6, y: 4, width: 48, height: 24 },
    preserveAspectRatio: 'xMidYMid meet',
    viewport: { x: 0, y: .25, width: 1, height: .5 },
  });
});

test('guide viewport matches source dimensions and its aspect-ratio policy', () => {
  const space = getSvgPreviewSpace('<svg width="24px" height="48px" viewBox="0 0 24 24" preserveAspectRatio="xMinYMin meet"/>');
  assert.deepEqual(space?.canvas, { x: 0, y: 0, width: 24, height: 24 });
  assert.deepEqual(space?.viewport, { x: .25, y: 0, width: .5, height: 1 });
  assert.equal(space?.preserveAspectRatio, 'xMinYMin meet');
});

test('SVGs without a viewBox use numeric dimensions and reject unknown canvas sizes', () => {
  assert.deepEqual(getSvgCanvas('<svg width="3.2e1" height="16px"/>'), { x: 0, y: 0, width: 32, height: 16 });
  for (const svg of ['<svg/>', '<svg width="100%" height="100%"/>', '<svg viewBox="0 0 0 24"/>', '<svg viewBox="0 0 Infinity 24"/>']) {
    assert.equal(getSvgPreviewSpace(svg), null);
  }
});

test('nested SVG metadata cannot replace the root canvas', () => {
  assert.deepEqual(getSvgCanvas('<svg aria-label="Preview > icon" viewBox="0 0 24 24"><svg viewBox="0 0 48 48"/></svg>'), { x: 0, y: 0, width: 24, height: 24 });
});
