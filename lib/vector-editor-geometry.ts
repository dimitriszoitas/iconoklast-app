import type paper from "paper";
import { vectorJunctionCaps } from "./vector-junction-caps.ts";

export type VectorShape = {
  id: string;
  name: string;
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  lineCap: "round" | "butt" | "square";
  lineJoin: "round" | "miter" | "bevel";
  fillRule: "nonzero" | "evenodd";
  dashArray?: string;
  dashOffset?: number;
  miterLimit?: number;
  /** Live corner effect in SVG units. `d` always remains the editable skeleton. */
  cornerRadius?: number;
  endpoints?: { firstIn: VectorPoint; lastOut: VectorPoint }[];
};
export type VectorDocument = { width: number; height: number; shapes: VectorShape[] };
export type BooleanOperation = "unite" | "subtract" | "intersect" | "exclude";
export type VectorPoint = { x: number; y: number };
export type VectorAnchor = { contour: number; index: number; point: VectorPoint; handleIn: VectorPoint; handleOut: VectorPoint; closed: boolean };
export type VectorAnchorRef = { contour: number; index: number };
export type VectorAnchorSelection = VectorAnchorRef & { id: string };
export type VectorCurveRef = { contour: number; index: number };
export type VectorBounds = { x: number; y: number; width: number; height: number };
export type VectorMatrix = { a: number; b: number; c: number; d: number; tx: number; ty: number };

let counter = 0;
export function vectorId() { return `shape-${Date.now().toString(36)}-${(++counter).toString(36)}`; }
export function createVectorShape(d: string, overrides: Partial<VectorShape> = {}): VectorShape {
  return { id: vectorId(), name: "Path", d, fill: "none", stroke: "#231c2a", strokeWidth: 1.5, opacity: 1, lineCap: "round", lineJoin: "round", fillRule: "nonzero", ...overrides };
}
export function paperItem(scope: paper.PaperScope, shape: Pick<VectorShape, "d"> & Pick<Partial<VectorShape>, "endpoints" | "fillRule">): paper.PathItem {
  scope.activate();
  const item = new scope.CompoundPath({ pathData: shape.d, insert: false });
  const reduced = item.reduce({ simplify: false }) as paper.PathItem;
  reduced.remove();
  reduced.fillRule = shape.fillRule || "nonzero";
  contours(reduced).forEach((path, index) => {
    const ends = shape.endpoints?.[index];
    if (ends && path.firstSegment && path.lastSegment) { path.firstSegment.handleIn = new scope.Point(ends.firstIn.x, ends.firstIn.y); path.lastSegment.handleOut = new scope.Point(ends.lastOut.x, ends.lastOut.y); }
  });
  return reduced;
}
function contours(item: paper.PathItem): paper.Path[] {
  return item.className === "CompoundPath" ? (item.children as paper.Path[]) : [item as paper.Path];
}
function serializeItem(item: paper.PathItem) {
  return { d: item.pathData, endpoints: contours(item).map((path) => ({ firstIn: { x: path.firstSegment?.handleIn.x || 0, y: path.firstSegment?.handleIn.y || 0 }, lastOut: { x: path.lastSegment?.handleOut.x || 0, y: path.lastSegment?.handleOut.y || 0 } })) };
}

/** Apply circular fillets only at sharp joins between two straight edges.
 * Curves, open endpoints and the editable source are never rewritten.
 */
export function renderedPathData(scope: paper.PaperScope, shape: VectorShape): string {
  const radius = shape.cornerRadius;
  if (!Number.isFinite(radius) || !radius || radius < 0) return shape.d;
  const item = paperItem(scope, shape);
  try {
    for (const path of contours(item)) {
      const source = path.segments.map((segment) => segment.clone()), count = source.length;
      const rounded: paper.Segment[] = [];
      source.forEach((segment, index) => {
        const previous = source[(index + count - 1) % count], next = source[(index + 1) % count];
        if (count < 3 || (!path.closed && (index === 0 || index === count - 1)) || !previous.handleOut.isZero() || !segment.handleIn.isZero() || !segment.handleOut.isZero() || !next.handleIn.isZero()) {
          rounded.push(segment); return;
        }
        const incoming = segment.point.subtract(previous.point), outgoing = next.point.subtract(segment.point);
        const before = incoming.length, after = outgoing.length;
        if (before < 1e-8 || after < 1e-8) { rounded.push(segment); return; }
        const u = incoming.normalize(), v = outgoing.normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, u.dot(v))));
        if (angle < 1e-6 || Math.PI - angle < 1e-6) { rounded.push(segment); return; }
        // Reserving at most half of each edge prevents neighboring corners
        // from crossing, including concave corners and very short edges.
        const tangent = Math.min(radius * Math.tan(angle / 2), before / 2, after / 2);
        const effectiveRadius = tangent / Math.tan(angle / 2);
        const handle = effectiveRadius * (4 / 3) * Math.tan(angle / 4);
        rounded.push(new scope.Segment(segment.point.subtract(u.multiply(tangent)), undefined, u.multiply(handle)));
        rounded.push(new scope.Segment(segment.point.add(v.multiply(tangent)), v.multiply(-handle), undefined));
      });
      path.removeSegments(); path.addSegments(rounded);
    }
    return item.pathData;
  } finally { item.remove(); }
}

function visiblePaperItem(scope: paper.PaperScope, shape: VectorShape): paper.PathItem {
  return paperItem(scope, { d: renderedPathData(scope, shape), fillRule: shape.fillRule });
}

/** Recover already-baked circular corner joins, only when a single editable
 * radius reproduces the existing appearance. Organic curves are preserved.
 * Explicit radius edits may opt out of the appearance guard to replace mixed
 * baked radii with the user's new value; detected arcs must still be circular.
 */
