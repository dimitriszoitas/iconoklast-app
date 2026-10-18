import assert from "node:assert/strict";
import test from "node:test";
import paper from "paper";
import { Window } from "happy-dom";
const vector: typeof import("../lib/vector-editor-geometry") = await import(new URL("../lib/vector-editor-geometry.ts", import.meta.url).href);
const { anchorConnectionState, connectAnchors, createVectorShape, exportVectorSvg, importVectorSvg, paperItem, shapeAnchors } = vector;
const window = new Window();
globalThis.DOMParser = window.DOMParser as unknown as typeof DOMParser;
const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
type Shape = import("../lib/vector-editor-geometry").VectorShape;
const shape = (d: string, overrides: Partial<Shape> = {}) => createVectorShape(d, overrides);
const ref = (source: Shape, index: number, contour = 0) => ({ id: source.id, contour, index });
const doc = (...shapes: Shape[]) => ({ width: 24, height: 24, shapes });
function keepsCurves(original: Shape, result: Shape) {
  const source = paperItem(scope, original), target = paperItem(scope, result);
  try {
    const curves = source.className === "CompoundPath" ? (source.children as paper.Path[]).flatMap(path => path.curves) : (source as paper.Path).curves;
    for (const curve of curves) for (const t of [0, .2, .5, .8, 1]) {
      const point = curve.getPointAtTime(t), nearest = target.getNearestPoint(point);
      assert.ok(point.getDistance(nearest) < 1e-6, `Existing curve moved at ${point}`);
    }
  } finally { source.remove(); target.remove(); }
}
function unsupported(document: ReturnType<typeof doc>, selected: ReturnType<typeof ref>[], reason: RegExp) {
  const before = JSON.stringify(document), count = scope.project.activeLayer.children.length;
  const state = anchorConnectionState(scope, document.shapes, selected);
  assert.equal(state.allowed, false); assert.equal(state.kind, null); assert.match(state.reason, reason);
  assert.throws(() => connectAnchors(scope, document, selected), reason);
  assert.equal(JSON.stringify(document), before);
  assert.equal(scope.project.activeLayer.children.length, count);
}

