import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import paper from 'paper';
import { Window } from 'happy-dom';
import type { Standards } from '../lib/icon-types';
const { DEFAULT_STANDARDS, createDemoCandidates }: typeof import('../lib/icon-engine') = await import(new URL('../lib/icon-engine.ts', import.meta.url).href);
const { fitVectorToGrid, paintedVectorBounds }: typeof import('../lib/vector-grid-fit') = await import(new URL('../lib/vector-grid-fit.ts', import.meta.url).href);
const { createVectorShape, importVectorSvg, exportVectorSvg, shapeBounds, shapeAnchors }: typeof import('../lib/vector-editor-geometry') = await import(new URL('../lib/vector-editor-geometry.ts', import.meta.url).href);
const { fitSvgToGrid }: typeof import('../lib/fit-icon-to-grid') = await import(new URL('../lib/fit-icon-to-grid.ts', import.meta.url).href);
const { applyEditableCorners }: typeof import('../lib/editable-corners') = await import(new URL('../lib/editable-corners.ts', import.meta.url).href);
const window = new Window();
Object.assign(globalThis, { window, DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
Object.assign(window, { paper });
const standards: Standards = { ...DEFAULT_STANDARDS, strokeWidth: 1, padding: 2, constructionGrid: 'keyline' };
const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
beforeEach(() => scope.activate());
const square = () => createVectorShape('M6 6H18V18H6Z', { fill: 'none', stroke: '#171717', strokeWidth: 1, cornerRadius: 1, lineJoin: 'miter', miterLimit: 4 });
const approx = (actual: number, expected: number, tolerance = .002) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);

test('miniature artwork fills the painted keyline while stroke and editable radius stay in native units', () => {
  const source = { width: 24, height: 24, shapes: [square()] }, before = JSON.stringify(source);
  const fitted = fitVectorToGrid(scope, source, standards);
  const bounds = paintedVectorBounds(scope, fitted.shapes)!;
  approx(bounds.x, 2); approx(bounds.y, 2); approx(bounds.width, 20); approx(bounds.height, 20);
  assert.equal(fitted.shapes[0].strokeWidth, 1);
  assert.equal(fitted.shapes[0].cornerRadius, 1);
  assert.equal(shapeAnchors(scope, fitted.shapes[0]).length, 4);
  approx(shapeBounds(scope, fitted.shapes[0]).width, 19);
  assert.equal(JSON.stringify(source), before);
  const svg = exportVectorSvg(fitted, scope);
  assert.match(svg, /width="24" height="24" viewBox="0 0 24 24"/);
  assert.match(svg, /stroke-width="1"/);
  assert.match(svg, /data-iconify-corner-radius="1"/);
  assert.match(svg, /data-iconify-base-path=/);
  assert.doesNotMatch(svg, /transform=/);
});

test('optical padding and construction references define the actual available painted size', () => {
  for (const settings of [
    { ...standards, artworkFit: 'padding' as const, padding: 3, extent: 18 },
    { ...standards, padding: 6, extent: 20 },
    { ...standards, artworkFit: 'padding' as const, padding: 6, extent: 12 },
    { ...standards, padding: 0, extent: 20 },
    { ...standards, constructionGrid: 'concentric' as const, padding: 0, extent: 20 },
    { ...standards, constructionGrid: 'none' as const, padding: 0, extent: 24 },
  ]) {
    const result = fitVectorToGrid(scope, { width: 24, height: 24, shapes: [square()] }, settings);
    const bounds = paintedVectorBounds(scope, result.shapes)!;
    approx(bounds.width, settings.extent); approx(bounds.height, settings.extent);
    approx(bounds.x, (24 - settings.extent) / 2);
  }
});

test('solid and natural rectangular artwork keeps its proportions and transparent cutouts', () => {
  const filled = createVectorShape('M6 9H18V15H6Z M9 11V13H15V11Z', { fill: '#171717', stroke: 'none', fillRule: 'evenodd', cornerRadius: 0 });
  const result = fitVectorToGrid(scope, { width: 24, height: 24, shapes: [filled] }, { ...standards, style: 'filled', proportion: 'natural' });
  const bounds = paintedVectorBounds(scope, result.shapes)!;
  approx(bounds.width, 20); approx(bounds.height, 10); approx(bounds.x, 2); approx(bounds.y, 7);
  assert.equal(result.shapes[0].stroke, 'none');
  assert.equal(result.shapes[0].fillRule, 'evenodd');
  assert.equal(shapeAnchors(scope, result.shapes[0]).length, 8);
  const outlined = createVectorShape('M6 9H18V15H6Z', { strokeWidth: 1, cornerRadius: 0 });
  const outline = fitVectorToGrid(scope, { width: 24, height: 24, shapes: [outlined] }, standards);
  const geometry = shapeBounds(scope, outline.shapes[0]);
  approx(geometry.width / geometry.height, 2, .00001);
  approx(paintedVectorBounds(scope, outline.shapes)!.width, 20);
});

test('fitting ignores hidden geometry while retaining it and all paint roles', () => {
  const hidden = [
    createVectorShape('M-500 -500H500V500H-500Z', { opacity: 0 }),
    createVectorShape('M-900 -900H900V900H-900Z', { fill: 'rgba(0,0,0,0)', stroke: 'transparent' }),
    createVectorShape('M-300 -300H300V300H-300Z', { fill: 'none', stroke: '#000', strokeWidth: 0 }),
  ];
  const fitted = fitVectorToGrid(scope, { width: 24, height: 24, shapes: [square(), ...hidden] }, standards);
  assert.equal(fitted.shapes.length, 4);
  approx(paintedVectorBounds(scope, fitted.shapes)!.width, 20);
  assert.equal(fitted.shapes[1].opacity, 0);
  assert.equal(fitted.shapes[3].strokeWidth, 0);
  assert.throws(() => fitVectorToGrid(scope, { width: 24, height: 24, shapes: hidden }, standards), /no visible artwork/);
});

test('stroke bounds include square caps and sharp miters instead of merely expanding the path box', () => {
  const pointed = createVectorShape('M7 17L12 7L17 17', { strokeWidth: 1, lineCap: 'square', lineJoin: 'miter', miterLimit: 8 });
  const result = fitVectorToGrid(scope, { width: 24, height: 24, shapes: [pointed] }, standards);
  const bounds = paintedVectorBounds(scope, result.shapes)!;
  approx(Math.max(bounds.width, bounds.height), 20);
  assert.ok(bounds.x >= 2 - .001 && bounds.y >= 2 - .001 && bounds.x + bounds.width <= 22 + .001 && bounds.y + bounds.height <= 22 + .001);
  assert.equal(result.shapes[0].strokeWidth, 1);
  assert.equal(result.shapes[0].lineCap, 'square');
  assert.equal(result.shapes[0].miterLimit, 8);
});

test('fitting is idempotent after an SVG round trip and repeated canvas changes keep exact strokes and radii', () => {
  const once = fitVectorToGrid(scope, { width: 24, height: 24, shapes: [square()] }, standards);
  assert.deepEqual(fitVectorToGrid(scope, once, standards), once);
  const svg = exportVectorSvg(once, scope);
  const reopened = importVectorSvg(scope, svg);
  const refitted = fitVectorToGrid(scope, reopened, standards);
  assert.deepEqual(refitted, reopened);
  assert.equal(new DOMParser().parseFromString(exportVectorSvg(refitted, scope), 'image/svg+xml').querySelector('path')!.getAttribute('d'), new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('path')!.getAttribute('d'));
  let current = once;
  for (const gridSize of [48, 16, 32, 24]) {
    current = fitVectorToGrid(scope, current, { ...standards, gridSize });
    assert.equal(current.width, gridSize); assert.equal(current.height, gridSize);
    assert.equal(current.shapes[0].strokeWidth, 1); assert.equal(current.shapes[0].cornerRadius, 1);
    const extent = gridSize * 20 / 24;
    approx(paintedVectorBounds(scope, current.shapes)!.width, extent);
  }
  approx(paintedVectorBounds(scope, current.shapes)!.width, 20);
});

test('existing transformed artwork retains its own effective corner radius through the async fit', async () => {
  const svg = '<svg viewBox="0 0 48 48" width="48" height="48"><g transform="translate(6 6) scale(2)"><path d="M6 6H18V18H6Z" data-iconify-base-path="M6 6H18V18H6Z" data-iconify-corner-radius=".75" fill="none" stroke="#171717" stroke-width=".5"/></g></svg>';
  const fitted = await fitSvgToGrid(svg, { ...standards, cornerRadius: 4 });
  scope.activate();
  const doc = importVectorSvg(scope, fitted);
  approx(paintedVectorBounds(scope, doc.shapes)!.width, 20);
  assert.equal(doc.shapes[0].cornerRadius, 1.5, 'existing radius remains 1.5 even when next-generation radius is 4');
  assert.equal(doc.shapes[0].strokeWidth, 1);
  assert.equal(doc.width, 24);
  assert.doesNotMatch(fitted, /transform=/);
  assert.equal(await fitSvgToGrid(fitted, standards), fitted);
});

test('new generation applies the requested corners before fitting the painted result', async () => {
  const raw = '<svg viewBox="0 0 24 24" fill="none" stroke="#171717" stroke-width=".5"><path d="M6 6H18V18H6Z"/></svg>';
  const fitted = await applyEditableCorners(raw, { ...standards, artworkFit: 'padding', padding: 3, cornerRadius: 2 });
  scope.activate();
  const doc = importVectorSvg(scope, fitted);
  approx(paintedVectorBounds(scope, doc.shapes)!.width, 18);
  assert.equal(doc.shapes[0].cornerRadius, 2);
  assert.equal(doc.shapes[0].strokeWidth, 1);
});

test('existing baked rectangle rounding keeps its original absolute radius when it can be recovered', async () => {
  const raw = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.25" fill="none" stroke="#171717" stroke-width="1"/></svg>';
  const fitted = await fitSvgToGrid(raw, { ...standards, cornerRadius: 4 });
  scope.activate();
  const doc = importVectorSvg(scope, fitted);
  assert.equal(doc.shapes[0].cornerRadius, 1.25);
  approx(paintedVectorBounds(scope, doc.shapes)!.width, 20);
});

test('intrinsic circular curves and miter transitions remain fit-able without becoming sharp corner candidates', async () => {
  for (const [gridSize, style, brief, index] of [
    [16, 'filled', 'search', 0], [48, 'line', 'search', 2],
    [24, 'filled', 'collection', 7], [24, 'filled', 'collection', 5], [24, 'combined', 'collection', 5],
  ] as const) {
    const settings = { ...standards, gridSize, style };
    const candidate = createDemoCandidates(brief, settings, 8)[index];
    const fitted = await applyEditableCorners(candidate.svg, settings);
    assert.match(fitted, /data-iconify-base-path=/);
    const paths = Array.from(new DOMParser().parseFromString(fitted, 'image/svg+xml').querySelectorAll('path'));
    for (const path of paths.filter(path => path.getAttribute('stroke') !== 'none')) assert.equal(path.getAttribute('stroke-width'), '1');
  }
});

test('unsupported originals and impossible settings fail without rewriting the input', async () => {
  const source = '<svg viewBox="0 0 24 24"><defs><mask id="cut"><rect width="24" height="24" fill="white"/></mask></defs><path d="M6 6H18V18H6Z" mask="url(#cut)"/></svg>';
  await assert.rejects(fitSvgToGrid(source, standards), /cannot yet edit/);
  scope.activate();
  assert.throws(() => fitVectorToGrid(scope, { width: 24, height: 24, shapes: [square()] }, { ...standards, gridSize: 24.5 }), /valid canvas grid/);
  assert.throws(() => fitVectorToGrid(scope, { width: 24, height: 24, shapes: [square()] }, { ...standards, artworkFit: 'padding', strokeWidth: 4, padding: 11 }), /cannot fit/);
});

// Both existing saved designs and new AI results must use the selected guide,
// even when an older workspace carries a large optical-padding value.
test('saved padding cannot shrink existing or newly redesigned isometric artwork in keyline mode', async () => {
  const raw = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#252331" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 10L12 6.5L17.5 10V15L12 18L6.5 15Z M6.5 10L12 13L17.5 10 M12 13V18 M8 12L10 13 M8 14L10 15"/></svg>';
  const legacy = { ...standards, perspective: 'isometric' as const, padding: 6 };
  for (const fit of [fitSvgToGrid, applyEditableCorners]) {
    const output = await fit(raw, legacy);
    scope.activate();
    const doc = importVectorSvg(scope, output);
    const bounds = paintedVectorBounds(scope, doc.shapes)!;
    approx(Math.max(bounds.width, bounds.height), 20);
    assert.ok(bounds.width > 18 && bounds.height > 18);
    assert.equal(doc.shapes[0].strokeWidth, 1);
    assert.equal(doc.width, 24);
    assert.doesNotMatch(output, /transform=/);
  }
});
