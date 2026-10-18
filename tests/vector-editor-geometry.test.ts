import assert from "node:assert/strict";
import test from "node:test";
import paper from "paper";
import { Window } from "happy-dom";
const vector: typeof import("../lib/vector-editor-geometry") = await import(new URL("../lib/vector-editor-geometry.ts", import.meta.url).href);
const { addAnchor, appendPenPoint, changeAnchor, closeShape, combineShapes, createVectorShape, exportVectorSvg, importVectorSvg, moveAnchor, paperItem, shapeAnchors, shapeBounds, translateShape } = vector;
const window = new Window();
globalThis.DOMParser = window.DOMParser as unknown as typeof DOMParser;
const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
const shape = (d: string) => createVectorShape(d, { fill: "#000000", stroke: "none" });
const left = () => shape("M2 2H12V12H2Z");
const right = () => shape("M7 7H17V17H7Z");
function area(d: string) { const item = paperItem(scope, { d }); const value = Math.abs((item as paper.Path | paper.CompoundPath).area); item.remove(); return value; }
function approx(a: number, b: number, delta = .00001) { assert.ok(Math.abs(a - b) < delta, `${a} ≠ ${b}`); }

test("live corner radii round visible geometry while keeping four sharp editable anchors", () => {
  const source = { ...shape("M2 2H22V22H2Z"), cornerRadius: 2 };
  const before = JSON.stringify(source), rounded = vector.renderedPathData(scope, source);
  assert.match(rounded, /[cC]/);
  assert.equal(shapeAnchors(scope, source).length, 4);
  assert.equal(shapeAnchors(scope, { ...source, d: rounded }).length, 8);
  approx(area(rounded), 400 - 4 * (4 - Math.PI), .005);
  assert.equal(JSON.stringify(source), before);
  assert.equal(vector.renderedPathData(scope, { ...source, cornerRadius: 0 }), source.d);
  const moved = moveAnchor(scope, source, 0, 1, "point", { x: 20, y: 2 });
  assert.equal(moved.cornerRadius, 2);
  assert.notEqual(vector.renderedPathData(scope, moved), rounded);
});

test("live corners preserve open endpoints and use tangents for non-right angles", () => {
  const source = { ...shape("M0 0L10 0L20 10"), cornerRadius: 2 };
  const anchors = shapeAnchors(scope, { ...source, d: vector.renderedPathData(scope, source) });
  assert.equal(anchors.length, 4);
  assert.deepEqual(anchors[0].point, { x: 0, y: 0 });
  approx(anchors[3].point.x, 20, .00002); approx(anchors[3].point.y, 10);
  approx(anchors[1].point.x, 10 - 2 * Math.tan(Math.PI / 8));
  approx(anchors[1].point.y, 0);
  approx(anchors[2].point.x, 10 + 2 * Math.tan(Math.PI / 8) / Math.sqrt(2));
  approx(anchors[2].point.y, 2 * Math.tan(Math.PI / 8) / Math.sqrt(2));
  assert.equal(anchors[1].handleOut.y, 0);
  approx(anchors[2].handleIn.x, anchors[2].handleIn.y);
});

test("large radii clamp to short adjacent edges without collapsing or crossing corners", () => {
  const source = { ...shape("M0 0H2V1H0Z"), cornerRadius: 100 };
  const d = vector.renderedPathData(scope, source), rendered = { ...source, d };
  const anchors = shapeAnchors(scope, rendered);
  assert.ok(anchors.every(({ point }) => point.x >= 0 && point.x <= 2 && point.y >= 0 && point.y <= 1));
  assert.deepEqual(shapeBounds(scope, rendered), { x: 0, y: 0, width: 2, height: 1 });
  approx(area(d), 2 - (4 - Math.PI) * .25, .001);
  assert.equal(source.cornerRadius, 100);
});

test("compound contours and concave joins retain holes, while organic curves stay unchanged", () => {
  const source = { ...shape("M0 0H20V20H10V10H0Z M12 3H18V7H12Z"), cornerRadius: 1, fillRule: "evenodd" as const };
  const d = vector.renderedPathData(scope, source);
  const anchors = shapeAnchors(scope, { ...source, d });
  assert.equal(anchors.filter((anchor) => anchor.index === 0).length, 2);
  assert.equal(anchors.length, 20);
  const organic = { ...shape("M0 0C2 9 12 2 14 12"), cornerRadius: 4 };
  const normalized = paperItem(scope, organic);
  assert.equal(vector.renderedPathData(scope, organic), normalized.pathData);
  normalized.remove();
  const item = paperItem(scope, { ...source, d });
  assert.equal(item.fillRule, "evenodd"); item.remove();
});