test("Connect joins all endpoint orientations into one contour while preserving both cubic curves", () => {
  for (const firstEnd of [0, 1]) for (const secondEnd of [0, 1]) {
    const first = shape("M0 0C1 -2 3 -2 4 0"), second = shape("M8 0C9 2 11 2 12 0");
    const document = doc(first, second), before = JSON.stringify(document);
    const selected = [ref(first, firstEnd), ref(second, secondEnd)];
    assert.equal(anchorConnectionState(scope, document.shapes, selected).kind, "join");
    const result = connectAnchors(scope, document, selected);
    assert.equal(result.kind, "join"); assert.equal(result.document.shapes.length, 1);
    const anchors = shapeAnchors(scope, result.document.shapes[0]);
    assert.equal(anchors.length, 4); assert.ok(anchors.every(a => a.contour === 0 && !a.closed));
    assert.deepEqual(result.selectedIds, [first.id]);
    assert.ok(result.document.shapes.every(s => s.name !== "Connection"));
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
  const output = connectAnchors(scope, doc(source), [ref(source, 1, 0), ref(source, 0, 1)]);
  assert.equal(output.document.shapes.length, 1);
  const result = output.document.shapes[0], anchors = shapeAnchors(scope, result);
  assert.equal(anchors.filter(a => a.index === 0).length, 2);
  assert.equal(anchors.filter(a => a.closed).length, 4);
  assert.equal(anchors.filter(a => a.contour === 0).length, 4);
  keepsCurves(source, result);
});

test("Closed contours cannot be connected without cutting them open first", () => {
  const first = shape("M0 0H8V8H0Z M2 2V6H6V2Z", { fill: "#ff5500", stroke: "none", strokeWidth: 0, fillRule: "evenodd" });
  const second = shape("M12 0H20V8H12Z", { fill: "#0055ff", stroke: "none", strokeWidth: 0 });
  const document = doc(first, second);
  for (const selected of [[ref(first, 1), ref(second, 0)], [ref(first, 0), ref(first, 1)], [ref(first, 0), ref(first, 3)]]) {
    unsupported(document, selected, /open paths.*Cut the closed contour/);
  }
});

test("Interior anchors are disabled instead of creating a branch or flattening curves", () => {
  const first = shape("M0 0C1 -2 3 -2 4 0C5 2 7 2 8 0"), second = shape("M4 8H8V12H4");
  for (const selected of [[ref(first, 1), ref(second, 0)], [ref(first, 1), ref(second, 1)], [ref(first, 0), ref(first, 1)]]) {
    unsupported(doc(first, second), selected, /first or last.*Cut at an interior anchor/);
  }
});

test("Selecting the same anchor or both ends of a straight segment cannot duplicate its edge", () => {
  const line = shape("M0 0H8");
  unsupported(doc(line), [ref(line, 0), ref(line, 0)], /different anchors/);
  unsupported(doc(line), [ref(line, 0), ref(line, 1)], /already connected by a straight segment/);
});

test("An existing standalone connector does not prevent a genuine topology join", () => {
  const first = shape("M0 0H4"), second = shape("M8 0H12");
  const oldConnector = shape("M4 0H8", { name: "Connection" }), document = doc(first, second, oldConnector);
  const before = JSON.stringify(document);
  const result = connectAnchors(scope, document, [ref(first, 1), ref(second, 0)]);
  assert.equal(result.document.shapes.length, 2);
  assert.equal(shapeAnchors(scope, result.document.shapes[0]).length, 4);
  assert.ok(shapeAnchors(scope, result.document.shapes[0]).every(a => a.contour === 0));
  assert.deepEqual(result.document.shapes[1], oldConnector);
  assert.equal(result.document.shapes.filter(s => s.name === "Connection").length, 1);
  assert.equal(JSON.stringify(document), before);
});

test("Different styles and intervening layers disable joining without replacing any shapes", () => {
  const first = shape("M0 0H4 M4 4H8"), second = shape("M8 0H12");
  for (const variant of [{ fill: "#ff0000" }, { stroke: "#ff0000" }, { strokeWidth: 3 }, { opacity: .5 }, { lineCap: "square" as const }, { dashArray: "2 1" }, { cornerRadius: 1 }, { fillRule: "evenodd" as const }]) {
    const other = { ...second, ...variant };
    unsupported(doc(first, other), [ref(first, 1), ref(other, 0)], /different styles.*Match their fill/);
  }
  const blocker = shape("M2 2H10V6H2Z", { fill: "#ff0000", stroke: "none" });
  unsupported(doc(first, blocker, second), [ref(first, 1), ref(second, 0)], /next to each other in the Layers list/);
});

test("Separate translucent paths cannot silently change compositing when joined", () => {
  for (const paint of [{ opacity: .4 }, { stroke: "rgba(10,20,30,0.5)" }, { stroke: "#12345688" }, { fill: "#4568" }, { fill: "rgba(10,20,30,0.5)", stroke: "none", strokeWidth: 0 }]) {
    const first = shape("M0 0H4", paint), second = shape("M8 0H12", paint);
    unsupported(doc(first, second), [ref(first, 1), ref(second, 0)], /transparent paths.*opaque matching styles/);
  }
});

test("Joining dashed contours is disabled with an explanation of pattern changes", () => {
  const first = shape("M0 0H4", { dashArray: "2 1" }), second = shape("M8 0H12", { dashArray: "2 1" });
  unsupported(doc(first, second), [ref(first, 1), ref(second, 0)], /shift the dash pattern.*solid strokes/);
});

test("Matching live corner settings survive a real join without changing editable anchors", () => {
  const first = shape("M0 0H4V4", { cornerRadius: 1 }), second = shape("M8 4V8H12", { cornerRadius: 1 });
  const result = connectAnchors(scope, doc(first, second), [ref(first, 2), ref(second, 0)]);
  assert.equal(result.document.shapes.length, 1); assert.equal(result.document.shapes[0].cornerRadius, 1);
  assert.equal(shapeAnchors(scope, result.document.shapes[0]).length, 6);
  keepsCurves(first, result.document.shapes[0]); keepsCurves(second, result.document.shapes[0]);
});

test("Fill-only closure closes the actual contour without adding any stroke or shape", () => {
  const source = shape("M0 0H8V8H0", { fill: "#552299", stroke: "none", strokeWidth: 0 });
  const result = connectAnchors(scope, doc(source), [ref(source, 0), ref(source, 3)]);
  assert.equal(result.kind, "close"); assert.equal(result.document.shapes.length, 1);
  const closed = result.document.shapes[0];
  assert.equal(closed.stroke, "none"); assert.equal(closed.strokeWidth, 0); assert.equal(closed.fill, source.fill);
  assert.equal(closed.id, source.id); assert.equal(closed.name, source.name);
  assert.ok(shapeAnchors(scope, closed).every(a => a.closed));
});

test("Matching filled open paths join into one contour with their existing shared paint", () => {
  const paint = { fill: "#552299", stroke: "none", strokeWidth: 0, fillRule: "evenodd" as const };
  const first = shape("M0 0H4V4 M1 1V2H2V1Z", paint), second = shape("M8 4V8H12", paint);
  const document = doc(first, second), before = JSON.stringify(document);
  const result = connectAnchors(scope, document, [ref(first, 2), ref(second, 0)]);
  assert.equal(result.kind, "join"); assert.equal(result.document.shapes.length, 1);
  const joined = result.document.shapes[0], anchors = shapeAnchors(scope, joined);
  assert.equal(joined.fill, paint.fill); assert.equal(joined.stroke, "none"); assert.equal(joined.strokeWidth, 0);
  assert.equal(joined.fillRule, "evenodd"); assert.equal(anchors.filter(a => a.contour === 0).length, 6);
  assert.equal(anchors.filter(a => a.closed).length, 4);
  keepsCurves(first, joined); keepsCurves(second, joined);
  assert.equal(JSON.stringify(document), before);
});

test("Two-anchor curves can close, including coincident endpoints with their curve handles", () => {
  for (const d of ["M0 0C2 -4 4 -4 6 0", "M0 0C8 0 8 8 0 0"]) {
    const source = shape(d, { fill: "#552299", stroke: "none", strokeWidth: 0 });
    const result = connectAnchors(scope, doc(source), [ref(source, 0), ref(source, 1)]);
    assert.equal(result.kind, "close"); assert.equal(result.document.shapes.length, 1);
    const anchors = shapeAnchors(scope, result.document.shapes[0]);
    assert.ok(anchors.every(a => a.closed)); keepsCurves(source, result.document.shapes[0]);
    if (d.endsWith("0 0")) {
      assert.equal(anchors.length, 1);
      assert.deepEqual(anchors[0].handleOut, { x: 8, y: 0 }); assert.deepEqual(anchors[0].handleIn, { x: 8, y: 8 });
    }
  }
});

test("Joined and closed topology survives SVG export and reimport without a Connection path", () => {
  const first = shape("M0 0C1 -2 3 -2 4 0"), second = shape("M8 0C9 2 11 2 12 0");
  const filled = shape("M0 0H8V8H0", { fill: "#552299", stroke: "none", strokeWidth: 0 });
  const examples = [
    connectAnchors(scope, doc(first, second), [ref(first, 1), ref(second, 0)]),
    connectAnchors(scope, doc(filled), [ref(filled, 0), ref(filled, 3)]),
  ];
  for (const result of examples) {
    const svg = exportVectorSvg(result.document, scope);
    assert.equal((svg.match(/<path /g) || []).length, 1); assert.doesNotMatch(svg, /Connection/);
    const reopened = importVectorSvg(scope, svg);
    assert.equal(reopened.shapes.length, 1);
    const anchors = shapeAnchors(scope, reopened.shapes[0]);
    assert.equal(anchors.filter(a => a.index === 0).length, 1);
    assert.equal(anchors.length, 4); assert.ok(anchors.every(a => a.closed === (result.kind === "close")));
    assert.equal(reopened.shapes[0].fill, result.document.shapes[0].fill);
    assert.equal(reopened.shapes[0].stroke, result.document.shapes[0].stroke);
    keepsCurves(result.document.shapes[0], reopened.shapes[0]);
  }
});

test("Invalid or unsupported selections leave the input and Paper project unchanged", () => {
  const first = shape("M0 0H8V8H0Z"), second = shape("M0 0H4V4H0Z"), document = doc(first, second);
  for (const selected of [[], [ref(first, 0)], [ref(first, 99), ref(second, 0)], [{ id: "missing", index: 0, contour: 0 }, ref(second, 0)], [ref(first, 0), ref(second, 0)]]) {
    unsupported(document, selected, /Select/);
  }
});