export function recoverEditableCorners(scope: paper.PaperScope, shape: VectorShape, options: { preserveAppearance?: boolean } = {}): VectorShape {
  // Path-start changes can shift a dashed stroke even when the outline agrees.
  if (shape.cornerRadius !== undefined || (shape.dashArray && shape.dashArray !== "none")) return shape;
  const item = paperItem(scope, shape), radii: number[] = [];
  try {
    for (const path of contours(item)) {
      const replace = new Map<number, paper.Segment>(), skip = new Set<number>();
      for (const curve of path.curves) {
        const a = curve.segment1, b = curve.segment2, previous = a.previous, next = b.next;
        if (!previous || !next || !a.handleIn.isZero() || !b.handleOut.isZero() || !previous.handleOut.isZero() || !next.handleIn.isZero() || a.handleOut.isZero() || b.handleIn.isZero()) continue;
        const incoming = a.point.subtract(previous.point), outgoing = next.point.subtract(b.point);
        if (incoming.length < 1e-8 || outgoing.length < 1e-8) continue;
        const u = incoming.normalize(), v = outgoing.normalize(), cross = u.cross(v);
        if (Math.abs(cross) < 1e-6 || u.dot(a.handleOut.normalize()) < .99999 || v.dot(b.handleIn.normalize()) > -.99999) continue;
        const difference = b.point.subtract(a.point), before = difference.cross(v) / cross, after = u.cross(difference) / cross;
        if (before <= 1e-6 || after <= 1e-6 || Math.abs(before - after) > Math.max(before, after) * .002) continue;
        const angle = Math.acos(Math.max(-1, Math.min(1, u.dot(v)))), radius = before / Math.tan(angle / 2);
        const expected = radius * (4 / 3) * Math.tan(angle / 4);
        if (Math.abs(a.handleOut.length - expected) > Math.max(.00005, expected * .002) || Math.abs(b.handleIn.length - expected) > Math.max(.00005, expected * .002)) continue;
        replace.set(a.index, new scope.Segment(a.point.add(u.multiply(before)))); skip.add(b.index); radii.push(radius);
      }
      if (replace.size) {
        const segments = path.segments.flatMap((segment, index) => skip.has(index) ? [] : [replace.get(index) || segment.clone()]);
        path.removeSegments(); path.addSegments(segments);
      }
    }
    if (!radii.length || (options.preserveAppearance !== false && Math.max(...radii) - Math.min(...radii) > Math.max(...radii) * .005)) return shape;
    const radius = radii.reduce((sum, value) => sum + value, 0) / radii.length;
    const candidate = { ...shape, ...serializeItem(item), cornerRadius: Math.round(radius * 100000) / 100000 };
    if (options.preserveAppearance === false) return candidate;
    const original = paperItem(scope, shape), restored = visiblePaperItem(scope, candidate);
    try {
      const matches = (from: paper.PathItem, to: paper.PathItem) => contours(from).every((path) => path.curves.every((curve) => [0, .25, .5, .75, 1].every((time) => {
        const location = to.getNearestLocation(curve.getPointAtTime(time));
        return location && location.distance < Math.max(.0002, radius * .002);
      })));
      return matches(original, restored) && matches(restored, original) ? candidate : shape;
    } finally { original.remove(); restored.remove(); }
  } finally { item.remove(); }
}
export function appendPenPoint(scope: paper.PaperScope, shape: VectorShape, point: VectorPoint) {
  const item = paperItem(scope, shape); const path = contours(item)[0]; path.add(new scope.Point(point.x, point.y));
  const result = { ...shape, ...serializeItem(item) }; item.remove(); return result;
}
function finite(value: string | null, fallback = 0) {
  if (!value) return fallback;
  if (!/^[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?(?:px)?$/i.test(value.trim())) throw new Error(`Unsupported dimension “${value}”. Use SVG pixel or unitless dimensions.`);
  const number = parseFloat(value);
  if (!Number.isFinite(number)) throw new Error("The SVG contains an invalid dimension.");
  return number;
}
function transformMatrix(scope: paper.PaperScope, input: string | null) {
  const matrix = new scope.Matrix();
  if (!input) return matrix;
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  let remainder = input;
  while ((match = pattern.exec(input))) {
    remainder = remainder.replace(match[0], "");
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some((x) => !Number.isFinite(x))) throw new Error("An SVG transform is invalid.");
    const m = new scope.Matrix();
    switch (match[1].toLowerCase()) {
      case "matrix": if (args.length !== 6) throw new Error("Invalid SVG matrix."); m.set(...args as [number, number, number, number, number, number]); break;
      case "translate": m.translate(args[0] || 0, args[1] || 0); break;
      case "scale": m.scale(args[0], args[1] ?? args[0]); break;
      case "rotate": m.rotate(args[0], new scope.Point(args[1] || 0, args[2] || 0)); break;
      case "skewx": m.set(1, 0, Math.tan(args[0] * Math.PI / 180), 1, 0, 0); break;
      case "skewy": m.set(1, Math.tan(args[0] * Math.PI / 180), 0, 1, 0, 0); break;
      default: throw new Error(`Unsupported SVG transform: ${match[1]}.`);
    }
    matrix.append(m);
  }
  if (remainder.replace(/[\s,]/g, "")) throw new Error("An SVG transform is invalid.");
  return matrix;
}