test("SVG exports actual fillets and safely reopens their editable sharp geometry", () => {
  const source = { ...shape("M2 2H22V22H2Z M8 8H16V16H8Z"), cornerRadius: 1.5, fillRule: "evenodd" as const };
  const svg = exportVectorSvg({ width: 24, height: 24, shapes: [source] }, scope);
  assert.match(svg, /data-iconify-corner-radius="1.5"/);
  const xml = new DOMParser().parseFromString(svg, "image/svg+xml"), exported = xml.querySelector("path")!;
  assert.match(exported.getAttribute("d")!, /[cC]/);
  assert.equal(exported.getAttribute("data-iconify-base-path"), source.d);
  const reopened = importVectorSvg(scope, svg).shapes[0];
  assert.equal(reopened.cornerRadius, 1.5);
  assert.equal(shapeAnchors(scope, reopened).length, 8);
  assert.equal(reopened.fillRule, "evenodd");
  approx(area(vector.renderedPathData(scope, reopened)), area(vector.renderedPathData(scope, source)));
  assert.throws(() => exportVectorSvg({ width: 24, height: 24, shapes: [source] }), /geometry scope/);
  const sharp = { ...reopened, cornerRadius: 0 };
  assert.equal(shapeAnchors(scope, importVectorSvg(scope, exportVectorSvg({ width: 24, height: 24, shapes: [sharp] }, scope)).shapes[0]).length, 8);
});

