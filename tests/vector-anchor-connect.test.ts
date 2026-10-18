import assert from "node:assert/strict";
import test from "node:test";
import paper from "paper";
const vector: typeof import("../lib/vector-editor-geometry") = await import(new URL("../lib/vector-editor-geometry.ts", import.meta.url).href);
const { anchorConnectionState, connectAnchors, createVectorShape, paperItem, shapeAnchors } = vector;
const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
const shape = (d: string, overrides: Partial<import("../lib/vector-editor-geometry").VectorShape> = {}) => createVectorShape(d, overrides);
const ref = (source: import("../lib/vector-editor-geometry").VectorShape, index: number, contour = 0) => ({ id: source.id, contour, index });
const doc = (...shapes: import("../lib/vector-editor-geometry").VectorShape[]) => ({ width: 24, height: 24, shapes });
function keepsCurves(original: import("../lib/vector-editor-geometry").VectorShape, result: import("../lib/vector-editor-geometry").VectorShape) {
  const source = paperItem(scope, original), target = paperItem(scope, result);
  try {
    const curves = source.className === "CompoundPath" ? (source.children as paper.Path[]).flatMap(path => path.curves) : (source as paper.Path).curves;
    for (const curve of curves) for (const t of [0, .2, .5, .8, 1]) {
      const point = curve.getPointAtTime(t), nearest = target.getNearestPoint(point);
      assert.ok(point.getDistance(nearest) < 1e-6, `Existing curve moved at ${point}`);
    }
  } finally { source.remove(); target.remove(); }
}

test("Connect joins all endpoint orientations while preserving both cubic curves", () => {
  for (const firstEnd of [0, 1]) for (const secondEnd of [0, 1]) {
    const first = shape("M0 0C1 -2 3 -2 4 0"), second = shape("M8 0C9 2 11 2 12 0");
    const document = doc(first, second), before = JSON.stringify(document);
    const selected = [ref(first, firstEnd), ref(second, secondEnd)];
    assert.equal(anchorConnectionState(scope, document.shapes, selected).kind, "join");
    const result = connectAnchors(scope, document, selected);
    assert.equal(result.kind, "join"); assert.equal(result.document.shapes.length, 1);
    assert.equal(shapeAnchors(scope, result.document.shapes[0]).length, 4);
    keepsCurves(first, result.document.shapes[0]); keepsCurves(second, result.document.shapes[0]);
    assert.equal(JSON.stringify(document), before);
  }
});

test("Connect merges coincident open endpoints and retains incoming and outgoing curve handles", () => {
  const first = shape("M0 0C2 -4 4 -4 6 0"), second = shape("M12 0C10 4 8 4 6 0");
  const result = connectAnchors(scope, doc(first, second), [ref(first, 1), ref(second, 1)]).document.shapes[0];
  const anchors = shapeAnchors(scope, result);
  assert.equal(anchors.length, 3);
  assert.deepEqual(anchors[1].handleIn, { x: -2, y: -4 });
  assert.deepEqual(anchors[1].handleOut, { x: 2, y: 4 });
  keepsCurves(first, result); keepsCurves(second, result);
});

test("Connect closes one open contour, leaving the other contours and source intact", () => {
  const original = shape("M0 0H4V4H0 M10 10C12 8 14 12 16 10"), before = JSON.stringify(original);
  const result = connectAnchors(scope, doc(original), [ref(original, 0), ref(original, 3)]);
  assert.equal(result.kind, "close"); assert.equal(result.document.shapes.length, 1);
  const anchors = shapeAnchors(scope, result.document.shapes[0]);
  assert.ok(anchors.filter(a => a.contour === 0).every(a => a.closed));
  assert.ok(anchors.filter(a => a.contour === 1).every(a => !a.closed));
  keepsCurves(original, result.document.shapes[0]); assert.equal(JSON.stringify(original), before);
});

test("Connect between compound open contours retains all unrelated contours", () => {
  const source = shape("M0 0H4 M8 0H12 M16 4H20V8H16Z");
  const result = connectAnchors(scope, doc(source), [ref(source, 1, 0), ref(source, 0, 1)]).document.shapes[0];
  assert.equal(shapeAnchors(scope, result).filter(a => a.index === 0).length, 2);
  assert.equal(shapeAnchors(scope, result).filter(a => a.closed).length, 4);
  keepsCurves(source, result);
});

test("Closed filled shapes gain a visible independent connector without altering fills or holes", () => {
  const first = shape("M0 0H8V8H0Z M2 2V6H6V2Z", { fill: "#ff5500", stroke: "none", strokeWidth: 0, fillRule: "evenodd" });
  const second = shape("M12 0H20V8H12Z", { fill: "#0055ff", stroke: "none", strokeWidth: 0 });
  const document = doc(first, second), result = connectAnchors(scope, document, [ref(first, 1), ref(second, 0)], { strokeWidth: 2 });
  assert.equal(result.kind, "segment"); assert.equal(result.document.shapes.length, 3);
  assert.deepEqual(result.document.shapes.slice(0, 2), document.shapes);
  const connector = result.document.shapes[2];
  assert.equal(connector.fill, "none"); assert.equal(connector.stroke, "#ff5500"); assert.equal(connector.strokeWidth, 2);
  assert.deepEqual(shapeAnchors(scope, connector).map(a => a.point), [{ x: 8, y: 0 }, { x: 12, y: 0 }]);
});