/** Converts supported self-contained SVG geometry into editable, transformed paths. */
export function importVectorSvg(scope: paper.PaperScope, svg: string): VectorDocument {
  scope.activate();
  if (svg.length > 400_000 || /<!DOCTYPE|<!ENTITY/i.test(svg)) throw new Error("This SVG is too large or contains unsupported XML declarations.");
  const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (xml.querySelector("parsererror") || xml.documentElement.localName !== "svg") throw new Error("This file is not a valid SVG.");
  const root = xml.documentElement;
  const supported = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "title", "desc"]);
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (element !== root && element.localName === "svg") throw new Error("Nested SVG artboards are not supported. Flatten the inner artboard to paths first.");
    if (!supported.has(element.localName)) throw new Error(`The editor cannot yet edit <${element.localName}>. Convert text, masks, clips, gradients and references to plain paths first. Your original icon is unchanged.`);
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name) || /href/i.test(attribute.name) || /url\s*\(|javascript:|expression\s*\(/i.test(attribute.value)) throw new Error("This SVG contains an unsupported reference or active content.");
      if (["clip-path", "mask", "filter", "vector-effect"].includes(attribute.name)) throw new Error(`The editor does not yet support ${attribute.name}. Convert the effect to plain paths first.`);
    }
  }
  const vb = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb && (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)))) throw new Error("The SVG viewBox is invalid.");
  const width = vb?.[2] ?? finite(root.getAttribute("width"), 24);
  const height = vb?.[3] ?? finite(root.getAttribute("height"), 24);
  if (width <= 0 || height <= 0 || width > 10000 || height > 10000) throw new Error("The SVG needs a positive artboard no larger than 10,000 units.");
  const shapes: VectorShape[] = [];
  const baseMatrix = new scope.Matrix();
  baseMatrix.translate(-(vb?.[0] || 0), -(vb?.[1] || 0));
  type Attributes = Record<string, string>;
  const inheritedKeys = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "color", "fill-opacity", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit"];
  function visit(element: Element, inherited: Attributes, matrix: paper.Matrix, parentOpacity: number) {
    if (["title", "desc"].includes(element.localName) || element.getAttribute("data-iconify-junction-cap") === "1") return;
    const style: Attributes = {};
    for (const bit of (element.getAttribute("style") || "").split(";")) {
      const index = bit.indexOf(":");
      if (index >= 0) style[bit.slice(0, index).trim()] = bit.slice(index + 1).trim();
    }
    const attrs = { ...inherited };
    for (const key of inheritedKeys) attrs[key] = style[key] ?? element.getAttribute(key) ?? inherited[key];
    const opacity = parentOpacity * Math.min(1, Math.max(0, finite(style.opacity ?? element.getAttribute("opacity"), 1)));
    if ((style.display ?? element.getAttribute("display")) === "none" || (style.visibility ?? element.getAttribute("visibility")) === "hidden") return;
    const combined = matrix.clone().append(transformMatrix(scope, element.getAttribute("transform")));
    if (["svg", "g"].includes(element.localName)) {
      if (opacity !== parentOpacity && element.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon").length > 1) throw new Error("This icon uses opacity on a group of shapes. Apply opacity to individual paths before editing to preserve overlapping colors.");
      for (const child of Array.from(element.children)) visit(child, attrs, combined, opacity);
      return;
    }
    const num = (name: string, fallback = 0) => finite(element.getAttribute(name), fallback);
    let item: paper.PathItem;
    const tag = element.localName;
    const scaling = (combined.decompose() as { scaling: paper.Point }).scaling;
    const xScale = Math.hypot(combined.a, combined.b), yScale = Math.hypot(combined.c, combined.d);
    const uniformScale = Math.abs(xScale - yScale) <= .001 && Math.abs(combined.a * combined.c + combined.b * combined.d) <= .000001 * Math.max(1, xScale * yScale);
    let cornerRadius: number | undefined;
    if (tag === "path") {
      let d = element.getAttribute("d") || "";
      const base = element.getAttribute("data-iconify-base-path"), radius = element.getAttribute("data-iconify-corner-radius");
      if (base !== null || radius !== null) {
        const value = finite(radius, -1);
        if (!base || base.length > 200_000 || !/^[Mm]/.test(base.trim()) || !/^[\s\d.,+\-eEMmZzLlHhVvCcSsQqTtAa]+$/.test(base) || value < 0 || value > 10000) throw new Error("This SVG contains invalid editable corner data.");
        const coordinates = base.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
        if (coordinates.some((number) => !Number.isFinite(number) || Math.abs(number) > 100000)) throw new Error("This SVG contains out-of-range editable corner coordinates.");
        const check = paperItem(scope, { d: base });
        try {
          const bounds = check.bounds;
          if (!check.pathData || contours(check).reduce((total, path) => total + path.segments.length, 0) > 10000 || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) throw new Error("This SVG contains invalid editable corner geometry.");
        } finally { check.remove(); }
        // A non-uniformly transformed fillet is elliptical; retain its actual
        // visible path instead of pretending a scalar radius can describe it.
        if (uniformScale) { d = base; cornerRadius = value * Math.abs(scaling.x); }
      }
      item = paperItem(scope, { d });
    }
    else if (tag === "rect") {
      const rect = new scope.Rectangle(num("x"), num("y"), num("width"), num("height"));
      const rx = num("rx", num("ry")); const ry = num("ry", rx);
      item = new scope.Path.Rectangle({ rectangle: rect, radius: new scope.Size(rx, ry), insert: false });
    } else if (tag === "circle" || tag === "ellipse") {
      item = new scope.Path.Ellipse({ center: [num("cx"), num("cy")], radius: tag === "circle" ? [num("r"), num("r")] : [num("rx"), num("ry")], insert: false });
    } else if (tag === "line") item = new scope.Path({ segments: [[num("x1"), num("y1")], [num("x2"), num("y2")]], insert: false });
    else {
      const numbers = (element.getAttribute("points") || "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (numbers.length % 2 || numbers.some((n) => !Number.isFinite(n))) throw new Error("A polygon has invalid coordinates.");
      const points: number[][] = []; for (let i = 0; i < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
      item = new scope.Path({ segments: points, closed: tag === "polygon", insert: false });
    }
    item.transform(combined);
    const fill = attrs.fill === "currentColor" ? attrs.color : attrs.fill;
    const stroke = attrs.stroke === "currentColor" ? attrs.color : attrs.stroke;
    const fillAlpha = finite(attrs["fill-opacity"], 1), strokeAlpha = finite(attrs["stroke-opacity"], 1);
    const paint = (value: string, alpha: number) => {
      if (!value || value === "none") return "none";
      try { const color = new scope.Color(value); color.alpha *= alpha; return color.toCSS(color.alpha === 1); } catch { throw new Error(`Unsupported SVG color “${value}”.`); }
    };
    if (stroke !== "none" && !uniformScale) throw new Error("This icon uses non-uniformly scaled strokes. Outline those strokes before editing to preserve its appearance.");
    if (item.pathData) shapes.push(createVectorShape(item.pathData, {
      name: element.getAttribute("id") || `${tag === "path" ? "Path" : tag.charAt(0).toUpperCase() + tag.slice(1)} ${shapes.length + 1}`,
      fill: paint(fill, fillAlpha), stroke: paint(stroke, strokeAlpha), strokeWidth: finite(attrs["stroke-width"], 1) * Math.abs(scaling.x), opacity,
      lineCap: ["butt", "square"].includes(attrs["stroke-linecap"]) ? attrs["stroke-linecap"] as VectorShape["lineCap"] : "round",
      lineJoin: ["miter", "bevel"].includes(attrs["stroke-linejoin"]) ? attrs["stroke-linejoin"] as VectorShape["lineJoin"] : "round",
      fillRule: attrs["fill-rule"] === "evenodd" ? "evenodd" : "nonzero",
      dashArray: attrs["stroke-dasharray"] || undefined, dashOffset: finite(attrs["stroke-dashoffset"], 0), miterLimit: finite(attrs["stroke-miterlimit"], 4),
      ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    }));
    item.remove();
  }
  visit(root, { fill: "#000000", stroke: "none", "stroke-width": "1", color: "#231c2a", "stroke-linecap": "butt", "stroke-linejoin": "miter", "fill-rule": "nonzero", "fill-opacity": "1", "stroke-opacity": "1" }, baseMatrix, 1);
  if (!shapes.length) throw new Error("This SVG has no editable paths.");
  return { width, height, shapes };
}

export function exportVectorSvg(doc: VectorDocument, scope?: paper.PaperScope): string {
  const escape = (value: string) => value.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[c]!));
  const number = (n: number) => String(Math.round(n * 100000) / 100000);
  const rendered = doc.shapes.map(shape => ({ ...shape, d: scope ? renderedPathData(scope, shape) : shape.d }));
  const caps = scope ? vectorJunctionCaps(scope, rendered) : [];
  const paths = doc.shapes.map((s, index) => {
    if (s.cornerRadius && !scope) throw new Error("Exporting live corners requires the editor geometry scope.");
    const d = rendered[index].d;
    const corners = s.cornerRadius !== undefined && Number.isFinite(s.cornerRadius) && s.cornerRadius >= 0 ? ` data-iconify-base-path="${escape(s.d)}" data-iconify-corner-radius="${number(s.cornerRadius)}"` : "";
    const patches = caps.filter(cap => cap.shapeId === s.id).map(cap => `<path data-iconify-junction-cap="1" d="${cap.d}" fill="none" stroke="${escape(s.stroke)}" stroke-width="${number(s.strokeWidth)}" stroke-linecap="square"/>`).join("");
    return `<path d="${escape(d)}"${corners} fill="${escape(s.fill)}" stroke="${escape(s.stroke)}" stroke-width="${number(s.strokeWidth)}" stroke-linecap="${s.lineCap}" stroke-linejoin="${s.lineJoin}" fill-rule="${s.fillRule}" opacity="${number(s.opacity)}"${s.dashArray ? ` stroke-dasharray="${escape(s.dashArray)}"` : ""}${s.dashOffset ? ` stroke-dashoffset="${number(s.dashOffset)}"` : ""}${s.miterLimit ? ` stroke-miterlimit="${number(s.miterLimit)}"` : ""}/>${patches}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" ${scope ? 'data-iconify-junctions="1" ' : ''}width="${number(doc.width)}" height="${number(doc.height)}" viewBox="0 0 ${number(doc.width)} ${number(doc.height)}">${paths}</svg>`;
}

export function shapeAnchors(scope: paper.PaperScope, shape: VectorShape): VectorAnchor[] {
  const item = paperItem(scope, shape);
  const result = contours(item).flatMap((path, contour) => path.segments.map((segment, index) => ({ contour, index, point: { x: segment.point.x, y: segment.point.y }, handleIn: { x: segment.handleIn.x, y: segment.handleIn.y }, handleOut: { x: segment.handleOut.x, y: segment.handleOut.y }, closed: path.closed })));
  item.remove(); return result;
}
export function moveAnchor(scope: paper.PaperScope, shape: VectorShape, contour: number, index: number, kind: "point" | "handleIn" | "handleOut", point: VectorPoint, linked = false): VectorShape {
  const item = paperItem(scope, shape); const segment = contours(item)[contour]?.segments[index];
  if (!segment) return shape;
  if (kind === "point") segment.point = new scope.Point(point.x, point.y);
  else {
    const delta = new scope.Point(point.x, point.y).subtract(segment.point);
    segment[kind] = delta;
    if (linked) segment[kind === "handleIn" ? "handleOut" : "handleIn"] = delta.multiply(-1);
  }
  const result = { ...shape, ...serializeItem(item) }; item.remove(); return result;
}
export function changeAnchor(scope: paper.PaperScope, shape: VectorShape, contour: number, index: number, action: "delete" | "smooth" | "corner") {
  const item = paperItem(scope, shape); const path = contours(item)[contour]; const segment = path?.segments[index];
  if (!segment) return shape;
  if (action === "delete") { segment.remove(); if (path.segments.length < 2) path.remove(); }
  else if (action === "corner") { segment.handleIn = new scope.Point(0, 0); segment.handleOut = new scope.Point(0, 0); }
  else segment.smooth();
  const result = { ...shape, ...serializeItem(item) }; item.remove(); return result;
}
export function addAnchor(scope: paper.PaperScope, shape: VectorShape, point: VectorPoint) {
  const item = paperItem(scope, shape); const location = item.getNearestLocation(new scope.Point(point.x, point.y));
  location?.curve.divideAt(location); const result = { ...shape, ...serializeItem(item) }; item.remove(); return result;
}
export function translateShape(scope: paper.PaperScope, shape: VectorShape, delta: VectorPoint) {
  const item = paperItem(scope, shape); item.translate(new scope.Point(delta.x, delta.y)); const result = { ...shape, ...serializeItem(item) }; item.remove(); return result;
}
export function shapeBounds(scope: paper.PaperScope, shape: VectorShape) {
  const item = paperItem(scope, shape); const b = item.bounds; const bounds = { x: b.x, y: b.y, width: b.width, height: b.height }; item.remove(); return bounds;
}
export function combineShapes(scope: paper.PaperScope, shapes: VectorShape[], operation: BooleanOperation): VectorShape {
  if (shapes.length < 2) throw new Error("Select at least two closed shapes. Shift-click shapes or use the Layers panel.");
  const items = shapes.map((shape) => visiblePaperItem(scope, shape));
  try {
    for (const item of items) if (contours(item).some((path) => !path.closed || path.segments.length < 3)) throw new Error("Boolean operations need closed paths. Close each selected path first; open strokes cannot define an area.");
    let result = items[0].clone({ insert: false }) as paper.PathItem;
    for (let i = 1; i < items.length; i++) {
      const next = result[operation](items[i], { insert: false }); result.remove(); result = next;
    }
    result.reorient(true, true);
    const d = result.pathData; result.remove();
    if (!d) throw new Error("This operation creates an empty shape. Try overlapping the shapes or changing their order.");
    return createVectorShape(d, { ...shapes[0], id: vectorId(), endpoints: undefined, cornerRadius: undefined, name: { unite: "United shape", subtract: "Subtracted shape", intersect: "Intersection", exclude: "Excluded shape" }[operation], d });
  } finally { items.forEach((item) => item.remove()); }
}
export function closeShape(scope: paper.PaperScope, shape: VectorShape) {
  const item = paperItem(scope, shape); contours(item).forEach((path) => { path.closed = true; }); const result = { ...shape, ...serializeItem(item) }; item.remove(); return result;
}

/** Finish one pen contour without closing any other open parts of the icon. */
export function closeContour(scope: paper.PaperScope, shape: VectorShape, contour: number): VectorShape {
  const item = paperItem(scope, shape);
  try {
    const path = contours(item)[contour];
    if (!path || path.segments.length < 3) throw new Error("Add at least three anchors before closing this contour.");
    path.closed = true;
    return { ...shape, ...serializeItem(item) };
  } finally { item.remove(); }
}

/** Geometry stays in artboard coordinates. Strokes retain their chosen weight. */
export function transformShape(scope: paper.PaperScope, shape: VectorShape, matrix: VectorMatrix): VectorShape {
  const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty];
  if (values.some((value) => !Number.isFinite(value))) throw new Error("The transform must contain finite numbers.");
  const item = paperItem(scope, shape);
  try {
    item.transform(new scope.Matrix(values));
    return { ...shape, ...serializeItem(item) };
  } finally { item.remove(); }
}

export function selectionBounds(scope: paper.PaperScope, shapes: VectorShape[]): VectorBounds | null {
  if (!shapes.length) return null;
  const bounds = shapes.map((shape) => shapeBounds(scope, shape));
  const x = Math.min(...bounds.map((b) => b.x)), y = Math.min(...bounds.map((b) => b.y));
  return { x, y, width: Math.max(...bounds.map((b) => b.x + b.width)) - x, height: Math.max(...bounds.map((b) => b.y + b.height)) - y };
}

/** Apply a shared selection box to every shape, including mirrored drag boxes. */
export function resizeShape(scope: paper.PaperScope, shape: VectorShape, from: VectorBounds, to: VectorBounds): VectorShape {
  if ([...Object.values(from), ...Object.values(to)].some((value) => !Number.isFinite(value))) throw new Error("The resize bounds must contain finite numbers.");
  // A straight line has a zero-width or zero-height geometric box. Its other
  // dimension can still resize; the collapsed axis moves without dividing by 0.
  const a = Math.abs(from.width) > 1e-9 ? to.width / from.width : 1;
  const d = Math.abs(from.height) > 1e-9 ? to.height / from.height : 1;
  return transformShape(scope, shape, { a, b: 0, c: 0, d, tx: to.x - from.x * a, ty: to.y - from.y * d });
}

export function rotateShape(scope: paper.PaperScope, shape: VectorShape, degrees: number, center?: VectorPoint): VectorShape {
  const bounds = shapeBounds(scope, shape);
  const origin = center ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const radians = degrees * Math.PI / 180, a = Math.cos(radians), b = Math.sin(radians);
  return transformShape(scope, shape, { a, b, c: -b, d: a, tx: origin.x - a * origin.x + b * origin.y, ty: origin.y - b * origin.x - a * origin.y });
}

export function flipShape(scope: paper.PaperScope, shape: VectorShape, axis: "horizontal" | "vertical", center?: VectorPoint): VectorShape {
  const bounds = shapeBounds(scope, shape);
  const origin = center ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const a = axis === "horizontal" ? -1 : 1, d = axis === "vertical" ? -1 : 1;
  return transformShape(scope, shape, { a, b: 0, c: 0, d, tx: origin.x * (1 - a), ty: origin.y * (1 - d) });
}

export function nearestAnchor(scope: paper.PaperScope, shape: VectorShape, point: VectorPoint, maxDistance = Infinity): (VectorAnchor & { distance: number }) | null {
  let nearest: (VectorAnchor & { distance: number }) | null = null;
  for (const anchor of shapeAnchors(scope, shape)) {
    const distance = Math.hypot(point.x - anchor.point.x, point.y - anchor.point.y);
    if (distance <= maxDistance && (!nearest || distance < nearest.distance)) nearest = { ...anchor, distance };
  }
  return nearest;
}

export function nearestCurve(scope: paper.PaperScope, shape: VectorShape, point: VectorPoint, maxDistance = Infinity): (VectorCurveRef & { point: VectorPoint; distance: number; time: number }) | null {
  const item = paperItem(scope, shape);
  try {
    const paths = contours(item), location = item.getNearestLocation(new scope.Point(point.x, point.y));
    if (!location || location.distance > maxDistance) return null;
    return { contour: paths.indexOf(location.path), index: location.index, point: { x: location.point.x, y: location.point.y }, distance: location.distance, time: location.time };
  } finally { item.remove(); }
}

export function curveAnchorRefs(scope: paper.PaperScope, shape: VectorShape, ref: VectorCurveRef): VectorAnchorRef[] {
  const item = paperItem(scope, shape);
  try {
    const curve = contours(item)[ref.contour]?.curves[ref.index];
    return curve ? [{ contour: ref.contour, index: curve.segment1.index }, { contour: ref.contour, index: curve.segment2.index }] : [];
  } finally { item.remove(); }
}

/** A separate display path for an isolated curve; it never changes the source. */
export function curvePathData(scope: paper.PaperScope, shape: VectorShape, ref: VectorCurveRef): string | null {
  const item = paperItem(scope, shape);
  try {
    const curve = contours(item)[ref.contour]?.curves[ref.index];
    if (!curve) return null;
    const path = new scope.Path({ segments: [curve.segment1.clone(), curve.segment2.clone()], insert: false });
    try { return path.pathData; } finally { path.remove(); }
  } finally { item.remove(); }
}

export function translateAnchors(scope: paper.PaperScope, shape: VectorShape, refs: VectorAnchorRef[], delta: VectorPoint): VectorShape {
  if (![delta.x, delta.y].every(Number.isFinite)) throw new Error("Anchor movement must contain finite numbers.");
  const item = paperItem(scope, shape), paths = contours(item);
  try {
    const unique = new Set<string>();
    for (const ref of refs) {
      const key = `${ref.contour}:${ref.index}`, segment = paths[ref.contour]?.segments[ref.index];
      if (!segment || unique.has(key)) continue;
      unique.add(key); segment.point = segment.point.add(new scope.Point(delta.x, delta.y));
    }
    return { ...shape, ...serializeItem(item) };
  } finally { item.remove(); }
}

export function deleteAnchors(scope: paper.PaperScope, shape: VectorShape, refs: VectorAnchorRef[]): VectorShape {
  const item = paperItem(scope, shape), paths = [...contours(item)];
  try {
    // Snapshot contour references before deleting; sibling indices may change.
    paths.forEach((path, contour) => {
      const indices = [...new Set(refs.filter((ref) => ref.contour === contour).map((ref) => ref.index))].sort((a, b) => b - a);
      for (const index of indices) if (path.segments[index]) path.removeSegment(index);
      if (path.segments.length < 2) { path.removeSegments(); path.remove(); }
    });
    return { ...shape, ...serializeItem(item) };
  } finally { item.remove(); }
}

/** Reorders only contour storage so the selected open endpoint is the pen tip. */
export function continuePenPath(scope: paper.PaperScope, shape: VectorShape, ref: VectorAnchorRef): VectorShape {
  const item = paperItem(scope, shape), paths = contours(item), path = paths[ref.contour];
  try {
    if (!path || path.closed || !path.segments.length || (ref.index !== 0 && ref.index !== path.segments.length - 1)) throw new Error("Select an endpoint of an open path to continue drawing.");
    if (ref.index === 0) path.reverse();
    if (item.className === "CompoundPath") (item as paper.CompoundPath).insertChild(0, path);
    return { ...shape, ...serializeItem(item) };
  } finally { item.remove(); }
}

/** Cut at a node. Closed contours open; open contours become two editable paths. */
export function splitShapeAtAnchor(scope: paper.PaperScope, shape: VectorShape, ref: VectorAnchorRef): VectorShape[] {
  const item = paperItem(scope, shape), paths = contours(item), path = paths[ref.contour];
  let separate: paper.Path | undefined;
  try {
    if (!path?.segments[ref.index]) throw new Error("Select an anchor to split this path.");
    if (!path.closed && (ref.index === 0 || ref.index === path.segments.length - 1)) throw new Error("Choose an interior anchor to split an open path.");
    const segments = path.segments.map((segment) => segment.clone());
    if (path.closed) {
      const ordered = [...segments.slice(ref.index), ...segments.slice(0, ref.index), segments[ref.index].clone()];
      ordered[0].handleIn = new scope.Point(0, 0); ordered[ordered.length - 1].handleOut = new scope.Point(0, 0);
      path.removeSegments(); path.addSegments(ordered); path.closed = false;
      return [{ ...shape, ...serializeItem(item) }];
    }
    const left = segments.slice(0, ref.index + 1), right = segments.slice(ref.index).map((segment) => segment.clone());
    left[left.length - 1].handleOut = new scope.Point(0, 0); right[0].handleIn = new scope.Point(0, 0);
    path.removeSegments(); path.addSegments(left);
    separate = new scope.Path({ segments: right, insert: false });
    return [{ ...shape, ...serializeItem(item) }, { ...shape, id: vectorId(), name: `${shape.name} split`, ...serializeItem(separate) }];
  } finally { separate?.remove(); item.remove(); }
}

export function reverseShape(scope: paper.PaperScope, shape: VectorShape): VectorShape {
  const item = paperItem(scope, shape);
  try { contours(item).forEach((path) => path.reverse()); return { ...shape, ...serializeItem(item) }; }
  finally { item.remove(); }
}

/** Join exactly the two chosen endpoints, preserving all other contours. */
export function joinShapeEndpoints(scope: paper.PaperScope, firstShape: VectorShape, firstRef: VectorAnchorRef, secondShape: VectorShape, secondRef: VectorAnchorRef): VectorShape {
  const first = paperItem(scope, firstShape), second = firstShape.id === secondShape.id ? first : paperItem(scope, secondShape);
  const firstPaths = [...contours(first)], secondPaths = second === first ? firstPaths : [...contours(second)];
  const a = firstPaths[firstRef.contour], b = secondPaths[secondRef.contour];
  let joined: paper.CompoundPath | undefined;
  try {
    const endpoint = (path: paper.Path | undefined, ref: VectorAnchorRef) => path && !path.closed && path.segments.length > 1 && (ref.index === 0 || ref.index === path.segments.length - 1);
    if (!endpoint(a, firstRef) || !endpoint(b, secondRef)) throw new Error("Select two endpoints of open paths to join.");
    if (a === b) {
      if (firstRef.index === secondRef.index) throw new Error("Select two different endpoints to join.");
      if (a.firstSegment.point.equals(a.lastSegment.point)) {
        a.firstSegment.handleIn = a.lastSegment.handleIn.clone(); a.lastSegment.remove();
      } else { a.firstSegment.handleIn = new scope.Point(0, 0); a.lastSegment.handleOut = new scope.Point(0, 0); }
      a.closed = true;
      return { ...firstShape, ...serializeItem(first) };
    }
    if (firstRef.index === 0) a.reverse();
    if (secondRef.index !== 0) b.reverse();
    const additions = b.segments.map((segment) => segment.clone());
    if (a.lastSegment.point.equals(b.firstSegment.point)) {
      a.lastSegment.handleOut = additions[0].handleOut.clone(); additions.shift();
    } else { a.lastSegment.handleOut = new scope.Point(0, 0); additions[0].handleIn = new scope.Point(0, 0); }
    a.addSegments(additions);
    const allPaths = second === first ? firstPaths : [...firstPaths, ...secondPaths];
    joined = new scope.CompoundPath({ children: allPaths.filter((path) => path !== b).map((path) => path.clone({ insert: false })), insert: false });
    return { ...firstShape, ...serializeItem(joined) };
  } finally { joined?.remove(); first.remove(); if (second !== first) second.remove(); }
}

export type AnchorConnectionState = { allowed: boolean; kind: "join" | "close" | null; reason: string };
const visiblePaint = (paint: string) => !!paint && !["none", "transparent"].includes(paint.toLowerCase()) && !/^rgba\([^)]*,\s*0(?:\.0*)?\s*\)$/i.test(paint);
const visibleStroke = (shape: VectorShape) => visiblePaint(shape.stroke) && shape.strokeWidth > 0 && shape.opacity > 0;
const opaquePaint = (paint: string) => /^#[\da-f]{8}$/i.test(paint) ? paint.slice(-2).toLowerCase() === "ff" : /^#[\da-f]{4}$/i.test(paint) ? paint.slice(-1).toLowerCase() === "f" : /^(?:rgba|hsla)\(/i.test(paint) ? /,\s*1(?:\.0*)?\s*\)$/.test(paint) : !paint.includes("/");

