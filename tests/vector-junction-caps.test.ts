import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import paper from 'paper';
import { Window } from 'happy-dom';
import { vectorJunctionCaps } from '../lib/vector-junction-caps.ts';
import { createVectorShape, exportVectorSvg, importVectorSvg, renderedPathData } from '../lib/vector-editor-geometry.ts';
import { updateSvgStrokeWidth, sanitizeSvg, DEFAULT_STANDARDS, analyzeSvg } from '../lib/icon-engine.ts';
import { paintedVectorBounds, fitVectorToGrid } from '../lib/vector-grid-fit.ts';
const window = new Window();
Object.assign(globalThis, { window, DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
Object.assign(window, { paper });
const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
beforeEach(() => scope.activate());
const line = (d: string) => createVectorShape(d, { stroke: '#171717', strokeWidth: 1, fill: 'none', lineCap: 'round', lineJoin: 'round' });
const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
const caps = (svg: string) => parse(svg).querySelectorAll('[data-iconify-junction-cap="1"]');

test('only the contacting end becomes square; the other end stays round', () => {
  const stem = line('M12 4V12'), bar = line('M5 12H19');
  const derived = vectorJunctionCaps(scope, [stem, bar]);
  assert.equal(derived.length, 1);
  assert.equal(derived[0].shapeId, stem.id);
  assert.match(derived[0].d, /L12 12$/);
  const svg = exportVectorSvg({ width: 24, height: 24, shapes: [stem, bar] }, scope);
  assert.equal(caps(svg).length, 1);
  const sources = parse(svg).querySelectorAll('path:not([data-iconify-junction-cap])');
  assert.equal(sources[0].getAttribute('stroke-linecap'), 'round');
  assert.equal(sources[0].getAttribute('d'), stem.d);
});

test('separate contours in one editable path join without creating editor layers', () => {
  const shape = line('M12 4V12 M5 12H19');
  let svg = exportVectorSvg({ width: 24, height: 24, shapes: [shape] }, scope);
  for (let iteration = 0; iteration < 4; iteration++) {
    const imported = importVectorSvg(scope, sanitizeSvg(svg));
    assert.equal(imported.shapes.length, 1);
    svg = exportVectorSvg(imported, scope);
    assert.equal(caps(svg).length, 1);
  }
});

test('nearby parallel lines and real gaps are not mistaken for junctions', () => {
  assert.equal(vectorJunctionCaps(scope, [line('M4 4H12'), line('M4 4.4H12')]).length, 0);
  assert.equal(vectorJunctionCaps(scope, [line('M12 4V11'), line('M5 12H19')]).length, 0);
  assert.equal(vectorJunctionCaps(scope, [line('M4 4H12'), line('M12 4H19')]).length, 0);
});

test('live width changes recompute contact and do not rewrite editable geometry', () => {
  const shapes = [line('M12 4V11.25'), line('M5 12H19')];
  const source = exportVectorSvg({ width: 24, height: 24, shapes }, scope);
  assert.equal(caps(source).length, 0);
  const thick = updateSvgStrokeWidth(source, 2);
  assert.equal(caps(thick).length, 1);
  assert.equal(caps(thick)[0].getAttribute('stroke-width'), '2');
  assert.equal(parse(thick).querySelector('path')!.getAttribute('d'), shapes[0].d);
  const thin = updateSvgStrokeWidth(thick, .5);
  assert.equal(caps(thin).length, 0);
  assert.deepEqual(importVectorSvg(scope, thin).shapes.map(shape => shape.strokeWidth), [.5, .5]);
});

test('rounded isometric corner contact is measured against visible curves', () => {
  const rim = { ...line('M4 8L12 3L20 8L12 13Z'), cornerRadius: 1 };
  const stem = line('M12 13V21');
  const shapes = [rim, stem];
  const rendered = shapes.map(shape => ({ ...shape, d: renderedPathData(scope, shape) }));
  const patches = vectorJunctionCaps(scope, rendered);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].shapeId, stem.id);
  const fit = fitVectorToGrid(scope, { width: 24, height: 24, shapes }, { ...DEFAULT_STANDARDS, strokeWidth: 1, gridSize: 24, padding: 2 });
  const bounds = paintedVectorBounds(scope, fit.shapes)!;
  assert.ok(Math.max(bounds.width, bounds.height) <= 20.001);
  assert.equal(caps(exportVectorSvg(fit, scope)).length, 1);
});

test('intentional dashed and transparent strokes retain their appearance', () => {
  const bar = line('M5 12H19');
  for (const stem of [{ ...line('M12 4V12'), opacity: .5 }, { ...line('M12 4V12'), dashArray: '1 1' }, { ...line('M12 4V12'), stroke: 'rgba(0,0,0,.5)' }]) {
    assert.equal(vectorJunctionCaps(scope, [stem, bar]).length, 0);
  }
});

test('derived square caps survive sanitization and are not mixed-corner violations', () => {
  const svg = exportVectorSvg({ width: 24, height: 24, shapes: [line('M12 4V12'), line('M5 12H19')] }, scope);
  assert.equal(caps(sanitizeSvg(svg)).length, 1);
  assert.ok(!analyzeSvg(svg, { ...DEFAULT_STANDARDS, strokeWidth: 1 }).issues.some(issue => issue.label === 'Mixed corner treatment'));
  assert.throws(() => sanitizeSvg(svg.replace('data-iconify-junction-cap="1"', 'data-iconify-junction-cap="2"')), /metadata/);
});