test("Interior anchors create a branch without breaking or flattening existing curves", () => {
  const first = shape("M0 0C1 -2 3 -2 4 0C5 2 7 2 8 0"), second = shape("M4 8H8V12H4Z");
  const document = doc(first, second), result = connectAnchors(scope, document, [ref(first, 1), ref(second, 0)]);
  assert.equal(result.kind, "segment"); assert.deepEqual(result.document.shapes.slice(0, 2), document.shapes);
  assert.deepEqual(shapeAnchors(scope, result.document.shapes[2]).map(a => a.point), [{ x: 4, y: 0 }, { x: 4, y: 8 }]);
});

test("Adjacent, wrap-around, same-anchor and existing connector selections cannot duplicate an edge", () => {
  const square = shape("M0 0H8V8H0Z"), line = shape("M12 0H20");
  for (const selected of [[ref(square, 0), ref(square, 1)], [ref(square, 0), ref(square, 3)], [ref(square, 0), ref(square, 0)], [ref(line, 0), ref(line, 1)]]) {
    assert.equal(anchorConnectionState(scope, [square, line], selected).allowed, false);
    assert.throws(() => connectAnchors(scope, doc(square, line), selected), /already connected|different anchors/);
  }
  const selected = [ref(square, 1), ref(line, 0)];
  const first = connectAnchors(scope, doc(square, line), selected);
  assert.equal(anchorConnectionState(scope, first.document.shapes, selected).allowed, false);
  assert.throws(() => connectAnchors(scope, first.document, selected), /already have a connecting segment/);
});

test("Connect preserves different paint, dash patterns, live radii, and intervening layer order", () => {
  const first = shape("M0 0H4 M4 4H8"), second = shape("M8 0H12");
  for (const variant of [{ stroke: "#ff0000" }, { strokeWidth: 3 }, { opacity: .5 }, { lineCap: "square" as const }, { dashArray: "2 1" }, { cornerRadius: 1 }]) {
    const other = { ...second, ...variant }, document = doc(first, other);
    const result = connectAnchors(scope, document, [ref(first, 1), ref(other, 0)]);
    assert.equal(result.kind, "segment"); assert.deepEqual(result.document.shapes.slice(0, 2), document.shapes);
  }
  const blocker = shape("M2 2H10V6H2Z", { fill: "#ff0000", stroke: "none" }), layered = doc(first, blocker, second);
  const result = connectAnchors(scope, layered, [ref(first, 1), ref(second, 0)]);
  assert.equal(result.kind, "segment"); assert.deepEqual(result.document.shapes.slice(0, 3), layered.shapes);
});

test("Separate translucent or dashed paths remain separate even when both paints match", () => {
  for (const paint of [{ opacity: .4 }, { stroke: "rgba(10,20,30,0.5)" }, { stroke: "#12345688" }, { dashArray: "2 1" }]) {
    const first = shape("M0 0H4", paint), second = shape("M8 0H12", paint), document = doc(first, second);
    const result = connectAnchors(scope, document, [ref(first, 1), ref(second, 0)]);
    assert.equal(result.kind, "segment"); assert.deepEqual(result.document.shapes.slice(0, 2), document.shapes);
  }
});

test("Fill-only closure adds only a visible closing edge, with a nonzero fallback stroke", () => {
  const source = shape("M0 0H8V8H0", { fill: "#552299", stroke: "none", strokeWidth: 0 });
  const result = connectAnchors(scope, doc(source), [ref(source, 0), ref(source, 3)], { stroke: "none", strokeWidth: 0 });
  assert.equal(result.kind, "close"); assert.equal(result.document.shapes.length, 2);
  assert.equal(result.document.shapes[0].stroke, "none"); assert.equal(result.document.shapes[0].fill, source.fill);
  assert.ok(shapeAnchors(scope, result.document.shapes[0]).every(a => a.closed));
  assert.equal(result.document.shapes[1].stroke, source.fill); assert.ok(result.document.shapes[1].strokeWidth > 0);
});

test("Invalid and coincident branch selections leave the input and Paper project unchanged", () => {
  const first = shape("M0 0H8V8H0Z"), second = shape("M0 0H4V4H0Z");
  const document = doc(first, second), before = JSON.stringify(document), count = scope.project.activeLayer.children.length;
  for (const selected of [[], [ref(first, 0)], [ref(first, 99), ref(second, 0)], [ref(first, 0), ref(second, 0)]]) assert.throws(() => connectAnchors(scope, document, selected));
  assert.equal(JSON.stringify(document), before); assert.equal(scope.project.activeLayer.children.length, count);
});