/** Connect changes path topology; unsupported selections never get a separate line. */
export function anchorConnectionState(scope: paper.PaperScope, shapes: VectorShape[], selected: VectorAnchorSelection[]): AnchorConnectionState {
  const unavailable = (reason: string): AnchorConnectionState => ({ allowed: false, kind: null, reason });
  if (selected.length !== 2) return unavailable("Select two open endpoints to connect. Shift-click points or Cmd/Ctrl-drag a selection box.");
  const [firstRef, secondRef] = selected;
  const first = shapes.find(shape => shape.id === firstRef.id), second = shapes.find(shape => shape.id === secondRef.id);
  if (!first || !second) return unavailable("Select two anchors that are still in the artwork.");
  const firstAnchors = shapeAnchors(scope, first), secondAnchors = first === second ? firstAnchors : shapeAnchors(scope, second);
  const a = firstAnchors.find(anchor => anchor.contour === firstRef.contour && anchor.index === firstRef.index);
  const b = secondAnchors.find(anchor => anchor.contour === secondRef.contour && anchor.index === secondRef.index);
  if (!a || !b) return unavailable("Select two anchors that are still in the artwork.");
  const sameContour = first === second && a.contour === b.contour;
  const aCount = firstAnchors.filter(anchor => anchor.contour === a.contour).length;
  const bCount = secondAnchors.filter(anchor => anchor.contour === b.contour).length;
  if (sameContour && a.index === b.index) return unavailable("Select two different anchors.");
  if (a.closed || b.closed) return unavailable("Select endpoints of open paths. Cut the closed contour at an anchor first.");
  const endpoint = (anchor: VectorAnchor, count: number) => count > 1 && (anchor.index === 0 || anchor.index === count - 1);
  if (!endpoint(a, aCount) || !endpoint(b, bCount)) return unavailable("Select the first or last anchor of each open path. Cut at an interior anchor first.");
  if (sameContour) {
    // A straight two-point path already has this edge. A two-point curve can
    // legitimately close with a straight return edge (or merge a touching loop).
    if (aCount === 2) {
      const item = paperItem(scope, first);
      try { if (contours(item)[a.contour].curves[0].isStraight()) return unavailable("These anchors are already connected by a straight segment."); }
      finally { item.remove(); }
    }
    return { allowed: true, kind: "close", reason: "Close this open contour between the selected endpoints." };
  }
  const paintKeys = ["fill", "stroke", "strokeWidth", "opacity", "lineCap", "lineJoin", "fillRule", "dashArray", "dashOffset", "miterLimit", "cornerRadius"] as const;
  if (first !== second && !paintKeys.every(key => first[key] === second[key])) return unavailable("These paths have different styles. Match their fill, stroke, and corner settings before joining.");
  if (visibleStroke(first) && first.dashArray && first.dashArray !== "none") return unavailable("Joining would shift the dash pattern. Use solid strokes before joining these contours.");
  if (first !== second) {
    if (Math.abs(shapes.indexOf(first) - shapes.indexOf(second)) !== 1) return unavailable("Move these paths next to each other in the Layers list before joining, so other artwork keeps its layer order.");
    if (first.opacity !== 1 || (visiblePaint(first.fill) && !opaquePaint(first.fill)) || (visibleStroke(first) && !opaquePaint(first.stroke))) return unavailable("Joining separate transparent paths would change their overlapping appearance. Use opaque matching styles first.");
  }
  return { allowed: true, kind: "join", reason: visiblePaint(first.fill) ? "Join these endpoints into one editable contour. Its shared fill follows the joined outline." : "Join these open endpoints into one editable contour." };
}