test("editable corner metadata validates radius and coordinates and scales uniformly on import", () => {
  const svg = exportVectorSvg({ width: 24, height: 24, shapes: [{ ...left(), cornerRadius: 1 }] }, scope);
  const transformed = svg.replace("<path ", '<path transform="translate(2 3) scale(2)" ');
  const imported = importVectorSvg(scope, transformed).shapes[0];
  assert.equal(imported.cornerRadius, 2);
  assert.deepEqual(shapeBounds(scope, imported), { x: 6, y: 7, width: 20, height: 20 });
  for (const invalid of [svg.replace('corner-radius="1"', 'corner-radius="-1"'), svg.replace('corner-radius="1"', 'corner-radius="1e100"'), svg.replace(/data-iconify-base-path="[^"]*"/, 'data-iconify-base-path="M1e300 0L4 4"')]) assert.throws(() => importVectorSvg(scope, invalid), /corner/);
});

test("transforms keep live radius in pixel units while pathfinder operates on visible fillets", () => {
  const source = { ...shape("M0 0H10V10H0Z"), cornerRadius: 2 };
  const moved = translateShape(scope, source, { x: 2, y: 3 });
  assert.equal(moved.cornerRadius, 2);
  assert.equal(vector.rotateShape(scope, source, 90).cornerRadius, 2);
  assert.equal(vector.resizeShape(scope, source, { x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 20, height: 20 }).cornerRadius, 2);
  const trimmedCorner = shape("M0 0H0.5V0.5H0Z");
  assert.throws(() => combineShapes(scope, [source, trimmedCorner], "intersect"), /empty shape/);
  const union = combineShapes(scope, [source, shape("M5 0H15V10H5Z")], "unite");
  assert.equal(union.cornerRadius, undefined);
  assert.match(union.d, /[cC]/);
  const pieces = vector.divideShapes(scope, [source, shape("M5 0H15V10H5Z")]);
  assert.ok(pieces.every((piece) => piece.cornerRadius === undefined));
  const compound = vector.makeCompoundShape(scope, [source, shape("M20 20H22V22H20Z")]);
  assert.equal(compound.cornerRadius, undefined); assert.match(compound.d, /[cC]/);
});

test("existing circular corner curves can recover their sharp skeleton reversibly", () => {
  const base = { ...shape("M2 2H22V22H2Z"), cornerRadius: 2 };
  const baked = { ...base, d: vector.renderedPathData(scope, base), cornerRadius: undefined };
  const recovered = vector.recoverEditableCorners(scope, baked);
  approx(recovered.cornerRadius!, 2);
  assert.equal(shapeAnchors(scope, recovered).length, 4);
  approx(area(vector.renderedPathData(scope, recovered)), area(baked.d), .001);
  approx(area(vector.renderedPathData(scope, { ...recovered, cornerRadius: 0 })), 400);
  const organic = shape("M0 0L2 3C4 8 10 8 12 3L20 0");
  assert.equal(vector.recoverEditableCorners(scope, organic), organic);
});

test("corner recovery leaves different baked radii intact instead of approximating artwork", () => {
  const a = { ...shape("M0 0H10V10H0Z"), cornerRadius: 1 };
  const b = { ...shape("M12 0H22V10H12Z"), cornerRadius: 2 };
  const baked = shape(`${vector.renderedPathData(scope, a)} ${vector.renderedPathData(scope, b)}`);
  assert.equal(vector.recoverEditableCorners(scope, baked), baked);
});

test("corner recovery preserves open endpoints and semantic curves in other contours", () => {
  const source = { ...shape("M2 2H12V12 M1 16C4 20 8 13 12 17"), cornerRadius: 1 };
  const baked = { ...source, d: vector.renderedPathData(scope, source), cornerRadius: undefined };
  const recovered = vector.recoverEditableCorners(scope, baked);
  approx(recovered.cornerRadius!, 1);
  const anchors = shapeAnchors(scope, recovered);
  assert.equal(anchors.length, 5);
  assert.deepEqual(anchors[0].point, { x: 2, y: 2 });
  assert.deepEqual(anchors[2].point, { x: 12, y: 12 });
  assert.deepEqual(anchors[3].handleOut, { x: 3, y: 4 });
  const dashed = { ...baked, dashArray: "1 2" };
  assert.equal(vector.recoverEditableCorners(scope, dashed), dashed);
});

test("non-uniform scale and shear retain baked visible corners on import", () => {
  const source = { ...left(), cornerRadius: 2 };
  const svg = exportVectorSvg({ width: 24, height: 24, shapes: [source] }, scope);
  for (const transform of ["scale(2 1)", "skewX(30)"]) {
    const transformed = svg.replace("<path ", `<path transform="${transform}" `);
    const imported = importVectorSvg(scope, transformed).shapes[0];
    assert.equal(imported.cornerRadius, undefined);
    assert.equal(shapeAnchors(scope, imported).length, 8);
    assert.match(imported.d, /[cC]/);
  }
});

test("explicit radius edits recover mixed sharp and circular corners without altering semantic curves", () => {
  const mixed = shape("M0 2C0 .89543 .89543 0 2 0H10V10H0Z M12 0C14 8 18 8 20 0");
  assert.equal(vector.recoverEditableCorners(scope, mixed), mixed);
  const recovered = vector.recoverEditableCorners(scope, mixed, { preserveAppearance: false });
  approx(recovered.cornerRadius!, 2, .0001);
  const sharp = { ...recovered, cornerRadius: 0 }, anchors = shapeAnchors(scope, sharp);
  assert.equal(anchors.filter((anchor) => anchor.contour === 0).length, 4);
  assert.ok(anchors.filter((anchor) => anchor.contour === 0).every((anchor) => anchor.handleIn.x === 0 && anchor.handleIn.y === 0 && anchor.handleOut.x === 0 && anchor.handleOut.y === 0));
  assert.deepEqual(anchors.find((anchor) => anchor.contour === 1)!.handleOut, { x: 2, y: 8 });
  assert.match(vector.renderedPathData(scope, sharp), /[cC]/);
  const a = { ...left(), cornerRadius: 1 }, b = { ...right(), cornerRadius: 2 };
  const multiple = shape(`${vector.renderedPathData(scope, a)} ${vector.renderedPathData(scope, b)}`);
  const unified = vector.recoverEditableCorners(scope, multiple, { preserveAppearance: false });
  assert.equal(shapeAnchors(scope, unified).length, 8);
  assert.doesNotMatch(vector.renderedPathData(scope, { ...unified, cornerRadius: 0 }), /[cC]/);
});

test("boolean unite, subtract, intersection and XOR compute real vector areas", () => {
  approx(area(combineShapes(scope, [left(), right()], "unite").d), 175);
  approx(area(combineShapes(scope, [left(), right()], "subtract").d), 75);
  approx(area(combineShapes(scope, [left(), right()], "intersect").d), 25);
  approx(area(combineShapes(scope, [left(), right()], "exclude").d), 150);
});

test("subtract removes front geometry from back and preserves a hole", () => {
  const back = shape("M0 0H20V20H0Z"), front = shape("M5 5H15V15H5Z");
  const result = combineShapes(scope, [back, front], "subtract");
  approx(area(result.d), 300);
  assert.equal(shapeAnchors(scope, result).filter((p) => p.index === 0).length, 2);
  assert.throws(() => combineShapes(scope, [front, back], "subtract"), /empty shape/);
});

test("booleans reject open or empty geometry without mutating inputs", () => {
  const a = left(), b = shape("M1 1L8 4L5 6"); const before = JSON.stringify([a, b]);
  assert.throws(() => combineShapes(scope, [a, b], "unite"), /closed paths/);
  assert.throws(() => combineShapes(scope, [a], "unite"), /at least two/);
  assert.throws(() => combineShapes(scope, [a, shape("M20 20H23V23H20Z")], "intersect"), /empty shape/);
  assert.equal(JSON.stringify([a, b]), before);
});

test("closed paths and multiple boolean operands work", () => {
  const open = shape("M0 0L4 0L4 4L0 4");
  const closed = closeShape(scope, open);
  assert.equal(shapeAnchors(scope, closed)[0].closed, true);
  approx(area(combineShapes(scope, [closed, shape("M4 0H8V4H4Z"), shape("M8 0H12V4H8Z")], "unite").d), 48);
});

test("basic SVG import converts shapes, inherited style, viewBox offset and nested transforms", () => {
  const doc = importVectorSvg(scope, '<svg viewBox="10 20 24 24" fill="none" stroke="currentColor" color="#123456" stroke-width="2"><g transform="translate(11 21)"><rect width="4" height="6"/><circle cx="10" cy="10" r="2"/></g></svg>');
  assert.equal(doc.width, 24); assert.equal(doc.shapes.length, 2);
  assert.equal(doc.shapes[0].stroke, "#123456"); assert.equal(doc.shapes[0].fill, "none"); assert.equal(doc.shapes[0].strokeWidth, 2);
  const bounds = shapeBounds(scope, doc.shapes[0]);
  approx(bounds.x, 1); approx(bounds.y, 1); approx(bounds.width, 4); approx(bounds.height, 6);
});

test("uniform transform applies to geometry and stroke weight", () => {
  const doc = importVectorSvg(scope, '<svg viewBox="0 0 24 24"><g transform="translate(2 3) scale(2)"><path d="M0 0H4V4H0Z" stroke="black" stroke-width="1"/></g></svg>');
  const bounds = shapeBounds(scope, doc.shapes[0]); approx(bounds.x, 2); approx(bounds.y, 3); approx(bounds.width, 8);
  approx(doc.shapes[0].strokeWidth, 2);
  assert.throws(() => importVectorSvg(scope, '<svg viewBox="0 0 24 24"><path d="M0 0L4 4" stroke="black" transform="scale(2 1)"/></svg>'), /non-uniformly/);
});

test("SVG export retains editable geometry, closed holes, opacity, styles, dimensions and roundtrips", () => {
  const doc = importVectorSvg(scope, '<svg viewBox="0 0 32 24" fill="#aabbcc"><path d="M2 2H20V20H2Z M5 5V15H15V5Z" fill-rule="evenodd" opacity="0.5" stroke="#123456" stroke-width="1.25" stroke-linejoin="bevel"/></svg>');
  const svg = exportVectorSvg(doc); const roundtrip = importVectorSvg(scope, svg);
  assert.match(svg, /viewBox="0 0 32 24"/); assert.match(svg, /fill-rule="evenodd"/);
  assert.equal(roundtrip.shapes[0].fill, "#aabbcc"); assert.equal(roundtrip.shapes[0].lineJoin, "bevel"); assert.equal(roundtrip.shapes[0].opacity, .5);
  assert.equal(shapeAnchors(scope, roundtrip.shapes[0]).length, 8);
  approx(area(roundtrip.shapes[0].d), area(doc.shapes[0].d));
});

test("SVG import refuses unsupported effects and executable content instead of silently dropping them", () => {
  for (const markup of ['<text>Example</text>', '<defs><linearGradient id="x"/></defs>', '<image href="https://example.com/img.png"/>', '<path d="M0 0L4 4" clip-path="url(#x)"/>', '<path d="M0 0L4 4" onclick="alert(1)"/>', '<script>alert(1)</script>']) {
    assert.throws(() => importVectorSvg(scope, `<svg viewBox="0 0 24 24">${markup}</svg>`));
  }
  assert.throws(() => importVectorSvg(scope, '<!DOCTYPE svg><svg/>'));
  assert.throws(() => importVectorSvg(scope, '<svg viewBox="0 0 0 0"><path d="M0 0L1 1"/></svg>'));
});

test("anchor movement retains curves and independently moves handles", () => {
  const original = shape("M2 12C4 2 16 2 18 12");
  const changed = moveAnchor(scope, original, 0, 0, "point", { x: 4, y: 14 });
  const a = shapeAnchors(scope, changed)[0]; approx(a.point.x, 4); approx(a.point.y, 14); approx(a.handleOut.x, 2); approx(a.handleOut.y, -10);
  const linked = moveAnchor(scope, changed, 0, 0, "handleOut", { x: 9, y: 15 }, true);
  const b = shapeAnchors(scope, linked)[0]; approx(b.handleOut.x, 5); approx(b.handleIn.x, -5); approx(b.handleOut.y, 1); approx(b.handleIn.y, -1);
});

test("adding an anchor divides the curve without changing its bounds", () => {
  const original = shape("M2 12C4 2 16 2 18 12"); const before = shapeBounds(scope, original);
  const changed = addAnchor(scope, original, { x: 10, y: 5 }); const after = shapeBounds(scope, changed);
  assert.equal(shapeAnchors(scope, changed).length, 3);
  approx(before.x, after.x); approx(before.y, after.y); approx(before.width, after.width); approx(before.height, after.height);
});

test("corner, remove-anchor, translation and closed compound paths stay editable", () => {
  const original = shape("M2 12C4 2 16 2 18 12");
  const corner = changeAnchor(scope, original, 0, 0, "corner"); approx(shapeAnchors(scope, corner)[0].handleOut.x, 0);
  const square = left(); const translated = translateShape(scope, square, { x: 2, y: -1 });
  const b = shapeBounds(scope, translated); approx(b.x, 4); approx(b.y, 1);
  assert.equal(shapeAnchors(scope, changeAnchor(scope, square, 0, 0, "delete")).length, 3);
});


test("pen drawing retains outgoing handles at an unfinished endpoint", () => {
  const first = createVectorShape("M2 12");
  const curved = moveAnchor(scope, first, 0, 0, "handleOut", { x: 7, y: 2 }, true);
  approx(shapeAnchors(scope, curved)[0].handleOut.x, 5);
  approx(shapeAnchors(scope, curved)[0].handleIn.x, -5);
  const second = appendPenPoint(scope, curved, { x: 18, y: 12 });
  assert.match(second.d, /[cC]/);
  approx(shapeAnchors(scope, second)[0].handleOut.y, -10);
  const withLastHandle = moveAnchor(scope, second, 0, 1, "handleOut", { x: 19, y: 15 }, true);
  const third = appendPenPoint(scope, withLastHandle, { x: 20, y: 20 });
  approx(shapeAnchors(scope, third)[1].handleOut.x, 1);
});

test("paint alpha is preserved on SVG import and export", () => {
  const doc = importVectorSvg(scope, '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="#aabbcc" fill-opacity="0.5"/></svg>');
  assert.equal(doc.shapes[0].fill, "rgba(170,187,204,0.5)");
  assert.match(exportVectorSvg(doc), /rgba\(170,187,204,0.5\)/);
});


test("dashed stroke and miter attributes survive editing and export", () => {
  const doc = importVectorSvg(scope, '<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-dasharray="2 3" stroke-dashoffset="1" stroke-miterlimit="8"><path d="M2 2H20V20"/></svg>');
  assert.equal(doc.shapes[0].dashArray, "2 3");
  assert.match(exportVectorSvg(doc), /stroke-dasharray="2 3"/);
  assert.match(exportVectorSvg(doc), /stroke-dashoffset="1"/);
  assert.match(exportVectorSvg(doc), /stroke-miterlimit="8"/);
});

test("group compositing and nested viewports are rejected before flattening can change them", () => {
  assert.throws(() => importVectorSvg(scope, '<svg viewBox="0 0 24 24"><g opacity="0.5"><rect width="10" height="10"/><rect x="5" y="5" width="10" height="10"/></g></svg>'), /opacity on a group/);
  assert.throws(() => importVectorSvg(scope, '<svg viewBox="0 0 24 24"><svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg></svg>'), /Nested SVG/);
});

test("boolean operations respect even-odd holes regardless of contour winding", () => {
  const donut = createVectorShape("M0 0H20V20H0Z M5 5H15V15H5Z", { fill: "#000", fillRule: "evenodd" });
  const inner = shape("M6 6H14V14H6Z");
  assert.throws(() => combineShapes(scope, [donut, inner], "intersect"), /empty shape/);
});

test("affine transforms move curves and unfinished pen handles without changing paint", () => {
  const source = createVectorShape("M-4 -2C-2 -6 4 3 8 -2", { stroke: "#654321", strokeWidth: 2, opacity: .4, dashArray: "1 2", endpoints: [{ firstIn: { x: -2, y: 3 }, lastOut: { x: 2, y: -3 } }] });
  const moved = vector.transformShape(scope, source, { a: 2, b: 0, c: 0, d: 3, tx: -10, ty: 4 });
  const anchors = shapeAnchors(scope, moved);
  assert.deepEqual(anchors[0].point, { x: -18, y: -2 });
  assert.deepEqual(anchors[0].handleIn, { x: -4, y: 9 });
  assert.deepEqual(anchors[1].handleOut, { x: 4, y: -9 });
  assert.equal(moved.strokeWidth, 2); assert.equal(moved.opacity, .4); assert.equal(moved.stroke, "#654321"); assert.equal(moved.dashArray, "1 2");
  assert.equal(source.d, "M-4 -2C-2 -6 4 3 8 -2");
  assert.throws(() => vector.transformShape(scope, source, { a: NaN, b: 0, c: 0, d: 1, tx: 0, ty: 0 }), /finite/);
});

test("shared selection resizing preserves spacing with negative coordinates and handles straight lines", () => {
  const a = shape("M-8 -4H-4V0H-8Z"), b = shape("M0 0H4V4H0Z");
  const bounds = vector.selectionBounds(scope, [a, b]); assert.deepEqual(bounds, { x: -8, y: -4, width: 12, height: 8 });
  const next = vector.resizeShape(scope, a, bounds!, { x: 10, y: 20, width: 24, height: 24 });
  assert.deepEqual(shapeBounds(scope, next), { x: 10, y: 20, width: 8, height: 12 });
  const line = shape("M-2 -2V8"), lineBounds = shapeBounds(scope, line);
  const scaledLine = vector.resizeShape(scope, line, lineBounds, { x: 4, y: 5, width: 0, height: 20 });
  assert.deepEqual(shapeBounds(scope, scaledLine), { x: 4, y: 5, width: 0, height: 20 });
  assert.equal(vector.selectionBounds(scope, []), null);
});

test("rotation and flips preserve closed geometry and use shared selection centers", () => {
  const source = shape("M-4 -2H2V0H-4Z");
  const rotated = vector.rotateShape(scope, source, 90, { x: 0, y: 0 });
  const b = shapeBounds(scope, rotated); approx(b.x, 0); approx(b.y, -4); approx(b.width, 2); approx(b.height, 6);
  const flipped = vector.flipShape(scope, source, "horizontal", { x: 0, y: 0 });
  assert.deepEqual(shapeBounds(scope, flipped), { x: -2, y: -2, width: 6, height: 2 });
  approx(area(flipped.d), area(source.d));
  assert.equal(shapeAnchors(scope, rotated)[0].closed, true);
});

test("nearest node and curve identify compound contours, enforce hit tolerances and wrap closed endpoints", () => {
  const source = shape("M-10 -10L-4 -10L-4 -4Z M2 12C4 2 16 2 18 12");
  const anchor = vector.nearestAnchor(scope, source, { x: 2.2, y: 12 }, 1)!;
  assert.equal(anchor.contour, 1); assert.equal(anchor.index, 0); approx(anchor.distance, .2);
  assert.equal(vector.nearestAnchor(scope, source, { x: 99, y: 99 }, 1), null);
  const curve = vector.nearestCurve(scope, source, { x: 10, y: 4.5 }, .1)!;
  assert.equal(curve.contour, 1); assert.equal(curve.index, 0); approx(curve.time, .5); approx(curve.distance, 0);
  assert.equal(vector.nearestCurve(scope, source, { x: 99, y: 99 }, 1), null);
  assert.deepEqual(vector.curveAnchorRefs(scope, source, { contour: 0, index: 2 }), [{ contour: 0, index: 2 }, { contour: 0, index: 0 }]);
  assert.deepEqual(vector.curveAnchorRefs(scope, source, { contour: 1, index: 1 }), []);
  const highlight = shape(vector.curvePathData(scope, source, { contour: 1, index: 0 })!);
  assert.equal(shapeAnchors(scope, highlight).length, 2);
  const h = shapeBounds(scope, highlight); approx(h.y, 4.5); approx(h.height, 7.5);
});

test("multi-anchor translation moves each selected endpoint once and retains relative Bézier handles", () => {
  const source = shape("M2 12C4 2 16 2 18 12 M2 20H20");
  const refs = [{ contour: 0, index: 0 }, { contour: 0, index: 1 }, { contour: 0, index: 0 }];
  const moved = vector.translateAnchors(scope, source, refs, { x: -3, y: 2 }), anchors = shapeAnchors(scope, moved);
  assert.deepEqual(anchors[0].point, { x: -1, y: 14 }); assert.deepEqual(anchors[1].point, { x: 15, y: 14 });
  assert.deepEqual(anchors[0].handleOut, { x: 2, y: -10 }); assert.deepEqual(anchors[2].point, { x: 2, y: 20 });
});

test("deleting multiple anchors does not shift targets or leave single-anchor contours", () => {
  const source = shape("M0 0H4V4H0Z M8 8H12V12H8Z");
  const result = vector.deleteAnchors(scope, source, [{ contour: 0, index: 0 }, { contour: 0, index: 1 }, { contour: 0, index: 2 }, { contour: 1, index: 0 }, { contour: 1, index: 0 }]);
  const anchors = shapeAnchors(scope, result); assert.equal(anchors.length, 3);
  assert.deepEqual(anchors.map((a) => a.point), [{ x: 12, y: 8 }, { x: 12, y: 12 }, { x: 8, y: 12 }]);
  const empty = vector.deleteAnchors(scope, left(), [{ contour: 0, index: 0 }, { contour: 0, index: 1 }, { contour: 0, index: 2 }]);
  assert.equal(empty.d, "");
});

test("continuing a compound endpoint reverses only that contour and keeps other contours intact", () => {
  const source = shape("M0 0H4V4H0Z M8 8C10 6 12 10 14 8");
  const continued = vector.continuePenPath(scope, source, { contour: 1, index: 0 });
  const anchors = shapeAnchors(scope, continued);
  assert.deepEqual(anchors[0].point, { x: 14, y: 8 }); assert.deepEqual(anchors[1].point, { x: 8, y: 8 });
  const extended = appendPenPoint(scope, continued, { x: 6, y: 8 });
  const next = shapeAnchors(scope, extended); assert.deepEqual(next[2].point, { x: 6, y: 8 }); assert.equal(next[3].closed, true);
  assert.throws(() => vector.continuePenPath(scope, source, { contour: 0, index: 0 }), /endpoint/);
});

test("splitting closed and open curves preserves all drawn segments and unrelated contours", () => {
  const closed = shape("M0 0H4V4H0Z M10 10H14V14H10Z");
  const cut = vector.splitShapeAtAnchor(scope, closed, { contour: 0, index: 2 }); assert.equal(cut.length, 1);
  const anchors = shapeAnchors(scope, cut[0]); assert.equal(anchors.filter((a) => !a.closed).length, 5); assert.equal(anchors.filter((a) => a.closed).length, 4);
  assert.deepEqual(anchors[0].point, { x: 4, y: 4 }); assert.deepEqual(anchors[4].point, { x: 4, y: 4 });
  const open = shape("M2 12C4 2 8 2 10 12C12 22 16 22 18 12 M2 2H6");
  const parts = vector.splitShapeAtAnchor(scope, open, { contour: 0, index: 1 });
  assert.equal(parts.length, 2); assert.equal(parts[0].id, open.id); assert.notEqual(parts[1].id, open.id);
  assert.equal(shapeAnchors(scope, parts[0]).length, 4); assert.equal(shapeAnchors(scope, parts[1]).length, 2);
  assert.deepEqual(shapeAnchors(scope, parts[0])[1].point, shapeAnchors(scope, parts[1])[0].point);
  const before = shapeBounds(scope, open), after = vector.selectionBounds(scope, parts)!;
  approx(before.x, after.x); approx(before.y, after.y); approx(before.width, after.width); approx(before.height, after.height);
  assert.throws(() => vector.splitShapeAtAnchor(scope, open, { contour: 0, index: 0 }), /interior/);
});

test("joining selected endpoints connects curves, merges touching nodes and retains unrelated contours", () => {
  const first = shape("M0 0C2 -4 4 -4 6 0 M10 10H12"), second = shape("M12 0C10 4 8 4 6 0");
  const joined = vector.joinShapeEndpoints(scope, first, { contour: 0, index: 1 }, second, { contour: 0, index: 1 });
  const anchors = shapeAnchors(scope, joined);
  assert.equal(anchors.length, 5); assert.deepEqual(anchors[1].point, { x: 6, y: 0 });
  assert.deepEqual(anchors[1].handleIn, { x: -2, y: -4 }); assert.deepEqual(anchors[1].handleOut, { x: 2, y: 4 });
  assert.deepEqual(anchors[2].point, { x: 12, y: 0 }); assert.deepEqual(anchors[3].point, { x: 10, y: 10 });
  assert.equal(joined.id, first.id);
  const within = shape("M0 0H4 M8 0H12");
  const merged = vector.joinShapeEndpoints(scope, within, { contour: 0, index: 1 }, within, { contour: 1, index: 0 });
  assert.equal(shapeAnchors(scope, merged).length, 4); assert.equal(shapeAnchors(scope, merged).filter((a) => a.index === 0).length, 1);
});

test("joining both ends closes a contour and invalid joins preserve the original", () => {
  const open = shape("M0 0H4V4H0"), original = JSON.stringify(open);
  const closed = vector.joinShapeEndpoints(scope, open, { contour: 0, index: 0 }, open, { contour: 0, index: 3 });
  assert.equal(shapeAnchors(scope, closed)[0].closed, true); approx(area(closed.d), 16);
  assert.throws(() => vector.joinShapeEndpoints(scope, open, { contour: 0, index: 1 }, open, { contour: 0, index: 3 }), /endpoints/);
  assert.equal(JSON.stringify(open), original);
  const reversed = vector.reverseShape(scope, open);
  assert.deepEqual(shapeAnchors(scope, reversed)[0].point, { x: 0, y: 4 });
});

test("compound paths create even-odd holes and release editable contours with their paint", () => {
  const outer = createVectorShape("M-10 -10H10V10H-10Z", { fill: "#aa3300", stroke: "#123456", strokeWidth: .75, opacity: .6 });
  const inner = shape("M-5 -5H5V5H-5Z"), compound = vector.makeCompoundShape(scope, [outer, inner]);
  assert.equal(compound.fillRule, "evenodd"); assert.equal(compound.fill, outer.fill); assert.equal(compound.strokeWidth, .75);
  assert.throws(() => combineShapes(scope, [compound, shape("M-2 -2H2V2H-2Z")], "intersect"), /empty shape/);
  const parts = vector.releaseCompoundShape(scope, compound); assert.equal(parts.length, 2);
  approx(area(parts[0].d), 400); approx(area(parts[1].d), 100);
  assert.ok(parts.every((part) => part.fill === outer.fill && part.opacity === .6 && shapeAnchors(scope, part)[0].closed));
  assert.notEqual(parts[0].id, parts[1].id);
  assert.throws(() => vector.releaseCompoundShape(scope, outer), /one contour/);
});

test("Divide partitions overlapping shapes, retains topmost paint and preserves total area", () => {
  const back = createVectorShape(left().d, { fill: "#ff0000", stroke: "none" });
  const front = createVectorShape(right().d, { fill: "#0000ff", stroke: "none" });
  const pieces = vector.divideShapes(scope, [back, front]); assert.equal(pieces.length, 3);
  approx(pieces.reduce((sum, part) => sum + area(part.d), 0), 175);
  approx(pieces.filter((part) => part.fill === front.fill).reduce((sum, part) => sum + area(part.d), 0), 100);
  approx(pieces.filter((part) => part.fill === back.fill).reduce((sum, part) => sum + area(part.d), 0), 75);
  for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
    assert.throws(() => combineShapes(scope, [pieces[a], pieces[b]], "intersect"), /empty shape/);
  }
});

test("Divide handles disjoint, nested and triple overlaps without filling holes or losing areas", () => {
  const donut = createVectorShape("M0 0H20V20H0Z M5 5H15V15H5Z", { fillRule: "evenodd", fill: "#ff0000", stroke: "none" });
  const middle = shape("M7 7H13V13H7Z");
  const separated = vector.divideShapes(scope, [donut, middle]); assert.equal(separated.length, 2);
  approx(separated.reduce((sum, part) => sum + area(part.d), 0), 336);
  const a = left(), b = right(), c = shape("M10 0H20V10H10Z");
  const triple = vector.divideShapes(scope, [a, b, c]);
  approx(triple.reduce((sum, part) => sum + area(part.d), 0), area(combineShapes(scope, [a, b, c], "unite").d));
  assert.throws(() => vector.divideShapes(scope, [a, shape("M0 0H2V2")]), /closed paths/);
});

test("closing an active pen contour leaves unrelated open paths unchanged", () => {
  const original = shape("M0 0H4V4 M10 10H14V14");
  const closed = vector.closeContour(scope, original, 0), anchors = shapeAnchors(scope, closed);
  assert.ok(anchors.filter(a => a.contour === 0).every(a => a.closed));
  assert.ok(anchors.filter(a => a.contour === 1).every(a => !a.closed));
  assert.throws(() => vector.closeContour(scope, shape("M0 0H4"), 0), /three anchors/);
});