/** Join or close exactly the selected open endpoints as one undoable change. */
export function connectAnchors(scope: paper.PaperScope, document: VectorDocument, selected: VectorAnchorSelection[]): { document: VectorDocument; selectedIds: string[]; kind: "join" | "close" } {
  const state = anchorConnectionState(scope, document.shapes, selected);
  if (!state.allowed || !state.kind) throw new Error(state.reason);
  const [firstRef, secondRef] = selected;
  const first = document.shapes.find(shape => shape.id === firstRef.id)!;
  const second = document.shapes.find(shape => shape.id === secondRef.id)!;
  const joined = joinShapeEndpoints(scope, first, firstRef, second, secondRef);
  const last = Math.max(document.shapes.indexOf(first), document.shapes.indexOf(second));
  const shapes = document.shapes.flatMap((shape, index) => index === last ? [joined] : shape.id === first.id || shape.id === second.id ? [] : [shape]);
  return { document: { ...document, shapes }, selectedIds: [joined.id], kind: state.kind };
}

/** Compound paths intentionally share the backmost path's paint and use holes. */
export function makeCompoundShape(scope: paper.PaperScope, shapes: VectorShape[]): VectorShape {
  if (shapes.length < 2) throw new Error("Select at least two shapes to make a compound path.");
  const items = shapes.map((shape) => visiblePaperItem(scope, shape));
  const compound = new scope.CompoundPath({ children: items.flatMap((item) => contours(item).map((path) => path.clone({ insert: false }))), insert: false });
  try { return { ...shapes[0], ...serializeItem(compound), cornerRadius: undefined, id: vectorId(), name: "Compound path", fillRule: "evenodd" }; }
  finally { compound.remove(); items.forEach((item) => item.remove()); }
}

export function releaseCompoundShape(scope: paper.PaperScope, shape: VectorShape): VectorShape[] {
  const item = paperItem(scope, shape);
  try {
    const paths = contours(item);
    if (paths.length < 2) throw new Error("This shape has only one contour.");
    return paths.map((path, index) => ({ ...shape, ...serializeItem(path), id: vectorId(), name: `${shape.name} ${index + 1}` }));
  } finally { item.remove(); }
}

/** Partition closed artwork at every overlap. Later shapes are in front. */
export function divideShapes(scope: paper.PaperScope, shapes: VectorShape[]): VectorShape[] {
  if (shapes.length < 2) throw new Error("Select at least two closed shapes to divide.");
  const allocated = new Set<paper.PathItem>();
  const track = (item: paper.PathItem) => { allocated.add(item); return item; };
  const hasArea = (item: paper.PathItem) => Math.abs((item as paper.Path | paper.CompoundPath).area) > 1e-9;
  let pieces: { item: paper.PathItem; style: VectorShape }[] = [];
  try {
    for (const shape of shapes) {
      const original = track(visiblePaperItem(scope, shape));
      if (contours(original).some((path) => !path.closed || path.segments.length < 3)) throw new Error("Divide needs closed paths. Close each selected path first.");
      // Resolve self intersections and even-odd contours before measuring area.
      let uncovered = track(original.unite(original, { insert: false }));
      const next: typeof pieces = [];
      for (const piece of pieces) {
        const outside = track(piece.item.subtract(original, { insert: false }));
        const overlap = track(piece.item.intersect(original, { insert: false }));
        if (hasArea(outside)) next.push({ item: outside, style: piece.style });
        if (hasArea(overlap)) next.push({ item: overlap, style: shape });
        uncovered = track(uncovered.subtract(piece.item, { insert: false }));
      }
      if (hasArea(uncovered)) next.push({ item: uncovered, style: shape });
      pieces = next;
    }
    if (!pieces.length) throw new Error("These paths contain no filled area to divide.");
    return pieces.map(({ item, style }, index) => {
      item.reorient(true, true);
      return { ...style, ...serializeItem(item), cornerRadius: undefined, id: vectorId(), name: `Divided shape ${index + 1}`, fillRule: "nonzero" };
    });
  } finally { allocated.forEach((item) => item.remove()); }
}
