import type { Candidate, IconItem, Standards } from "./icon-types";
import { refreshSvgJunctionCaps } from "./svg-junction-caps.ts";
import { allocatePaletteColors, getPalette } from "./color-palette.ts";

export const DEFAULT_STANDARDS: Standards = {
  style: "line",
  perspective: "front",
  colorMode: "mono",
  proportion: "square",
  constructionGrid: "keyline",
  strokeWidth: 1.75,
  minSpacing: 1,
  gridSize: 24,
  corner: "round",
  cornerRadius: 1,
  primaryColor: "#252331",
  secondaryColor: "#b9a2ea",
  padding: 2,
};

/** Saved duotone workspaces remain dual-color until they adopt the separate color setting. */
export function effectiveColorMode(standards: Pick<Standards, "style" | "colorMode">): "mono" | "duo" | "color" {
  return standards.colorMode ?? (standards.style === "duotone" ? "duo" : "mono");
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const DRAWING_TAGS = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const ALLOWED_TAGS = new Set([...DRAWING_TAGS, "svg", "g", "title", "desc", "defs", "clipPath", "mask", "linearGradient", "radialGradient", "stop"]);
const PRESENTATION_ATTRS = new Set(["id", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "fill-rule", "clip-rule", "opacity", "fill-opacity", "stroke-opacity", "transform", "clip-path", "mask", "vector-effect"]);
const TAG_ATTRS: Record<string, Set<string>> = Object.fromEntries(Object.entries({
  svg: ["xmlns", "xmlns:xlink", "viewBox", "width", "height", "preserveAspectRatio", "role", "aria-label", "aria-hidden", "focusable", "data-iconify-source-viewbox", "data-iconify-junctions"],
  g: ["data-iconify-fit", "data-iconify-canvas"], path: ["d", "pathLength", "data-iconify-base-path", "data-iconify-corner-radius", "data-iconify-junction-cap"], rect: ["x", "y", "width", "height", "rx", "ry", "pathLength"],
  circle: ["cx", "cy", "r", "pathLength"], ellipse: ["cx", "cy", "rx", "ry", "pathLength"],
  line: ["x1", "y1", "x2", "y2", "pathLength"], polyline: ["points", "pathLength"], polygon: ["points", "pathLength"],
  title: [], desc: [], defs: [], clipPath: ["clipPathUnits"],
  mask: ["x", "y", "width", "height", "maskUnits", "maskContentUnits", "mask-type"],
  linearGradient: ["x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod", "href", "xlink:href"],
  radialGradient: ["cx", "cy", "r", "fx", "fy", "fr", "gradientUnits", "gradientTransform", "spreadMethod", "href", "xlink:href"],
  stop: ["offset", "stop-color", "stop-opacity"],
}).map(([tag, attributes]) => [tag, new Set(attributes)]));
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const COLOR_PATTERN = /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|none|currentColor|transparent|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\))$/i;
const NUMBER_ATTRS = new Set(["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "width", "height", "stroke-width", "stroke-miterlimit", "stroke-dashoffset", "pathLength", "offset"]);
const ENUM_ATTRS: Record<string, string[]> = {
  "stroke-linecap": ["butt", "round", "square"], "stroke-linejoin": ["miter", "round", "bevel"],
  "fill-rule": ["nonzero", "evenodd"], "clip-rule": ["nonzero", "evenodd"],
  "vector-effect": ["none", "non-scaling-stroke"], "gradientUnits": ["userSpaceOnUse", "objectBoundingBox"],
  "clipPathUnits": ["userSpaceOnUse", "objectBoundingBox"], "maskUnits": ["userSpaceOnUse", "objectBoundingBox"],
  "maskContentUnits": ["userSpaceOnUse", "objectBoundingBox"], "spreadMethod": ["pad", "reflect", "repeat"],
  "mask-type": ["luminance", "alpha"],
};

function stableHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function round(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

function numbers(value: string): number[] {
  const pieces = value.trim().split(/[\s,]+/).filter(Boolean);
  if (!pieces.length || pieces.some((part) => !NUMBER_PATTERN.test(part))) throw new Error("SVG contains an invalid numeric value.");
  const parsed = pieces.map(Number);
  if (parsed.some((number) => !Number.isFinite(number) || Math.abs(number) > 1e7)) throw new Error("SVG coordinates are outside the supported range.");
  return parsed;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function transformMatrix(value: string | null): Matrix {
  if (!value?.trim()) return [...IDENTITY];
  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let matrix = [...IDENTITY] as Matrix;
  let end = 0;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(value))) {
    if (value.slice(end, match.index).replace(/[\s,]/g, "")) throw new Error("Unsupported SVG transform.");
    const args = numbers(match[2]);
    let next: Matrix;
    const angle = args[0] * Math.PI / 180;
    switch (match[1]) {
      case "matrix":
        if (args.length !== 6) throw new Error("Invalid SVG matrix.");
        next = args as Matrix;
        break;
      case "translate":
        if (args.length < 1 || args.length > 2) throw new Error("Invalid SVG translation.");
        next = [1, 0, 0, 1, args[0], args[1] ?? 0];
        break;
      case "scale":
        if (args.length < 1 || args.length > 2) throw new Error("Invalid SVG scale.");
        next = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
        break;
      case "rotate": {
        if (![1, 3].includes(args.length)) throw new Error("Invalid SVG rotation.");
        next = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
        if (args.length === 3) next = multiply(multiply([1, 0, 0, 1, args[1], args[2]], next), [1, 0, 0, 1, -args[1], -args[2]]);
        break;
      }
      case "skewX":
      case "skewY":
        if (args.length !== 1 || Math.abs(Math.cos(angle)) < 0.00001) throw new Error("Invalid SVG skew.");
        next = match[1] === "skewX" ? [1, 0, Math.tan(angle), 1, 0, 0] : [1, Math.tan(angle), 0, 1, 0, 0];
        break;
      default: throw new Error("Unsupported SVG transform.");
    }
    matrix = multiply(matrix, next);
    if (matrix.some((part) => !Number.isFinite(part) || Math.abs(part) > 1e9)) throw new Error("SVG transform is outside the supported range.");
    end = expression.lastIndex;
  }
  if (!end || value.slice(end).replace(/[\s,]/g, "")) throw new Error("Unsupported SVG transform.");
  return matrix;
}

function getParser(): DOMParser {
  if (typeof DOMParser === "undefined") throw new Error("SVG processing is available in the browser. Please open Iconoclast.ai to process your icons.");
  return new DOMParser();
}

function serialize(element: Element): string {
  return new XMLSerializer().serializeToString(element);
}

function validatePath(data: string): number {
  if (!data.trim()) return 0;
  if (data.length > 100_000 || !/^[MmZzLlHhVvCcSsQqTtAaEe\d+.,\s-]*$/.test(data)) throw new Error("SVG contains invalid or excessively complex path data.");
  const tokens = data.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
  if (!/^[Mm]$/.test(tokens[0] ?? "")) throw new Error("SVG paths must begin with a move command.");
  const arities: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };
  let index = 0;
  let segments = 0;
  while (index < tokens.length) {
    const command = tokens[index++].toLowerCase();
    if (command === "z") continue;
    const arity = arities[command];
    if (!arity) throw new Error("SVG path contains an unsupported command.");
    const values: number[] = [];
    while (index < tokens.length && !/^[a-zA-Z]$/.test(tokens[index])) {
      const value = Number(tokens[index++]);
      if (!Number.isFinite(value) || Math.abs(value) > 1e7) throw new Error("SVG path coordinates are outside the supported range.");
      values.push(value);
    }
    if (!values.length || values.length % arity !== 0) throw new Error("SVG path has an incomplete command.");
    if (command === "a") {
      for (let offset = 0; offset < values.length; offset += 7) {
        if (values[offset] < 0 || values[offset + 1] < 0 || ![0, 1].includes(values[offset + 3]) || ![0, 1].includes(values[offset + 4])) throw new Error("SVG path has invalid arc parameters.");
      }
    }
    segments += values.length / arity - (command === "m" ? 1 : 0);
  }
  return segments;
}

function hasDrawing(element: Element): boolean {
  const number = (name: string) => Number(element.getAttribute(name) ?? 0);
  switch (element.localName) {
    case "path": return validatePath(element.getAttribute("d") ?? "") > 0;
    case "rect": return number("width") > 0 && number("height") > 0;
    case "circle": return number("r") > 0;
    case "ellipse": return number("rx") > 0 && number("ry") > 0;
    case "line": return number("x1") !== number("x2") || number("y1") !== number("y2");
    case "polygon": case "polyline": return (element.getAttribute("points")?.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.length ?? 0) >= 4;
    default: return false;
  }
}

function isInsideDefinition(element: Element): boolean {
  let parent = element.parentElement;
  while (parent) {
    if (["defs", "clipPath", "mask", "linearGradient", "radialGradient", "title", "desc"].includes(parent.localName)) return true;
    parent = parent.parentElement;
  }
  return false;
}

/** Parse a deliberately small SVG subset. Active content is rejected, never executed. */
export function sanitizeSvg(raw: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("This file does not contain an SVG.");
  if (new TextEncoder().encode(raw).length > 500_000) throw new Error("Each SVG must be smaller than 500 KB.");
  if (/<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)/i.test(raw)) throw new Error("SVG documents with entities or processing instructions are not supported.");
  const document = getParser().parseFromString(raw.trim(), "image/svg+xml");
  const root = document.documentElement;
  if (document.querySelector("parsererror") || root.localName !== "svg") throw new Error("This is not a valid SVG file.");
  if (root.namespaceURI && root.namespaceURI !== SVG_NS) throw new Error("This file uses an unsupported SVG namespace.");
  const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
  if (nodes.length > 1500) throw new Error("This SVG is too complex. Use an icon with fewer than 1,500 elements.");
  const ids = new Set<string>();
  const references: string[] = [];
  for (const node of nodes) {
    const tag = node.localName;
    if (!ALLOWED_TAGS.has(tag) || (node !== root && tag === "svg")) throw new Error(`Unsupported SVG element: ${tag}. Use vector shapes and paths.`);
    if (["title", "desc", "stop"].includes(tag) && node.children.length) throw new Error(`SVG ${tag} cannot contain nested elements.`);
    if (node.namespaceURI && node.namespaceURI !== SVG_NS) throw new Error("Non-SVG elements are not allowed.");
    if (node.prefix) throw new Error("Prefixed SVG elements are not supported.");
    const hasBasePath = node.hasAttribute("data-iconify-base-path");
    const hasCornerRadius = node.hasAttribute("data-iconify-corner-radius");
    if ((hasBasePath || hasCornerRadius) && (tag !== "path" || !hasBasePath || !hasCornerRadius)) {
      throw new Error("Iconoclast.ai live-corner metadata requires both a base path and a corner radius on a path element.");
    }
    for (const attribute of Array.from(node.attributes)) {
      const { name, value } = attribute;
      if (/^on/i.test(name) || name.toLowerCase() === "style") throw new Error("SVG scripts, event handlers, and inline styles are not allowed. Export presentation attributes instead.");
      if (!PRESENTATION_ATTRS.has(name) && !TAG_ATTRS[tag].has(name)) {
        if (/^(?:data-|aria-)/.test(name) || ["class", "version", "baseProfile", "enable-background"].includes(name)) {
          node.removeAttribute(name);
          continue;
        }
        throw new Error(`Unsupported SVG attribute: ${name}.`);
      }
      if (name === "xmlns" && value !== SVG_NS) throw new Error("Unsupported SVG namespace.");
      if (name === "xmlns:xlink" && value !== XLINK_NS) throw new Error("Unsupported SVG link namespace.");
      if (name === "id") {
        if (!/^[a-zA-Z_][\w.:-]*$/.test(value) || ids.has(value)) throw new Error("SVG IDs must be unique, simple identifiers.");
        ids.add(value);
      }
      if (["href", "xlink:href"].includes(name)) {
        if (!/^#[a-zA-Z_][\w.:-]*$/.test(value)) throw new Error("External references are not allowed in icons.");
        references.push(value.slice(1));
      }
      if (["fill", "stroke", "stop-color"].includes(name)) {
        const local = value.match(/^url\(\s*#([a-zA-Z_][\w.:-]*)\s*\)$/);
        if (local) references.push(local[1]);
        else if (!COLOR_PATTERN.test(value.trim())) throw new Error("SVG contains an unsupported color or an external paint reference.");
      }
      if (["clip-path", "mask"].includes(name) && value !== "none") {
        const local = value.match(/^url\(\s*#([a-zA-Z_][\w.:-]*)\s*\)$/);
        if (!local) throw new Error("Only references inside the same SVG are supported.");
        references.push(local[1]);
      }
      if (NUMBER_ATTRS.has(name)) {
        const bare = value.replace(/(?:px|%)$/, "");
        const parsed = numbers(bare);
        if (parsed.length !== 1) throw new Error(`Invalid ${name} value.`);
        if (["r", "rx", "ry", "width", "height", "stroke-width", "pathLength"].includes(name) && parsed[0] < 0) throw new Error(`SVG ${name} cannot be negative.`);
      }
      if (["opacity", "fill-opacity", "stroke-opacity", "stop-opacity"].includes(name)) {
        const parsed = numbers(value);
        if (parsed.length !== 1 || parsed[0] < 0 || parsed[0] > 1) throw new Error("SVG opacity must be between 0 and 1.");
      }
      if (["data-iconify-fit", "data-iconify-canvas", "data-iconify-junction-cap", "data-iconify-junctions"].includes(name) && value !== "1") throw new Error("Invalid Iconoclast.ai fitting metadata.");
      if (name === "data-iconify-base-path" && validatePath(value) === 0) throw new Error("Iconoclast.ai live-corner metadata requires a drawable base path.");
      if (name === "data-iconify-corner-radius") {
        const radius = Number(value.trim());
        if (!NUMBER_PATTERN.test(value.trim()) || !Number.isFinite(radius) || radius < 0 || radius > 10000) {
          throw new Error("Iconoclast.ai corner radius must be a number between 0 and 10000 without units.");
        }
      }
      if (name === "viewBox" || name === "data-iconify-source-viewbox") {
        const parsed = numbers(value);
        if (parsed.length !== 4 || parsed[2] <= 0 || parsed[3] <= 0) throw new Error("SVG viewBox must have a positive width and height.");
      }
      if (name === "points") {
        const parsed = numbers(value);
        if (parsed.length % 2 !== 0) throw new Error("SVG points must contain coordinate pairs.");
      }
      if (name === "stroke-dasharray" && value !== "none" && numbers(value).some((number) => number < 0)) throw new Error("SVG dash lengths cannot be negative.");
      if (name === "d") validatePath(value);
      if (["transform", "gradientTransform"].includes(name)) transformMatrix(value);
      if (ENUM_ATTRS[name] && !ENUM_ATTRS[name].includes(value)) throw new Error(`Unsupported SVG ${name} value.`);
      if (name === "preserveAspectRatio" && !/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value)) throw new Error("Unsupported SVG aspect ratio setting.");
    }
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) child.remove();
      if ((child.nodeType === 3 || child.nodeType === 4) && !["title", "desc"].includes(tag)) {
        if (child.textContent?.trim()) throw new Error("Text-based icons are not supported. Outline text before importing.");
        child.remove();
      }
    }
  }
  if (references.some((id) => !ids.has(id))) throw new Error("SVG contains a reference to a missing shape or paint.");
  if (!nodes.some((node) => DRAWING_TAGS.has(node.localName) && !isInsideDefinition(node) && hasDrawing(node))) throw new Error("This SVG has no drawable icon shapes.");
  if (!root.hasAttribute("viewBox")) {
    const width = Number(root.getAttribute("width")?.replace(/px$/, ""));
    const height = Number(root.getAttribute("height")?.replace(/px$/, ""));
    if (!(width > 0 && height > 0)) throw new Error("Add a viewBox or numeric width and height to this SVG before importing.");
    root.setAttribute("viewBox", `0 0 ${round(width)} ${round(height)}`);
  }
  root.setAttribute("xmlns", SVG_NS);
  return serialize(root);
}

function parseSafe(raw: string): SVGSVGElement {
  return getParser().parseFromString(sanitizeSvg(raw), "image/svg+xml").documentElement as unknown as SVGSVGElement;
}

function validateStandards(standards: Standards): Standards {
  if (!["line", "filled", "combined", "both", "duotone"].includes(standards.style)) throw new Error("Choose a supported icon style.");
  if (standards.perspective !== undefined && !["front", "isometric"].includes(standards.perspective)) throw new Error("Choose face-on or isometric perspective.");
  if (standards.colorMode !== undefined && !["mono", "duo", "color"].includes(standards.colorMode)) throw new Error("Choose monochrome or color.");
  if (standards.proportion !== undefined && !["natural", "square"].includes(standards.proportion)) throw new Error("Choose natural or square proportions.");
  if (standards.constructionGrid !== undefined && !["none", "keyline", "concentric"].includes(standards.constructionGrid)) throw new Error("Choose a supported construction grid.");
  if (!["round", "square"].includes(standards.corner)) throw new Error("Choose round or square corners.");
  if (!Number.isFinite(standards.gridSize) || standards.gridSize < 8 || standards.gridSize > 256) throw new Error("Icon grids must be between 8 and 256 pixels.");
  if (!Number.isFinite(standards.strokeWidth) || standards.strokeWidth < 0.25 || standards.strokeWidth > 12) throw new Error("Line weight must be between 0.25 and 12 pixels.");
  if (standards.strokeWidth >= standards.gridSize) throw new Error("Line weight must be smaller than the icon grid.");
  if (!Number.isFinite(standards.padding) || standards.padding < 0 || standards.padding >= standards.gridSize / 2) throw new Error("Padding must leave room for the icon inside its grid.");
  for (const color of [standards.primaryColor, standards.secondaryColor]) {
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error("Use six-digit hex colors for your icon standards.");
  }
  getPalette(standards);
  return standards;
}

function inherited(element: Element, attribute: string, fallback: string): string {
  let node: Element | null = element;
  while (node) {
    const value = node.getAttribute(attribute);
    if (value !== null) return value;
    node = node.parentElement;
  }
  return fallback;
}

function effectiveMatrix(element: Element): Matrix {
  const ancestors: Element[] = [];
  let node: Element | null = element;
  while (node) { ancestors.unshift(node); node = node.parentElement; }
  return ancestors.reduce((matrix, ancestor) => multiply(matrix, transformMatrix(ancestor.getAttribute("transform"))), [...IDENTITY] as Matrix);
}

function matrixScale(matrix: Matrix): number {
  return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
}

/** Change only already-painted strokes; never add outlines to filled artwork or alter paths.
 * Transform compensation keeps the requested width in the SVG's viewBox units.
 */
export function updateSvgStrokeWidth(raw: string, width: number): string {
  if (!Number.isFinite(width) || width < 0.25 || width > 12) throw new Error("Stroke width must be between 0.25 and 12.");
  const root = parseSafe(raw);
  let changed = false;
  for (const node of Array.from(root.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon"))) {
    if (isInsideDefinition(node)) continue;
    const stroke = inherited(node, "stroke", "none").trim().toLowerCase();
    if (["none", "transparent"].includes(stroke) || Number(inherited(node, "stroke-opacity", "1")) === 0 || Number(inherited(node, "stroke-width", "1")) === 0) continue;
    const scale = node.getAttribute("vector-effect") === "non-scaling-stroke" ? 1 : matrixScale(effectiveMatrix(node));
    if (!Number.isFinite(scale) || scale < 0.00001) continue;
    const next = round(width / scale);
    if (node.getAttribute("stroke-width") !== next) { node.setAttribute("stroke-width", next); changed = true; }
  }
  return changed ? refreshSvgJunctionCaps(serialize(root)) : raw;
}

/** Resize the actual SVG artboard, keeping its geometry proportional and centered.
 * A supplied stroke width is measured in the new artboard's units, independently
 * of the geometry resize. Source strings and live-corner construction paths stay intact.
 */
export function updateSvgCanvasSize(raw: string, size: number, strokeWidth?: number): string {
  if (!Number.isInteger(size) || size < 8 || size > 256) throw new Error("Icon grids must contain between 8 and 256 whole cells.");
  const root = parseSafe(raw);
  const [minX, minY, width, height] = numbers(root.getAttribute("viewBox")!);
  if (minX !== 0 || minY !== 0 || width !== size || height !== size) {
    const scale = Math.min(size / width, size / height);
    const resize: Matrix = [scale, 0, 0, scale, (size - width * scale) / 2 - minX * scale, (size - height * scale) / 2 - minY * scale];
    const originalTransform = transformMatrix(root.getAttribute("transform"));
    const existing = root.children.length === 1 && root.firstElementChild?.localName === "g"
      && (root.firstElementChild.getAttribute("data-iconify-canvas") === "1" || root.firstElementChild.getAttribute("data-iconify-fit") === "1")
      ? root.firstElementChild : null;
    const wrapper = existing ?? root.ownerDocument.createElementNS(SVG_NS, "g");
    const matrix = multiply(multiply(resize, originalTransform), transformMatrix(wrapper.getAttribute("transform")));
    // Reuse our own fitting wrapper so repeated grid changes do not add nesting.
    wrapper.setAttribute("transform", `matrix(${matrix.map(round).join(" ")})`);
    if (!existing) {
      wrapper.setAttribute("data-iconify-canvas", "1");
      while (root.firstChild) wrapper.appendChild(root.firstChild);
      root.appendChild(wrapper);
    }
    root.removeAttribute("transform");
  }
  root.setAttribute("viewBox", `0 0 ${size} ${size}`);
  root.setAttribute("width", String(size));
  root.setAttribute("height", String(size));
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const resized = serialize(root);
  return strokeWidth === undefined ? resized : updateSvgStrokeWidth(resized, strokeWidth);
}

function isClosedShape(element: Element): boolean {
  if (["rect", "circle", "ellipse", "polygon"].includes(element.localName)) return true;
  if (element.localName !== "path") return false;
  const data = element.getAttribute("d") ?? "";
  // A mixed path may contain open detail strokes. Keep it stroked to avoid closing those details.
  const subpaths = data.split(/[Mm]/).slice(1).filter((part) => part.trim());
  return subpaths.length > 0 && subpaths.every((part) => /[zZ]\s*$/.test(part));
}

/** Adjust spacing, palette, and stroke treatment without inventing new geometry or tracing filled contours. */
export function normalizeSvg(raw: string, requested: Standards): string {
  const standards = validateStandards(requested);
  const root = parseSafe(raw);
  // Unwrap an earlier fit before applying another one. Repeated standards changes must
  // not compound padding or shrink the icon a little further with each click.
  const previousBox = root.getAttribute("data-iconify-source-viewbox");
  const previousFit = root.children.length === 1 && root.firstElementChild?.getAttribute("data-iconify-fit") === "1" ? root.firstElementChild : null;
  if (previousBox && previousFit) {
    while (previousFit.firstChild) root.insertBefore(previousFit.firstChild, previousFit);
    previousFit.remove();
    root.setAttribute("viewBox", previousBox);
  }
  const [minX, minY, width, height] = numbers(root.getAttribute("viewBox")!);
  root.setAttribute("data-iconify-source-viewbox", `${minX} ${minY} ${width} ${height}`);
  const geometry = Array.from(root.querySelectorAll("*")).filter((node) => DRAWING_TAGS.has(node.localName) && !isInsideDefinition(node));
  // Capture inherited paint before removing group styles. A filled contour is already the
  // visible silhouette: giving it fill="none" and a stroke creates an unwanted double outline.
  // Converting that silhouette into a real centerline requires a deliberate redraw.
  const paintRoles = geometry.map((node) => {
    const fill = inherited(node, "fill", "black");
    const stroke = inherited(node, "stroke", "none");
    const filled = !["none", "transparent"].includes(fill) && node.localName !== "line";
    const stroked = !["none", "transparent"].includes(stroke);
    return { node, filled, stroked };
  });
  const hasStrokes = paintRoles.some(({ stroked }) => stroked);
  // A zero-padding icon still needs room for the outward half of its edge strokes.
  const inset = Math.max(standards.padding, hasStrokes ? standards.strokeWidth / 2 : 0);
  const available = standards.gridSize - inset * 2;
  const scale = Math.min(available / width, available / height);
  const x = (standards.gridSize - width * scale) / 2 - minX * scale;
  const y = (standards.gridSize - height * scale) / 2 - minY * scale;
  const weights = paintRoles.map((role) => {
    const total = matrixScale(effectiveMatrix(role.node)) * scale;
    return { ...role, weight: standards.strokeWidth / (total || scale), total };
  });
  // Remove inherited paints and weight declarations only on visible artwork. Definition paints
  // remain untouched: changing a mask's black/white values would change the shape itself.
  for (const node of [root, ...Array.from(root.querySelectorAll("g"))]) {
    if (isInsideDefinition(node)) continue;
    for (const attribute of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "vector-effect"]) node.removeAttribute(attribute);
  }
  for (const { node, weight, total, filled, stroked } of weights) {
    node.setAttribute("fill", filled ? effectiveColorMode(standards) === "duo" ? standards.secondaryColor : standards.primaryColor : "none");
    node.setAttribute("stroke", stroked ? standards.primaryColor : "none");
    node.setAttribute("stroke-width", round(weight));
    node.setAttribute("stroke-linecap", standards.corner === "round" ? "round" : "square");
    node.setAttribute("stroke-linejoin", standards.corner === "round" ? "round" : "miter");
    node.removeAttribute("vector-effect");
    if (node.localName === "rect") {
      const radius = standards.corner === "round" ? Math.min(0.75 / (total || scale), Number(node.getAttribute("width") ?? 0) / 4, Number(node.getAttribute("height") ?? 0) / 4) : 0;
      node.setAttribute("rx", round(radius));
      node.setAttribute("ry", round(radius));
    }
  }
  const wrapper = root.ownerDocument.createElementNS(SVG_NS, "g");
  wrapper.setAttribute("data-iconify-fit", "1");
  wrapper.setAttribute("transform", `translate(${round(x)} ${round(y)}) scale(${round(scale)})`);
  // A transform on the SVG root belongs inside the new grid-fitting group.
  const rootTransform = root.getAttribute("transform");
  if (rootTransform) {
    const originalGroup = root.ownerDocument.createElementNS(SVG_NS, "g");
    originalGroup.setAttribute("transform", rootTransform);
    while (root.firstChild) originalGroup.appendChild(root.firstChild);
    wrapper.appendChild(originalGroup);
    root.removeAttribute("transform");
  } else {
    while (root.firstChild) wrapper.appendChild(root.firstChild);
  }
  root.appendChild(wrapper);
  root.setAttribute("viewBox", `0 0 ${standards.gridSize} ${standards.gridSize}`);
  root.setAttribute("width", String(standards.gridSize));
  root.setAttribute("height", String(standards.gridSize));
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const output = serialize(root);
  return effectiveColorMode(standards) === "color" || standards.palette ? recolorSvg(output, standards) : output;
}

/** Geometric paint estimate for whole-shape color allocation. It deliberately
 * does not claim pixel-exact coverage: overlap, clipping and holes can alter area.
 * Native path measurements improve the estimate when the browser supports them. */
function paintWeight(tag: string, attr: (name: string) => string | null, paint: "fill" | "stroke", native?: SVGGeometryElement): number {
  const n = (name: string) => Number.parseFloat(attr(name) ?? "0") || 0;
  let area = 0, length = 0;
  switch (tag) {
    case "rect": area = n("width") * n("height"); length = 2 * (n("width") + n("height")); break;
    case "circle": area = Math.PI * n("r") ** 2; length = 2 * Math.PI * n("r"); break;
    case "ellipse": {
      const rx = n("rx"), ry = n("ry");
      area = Math.PI * rx * ry; length = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))); break;
    }
    case "line": length = Math.hypot(n("x2") - n("x1"), n("y2") - n("y1")); break;
    case "polyline": case "polygon": {
      const values = (attr("points")?.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
      for (let index = 0; index + 3 < values.length; index += 2) length += Math.hypot(values[index + 2] - values[index], values[index + 3] - values[index + 1]);
      for (let index = 0; index < values.length; index += 2) {
        const next = (index + 2) % values.length;
        area += values[index] * values[next + 1] - values[next] * values[index + 1];
      }
      area = Math.abs(area) / 2;
      if (tag === "polygon" && values.length >= 4) length += Math.hypot(values[0] - values[values.length - 2], values[1] - values[values.length - 1]);
      break;
    }
    case "path": {
      try {
        length = native?.getTotalLength?.() ?? 0;
        const box = native?.getBBox?.();
        if (box) area = box.width * box.height;
      } catch { /* Detached paths have no measurements in some browsers. */ }
      // A bounded fallback keeps DOM-free demo creation deterministic.
      const values = (attr("d")?.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
      if (!length) length = Math.max(1, values.length / 2);
      if (!area) area = Math.max(1, length);
      break;
    }
  }
  return Math.max(0.0001, paint === "fill" ? area : length * Math.max(0, Number.parseFloat(attr("stroke-width") ?? "1") || 0));
}

function paintOpacity(node: Element, paint: "fill" | "stroke"): number {
  let opacity = Number(inherited(node, `${paint}-opacity`, "1"));
  for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) opacity *= Number(ancestor.getAttribute("opacity") ?? "1");
  return opacity;
}

/** Recolor simple vector paints without changing paths, fits, corner geometry, or opacity.
 * White cutouts in multicolor art and all definition paints (including masks) stay intact.
 * Complex paints are rejected because flattening them could change the drawing itself.
 */
export function recolorSvg(raw: string, requested: Standards): string {
  const standards = validateStandards(requested);
  const root = parseSafe(raw);
  const shapes = Array.from(root.querySelectorAll("*")).filter((node) => DRAWING_TAGS.has(node.localName) && !isInsideDefinition(node));
  const paints = shapes.map((node) => ({ node, fill: inherited(node, "fill", "black"), stroke: inherited(node, "stroke", "none") }));
  const noPaint = (paint: string) => ["none", "transparent"].includes(paint.trim().toLowerCase());
  const visible = paints.flatMap(({ fill, stroke }) => [fill, stroke]).filter((paint) => !noPaint(paint));
  if (visible.some((paint) => !/^(?:#[\da-f]{3}|#[\da-f]{6}|[a-z]+)$/i.test(paint.trim()))) {
    throw new Error("This icon uses complex paints. Use AI redesign to change its palette without damaging gradients or transparency.");
  }
  const canonical = (paint: string) => {
    const lower = paint.trim().toLowerCase();
    if (/^#[\da-f]{3}$/.test(lower)) return `#${lower.slice(1).split("").map((part) => part + part).join("")}`;
    if (lower === "black") return "#000000";
    if (lower === "white") return "#ffffff";
    return lower;
  };
  const preserveWhite = visible.some((paint) => canonical(paint) !== "#ffffff");
  const palette = getPalette(standards);
  if (effectiveColorMode(standards) === "color" || standards.palette && effectiveColorMode(standards) !== "mono") {
    const groups: { node: Element; attributes: ("fill" | "stroke")[]; weight: number }[] = [];
    const caps: { node: Element; source: Element | null }[] = [];
    let source: Element | null = null;
    for (const { node, fill, stroke } of paints) {
      if (node.getAttribute("data-iconify-junction-cap") === "1") { caps.push({ node, source }); continue; }
      source = node;
      const groupsByPaint = new Map<string, typeof groups[number]>();
      for (const attribute of ["fill", "stroke"] as const) {
        const paint = attribute === "fill" ? fill : stroke;
        if (noPaint(paint) || (preserveWhite && canonical(paint) === "#ffffff")) continue;
        if (attribute === "fill" && node.localName === "line") continue;
        const matrix = effectiveMatrix(node), determinant = Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]);
        const weight = paintWeight(node.localName, name => name === "stroke-width" ? inherited(node, name, "1") : node.getAttribute(name), attribute, node as unknown as SVGGeometryElement) * determinant * paintOpacity(node, attribute);
        if (weight <= 0) continue;
        const group = groupsByPaint.get(canonical(paint));
        if (group) { group.attributes.push(attribute); group.weight += weight; }
        else {
          const next = { node, attributes: [attribute], weight };
          groupsByPaint.set(canonical(paint), next); groups.push(next);
        }
      }
    }
    const assigned = allocatePaletteColors(groups.map(group => group.weight), palette);
    groups.forEach((group, index) => group.attributes.forEach(attribute => group.node.setAttribute(attribute, assigned[index])));
    // Derived caps are adjacent to their source in Iconify exports and must
    // inherit its color, never count as independent decorative paint groups.
    for (const cap of caps) if (cap.source) cap.node.setAttribute("stroke", inherited(cap.source, "stroke", palette[0].color));
    return refreshSvgJunctionCaps(serialize(root));
  }
  const unknownColors = [...new Set(visible.map(canonical))].filter((paint) => paint !== standards.primaryColor.toLowerCase() && paint !== standards.secondaryColor.toLowerCase() && !(preserveWhite && paint === "#ffffff"));
  const recolor = (paint: string) => {
    if (noPaint(paint)) return paint;
    const color = canonical(paint);
    if (preserveWhite && color === "#ffffff") return paint;
    if (effectiveColorMode(standards) === "mono") return standards.primaryColor;
    if (color === standards.secondaryColor.toLowerCase()) return standards.secondaryColor;
    if (color === standards.primaryColor.toLowerCase() || unknownColors.indexOf(color) <= 0) return standards.primaryColor;
    return standards.secondaryColor;
  };
  for (const { node, fill, stroke } of paints) {
    node.setAttribute("fill", recolor(fill));
    node.setAttribute("stroke", recolor(stroke));
  }
  return serialize(root);
}

/** Local styling comparisons; these retain the source geometry and never claim to redraw it. */
export function createNormalizedCandidates(raw: string, requested: Standards, count: number): Candidate[] {
  const standards = validateStandards(requested);
  const amount = Math.max(4, Math.min(8, Math.floor(Number.isFinite(count) ? count : 6)));
  const source = sanitizeSvg(raw);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (settings: Standards, name: string, rationale: string) => {
    const svg = normalizeSvg(source, settings);
    if (seen.has(svg)) return;
    seen.add(svg);
    candidates.push({ id: `normalized-${stableHash(`${svg}-${candidates.length}`)}`, name, svg, rationale, status: "pending", source: "normalized" });
  };
  add(standards, "Local style adjustment", "Adjusts spacing, colors, and existing strokes. Original solid and outlined shapes are preserved; changing the drawing style requires a creative redesign.");
  const offsets = [0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 4, -4];
  const maxPadding = standards.gridSize / 2 - 0.25;
  const effectiveBase = Math.max(standards.padding, standards.style === "filled" ? 0 : standards.strokeWidth / 2);
  for (const [index, offset] of offsets.entries()) {
    if (candidates.length >= amount) break;
    const padding = Math.max(0, Math.min(maxPadding, effectiveBase + offset));
    if (Math.abs(padding - effectiveBase) < 0.01) continue;
    const strokeWidth = standards.style === "filled" ? standards.strokeWidth : Math.max(0.25, Math.min(12, standards.gridSize - 0.25, standards.strokeWidth + (index % 3 === 0 ? -0.25 : index % 3 === 1 ? 0.25 : 0)));
    const corner = index === 3 ? (standards.corner === "round" ? "square" : "round") : standards.corner;
    const direction = padding > effectiveBase ? "More breathing room" : "Larger silhouette";
    add({ ...standards, padding, strokeWidth, corner }, `${direction} ${candidates.length}`, `Local style variation: ${round(padding)}px padding, ${round(strokeWidth)}px line weight, ${corner} corners. The source shape is preserved; review this variation against your standards.`);
  }
  // Small grids and padding at either extreme can collapse clamped choices. Fill the
  // remaining slots with distinct proportional insets, including for solid artwork.
  for (let index = 1; candidates.length < amount && index <= 32; index++) {
    const padding = maxPadding * index / 33;
    add({ ...standards, padding }, `Spacing study ${candidates.length}`, `Local style variation with ${round(padding)}px padding. The source shape is preserved; this comparison intentionally differs from your exact standard.`);
  }
  if (candidates.length < amount) throw new Error("This icon cannot produce enough distinct local variations with the current grid and line weight. Try a larger grid or lighter stroke.");
  return candidates;
}

export type SvgAnalysis = { score: number; issues: { label: string; detail: string; severity: "info" | "warning" }[] };

/** A structural standards check, not a claim of perceptual or AI quality. */
export function analyzeSvg(raw: string, requested: Standards): SvgAnalysis {
  const standards = validateStandards(requested);
  const root = parseSafe(raw);
  const shapes = Array.from(root.querySelectorAll("*")).filter((node) => DRAWING_TAGS.has(node.localName) && !isInsideDefinition(node) && node.getAttribute("data-iconify-junction-cap") !== "1");
  const issues: SvgAnalysis["issues"] = [];
  const viewBox = numbers(root.getAttribute("viewBox")!);
  if (viewBox.some((value, index) => Math.abs(value - [0, 0, standards.gridSize, standards.gridSize][index]) > 0.001)) {
    issues.push({ label: "Different grid", detail: `The source uses a ${viewBox[2]} × ${viewBox[3]} viewBox. Your standard is ${standards.gridSize} × ${standards.gridSize}.`, severity: "warning" });
  }
  const stroked = shapes.filter((node) => inherited(node, "stroke", "none") !== "none");
  if (stroked.some((node) => {
    const weight = parseFloat(inherited(node, "stroke-width", "1"));
    const scale = inherited(node, "vector-effect", "none") === "non-scaling-stroke" ? 1 : matrixScale(effectiveMatrix(node));
    return Math.abs(weight * scale - standards.strokeWidth) > 0.05;
  })) issues.push({ label: "Line weight differs", detail: `Some strokes differ from your ${standards.strokeWidth}px standard after transforms are applied.`, severity: "warning" });
  if (stroked.some((node) => inherited(node, "stroke-linecap", "butt") !== (standards.corner === "round" ? "round" : "square") || inherited(node, "stroke-linejoin", "miter") !== (standards.corner === "round" ? "round" : "miter"))) {
    issues.push({ label: "Mixed corner treatment", detail: `Align stroke caps and joins to the ${standards.corner} corner standard.`, severity: "warning" });
  }
  const fills = shapes.map((node) => inherited(node, "fill", "black"));
  if (standards.style === "line" && fills.some((fill) => !["none", "transparent"].includes(fill))) issues.push({ label: "Filled geometry", detail: "Solid silhouettes are preserved. A true outlined version requires redrawing the centerlines; adding a stroke around a filled silhouette would only create a double outline.", severity: "warning" });
  if (["filled", "duotone"].includes(standards.style) && shapes.some((node) => isClosedShape(node) && ["none", "transparent"].includes(inherited(node, "fill", "black")))) issues.push({ label: "Style needs alignment", detail: `Closed shapes need ${standards.style === "duotone" ? "the secondary color" : "a solid fill"} to match your style.`, severity: "warning" });
  if (standards.style === "combined") {
    const hasSolid = shapes.some((node) => !["none", "transparent"].includes(inherited(node, "fill", "black")));
    const hasOutline = stroked.some((node) => ["none", "transparent"].includes(inherited(node, "fill", "black")));
    if (!hasSolid || !hasOutline) issues.push({ label: "Combined treatment needs a redraw", detail: "Combined icons use deliberate solid accents and separate outlined shapes. Original paint roles are preserved until a creative redesign supplies both.", severity: "warning" });
  }
  const expectedColors = new Set(getPalette(standards).filter(entry => entry.percentage > 0).map(entry => entry.color.toLowerCase()));
  const paints = shapes.flatMap((node) => [inherited(node, "fill", "black"), inherited(node, "stroke", "none")]).filter((paint) => !["none", "transparent"].includes(paint));
  if (paints.some((paint) => !expectedColors.has(paint.toLowerCase()))) issues.push({ label: "Colors differ", detail: "Some shapes use colors outside your selected palette.", severity: "warning" });
  if (shapes.some((node) => {
    const matrix = effectiveMatrix(node);
    const x = Math.hypot(matrix[0], matrix[1]);
    const y = Math.hypot(matrix[2], matrix[3]);
    return Math.abs(x - y) > 0.001 || Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) > 0.001;
  })) issues.push({ label: "Review transformed strokes", detail: "Non-uniform scaling or skew can make strokes look uneven. A visual redraw may be needed.", severity: "info" });
  if (standards.style === "filled" && shapes.some((node) => !isClosedShape(node))) issues.push({ label: "Open paths need a visual review", detail: "Open lines are preserved as strokes. A true filled silhouette may need AI-assisted redrawing.", severity: "info" });
  if (!issues.length) issues.push({ label: "Standards aligned", detail: "Grid, palette, line weight, and stroke corners match. Review optical balance and spacing visually.", severity: "info" });
  return { score: Math.max(0, 100 - issues.filter((issue) => issue.severity === "warning").length * 18), issues };
}

type DemoRecipe = { name: string; body: string; rationale: string; filled?: string; combined?: string };
const RECIPES: Record<string, DemoRecipe[]> = {
  workspace: [
    { name: "Balanced grid", body: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>', rationale: "Equal modules create a calm, balanced workspace with a familiar dashboard silhouette." },
    { name: "Focused sidebar", body: '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="12" y="3" width="9" height="7" rx="1.5"/><rect x="12" y="14" width="9" height="7" rx="1.5"/>', rationale: "A strong left rail makes navigation and content feel distinct at small sizes." },
    { name: "Modular layout", body: '<rect x="3" y="3" width="11" height="7" rx="1.5"/><rect x="18" y="3" width="3" height="7" rx="1"/><rect x="3" y="14" width="5" height="7" rx="1.5"/><rect x="12" y="14" width="9" height="7" rx="1.5"/>', rationale: "Asymmetric modules suggest a flexible, customizable workspace." },
    { name: "Stacked panels", body: '<rect x="3" y="3" width="18" height="5" rx="1.5"/><rect x="3" y="12" width="8" height="9" rx="1.5"/><rect x="15" y="12" width="6" height="9" rx="1.5"/>', rationale: "A broad header anchors two task panels, with a clear top-to-bottom hierarchy." },
    { name: "Command center", body: '<rect x="3" y="3" width="18" height="18" rx="3"/><path fill="none" d="M3 9h18M9 9v12"/>', filled: '<path fill-rule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v3h14V5H5Zm0 5v9h3v-9H5Zm5 0v9h9v-9h-9Z"/>', rationale: "A single outer frame brings structure and reads as one integrated application." },
    { name: "Open workspace", body: '<path fill="none" d="M9 3H5a2 2 0 0 0-2 2v4m12-6h4a2 2 0 0 1 2 2v4M3 15v4a2 2 0 0 0 2 2h4m6 0h4a2 2 0 0 0 2-2v-4"/><rect x="8" y="8" width="8" height="8" rx="2"/>', rationale: "An open frame puts the current task at the center and leaves more breathing room." },
    { name: "Three columns", body: '<rect x="3" y="3" width="4" height="18" rx="1.4"/><rect x="10" y="3" width="4" height="12" rx="1.4"/><rect x="17" y="3" width="4" height="16" rx="1.4"/>', rationale: "Different column heights evoke a project board with active work in progress." },
    { name: "Connected spaces", body: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/><path fill="none" d="M15 5h4v4M5 15v4h4M14 10l-4 4"/>', rationale: "Linked spaces emphasize connection while keeping the overall silhouette light." },
  ],
  search: [
    { name: "Classic lens", body: '<circle cx="10.5" cy="10.5" r="7"/><path fill="none" d="m16 16 5 5"/>', filled: '<path fill-rule="evenodd" d="M10 3a7 7 0 1 0 4.2 12.6l5.7 5.7 1.4-1.4-5.7-5.7A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>', rationale: "A familiar lens with generous negative space keeps recognition immediate." },
    { name: "Squared lens", body: '<rect x="3" y="3" width="14" height="14" rx="4"/><path fill="none" d="m17 17 4 4"/>', rationale: "A softened square lens pairs naturally with modular interface icons." },
    { name: "Discover", body: '<circle cx="10" cy="10" r="6.5"/><path fill="none" d="m15 15 6 6M7 10h6m-3-3v6"/>', rationale: "The plus mark adds a sense of discovery and finding something new." },
    { name: "Quick find", body: '<circle cx="13" cy="10" r="6.5"/><path fill="none" d="m18 15 3 5M3 8h3M3 12h3M4 17h7"/>', rationale: "Short motion lines give search a fast, responsive character." },
    { name: "Search results", body: '<circle cx="9" cy="9" r="5.5"/><path fill="none" d="m13 13 4 4M3 21h18M19 4h2m-2 4h2m-2 4h2"/>', rationale: "A small result list makes the icon useful for search-and-browse experiences." },
    { name: "Precise search", body: '<circle cx="12" cy="12" r="7"/><path fill="none" d="M12 3v3m9 6h-3m-6 9v-3m-9-6h3"/><circle cx="12" cy="12" r="1.5"/>', rationale: "A centered target emphasizes precision and focused lookup." },
    { name: "Lens detail", body: '<circle cx="10.5" cy="10.5" r="7"/><path fill="none" d="m16 16 5 5M7 10.5a3.5 3.5 0 0 1 3.5-3.5"/>', rationale: "A small reflection adds personality without changing the familiar search metaphor." },
    { name: "Search field", body: '<rect x="3" y="5" width="18" height="14" rx="4"/><circle cx="9" cy="11" r="3"/><path fill="none" d="m11 13 2 2m3-4h2"/>', rationale: "A contained search field fits products where search is a primary destination." },
  ],
  notification: [
    { name: "Quiet bell", body: '<path d="M6 10a6 6 0 0 1 12 0v5l2 3H4l2-3v-5Z"/><path fill="none" d="M10 21h4M12 2v2"/>', rationale: "A clean bell silhouette communicates notifications with very little detail." },
    { name: "New activity", body: '<path d="M6 10a6 6 0 0 1 8-5.65M18 11v4l2 3H4l2-3v-5" fill="none"/><circle cx="19" cy="5" r="3"/><path fill="none" d="M10 21h4"/>', rationale: "A distinct status dot makes unread activity visible at a glance." },
    { name: "Ringing bell", body: '<path d="M7 10a5 5 0 0 1 10 0v5l2 3H5l2-3v-5Z"/><path fill="none" d="M10 21h4M3 9a9 9 0 0 1 2-5m16 5a9 9 0 0 0-2-5"/>', rationale: "Paired motion strokes signal an active alert with a lively, balanced shape." },
    { name: "Notification card", body: '<path d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path fill="none" d="M7 8h10M7 12h6"/>', rationale: "A message-shaped card works well for product updates and contextual alerts." },
    { name: "Activity pulse", body: '<rect x="3" y="3" width="18" height="18" rx="5"/><path fill="none" d="M3 12h5l2-5 4 10 2-5h5"/>', rationale: "A pulse emphasizes live activity and monitoring over a traditional notification bell." },
    { name: "Inbox alert", body: '<path d="m3 14 3-10h12l3 10v6H3v-6Z"/><path fill="none" d="M3 14h5l2 3h4l2-3h5M12 7v4"/>', rationale: "An inbox makes notifications feel collected, organized, and ready to review." },
    { name: "Alert badge", body: '<path d="M12 3 21 7v6c0 5-9 8-9 8s-9-3-9-8V7l9-4Z"/><path fill="none" d="M12 7v6m0 3v.1"/>', rationale: "A protective badge suits important system or account notifications." },
    { name: "Minimal alert", body: '<circle cx="12" cy="12" r="9"/><path fill="none" d="M12 7v6m0 4v.1"/>', rationale: "A compact exclamation mark gives alerts a direct, neutral visual language." },
  ],
  collection: [
    { name: "Open folder", body: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path fill="none" d="M3 9h18"/>', rationale: "The familiar folder metaphor makes a collection easy to find and understand." },
    { name: "Card stack", body: '<rect x="3" y="8" width="14" height="13" rx="2"/><path fill="none" d="M7 4h12a2 2 0 0 1 2 2v11"/>', rationale: "Offset cards suggest a curated set while preserving a simple silhouette." },
    { name: "Library shelf", body: '<rect x="3" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="m17 5 3-1 3 15-3 1-3-15Z"/>', rationale: "A small shelf of books is useful when collections behave like a reusable library." },
    { name: "Collection tiles", body: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="15" width="6" height="6" rx="1.5"/><path d="m16 12 6 6-6 6-6-6 6-6Z" transform="translate(1 -1) scale(.9)"/>', rationale: "Mixed tiles suggest a collection that can hold several kinds of content." },
    { name: "Saved items", body: '<path d="M6 3h12v18l-6-4-6 4V3Z"/><path fill="none" d="M9 7h6M9 11h6"/>', rationale: "A bookmark connects collections with saving and returning to useful content." },
    { name: "Layered set", body: '<path d="m12 3 10 5-10 5L2 8l10-5Z"/><path fill="none" d="m3 13 9 4 9-4M3 18l9 4 9-4"/>', rationale: "Stacked layers express a set of related assets with a compact, geometric form." },
    { name: "Archive box", body: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8h14v13H5V8Z"/><path fill="none" d="M10 12h4"/>', rationale: "A storage box gives larger collections an organized, durable character." },
    { name: "Curated grid", body: '<circle cx="7" cy="7" r="4"/><rect x="15" y="3" width="6" height="8" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/><path d="m18 14 4 7h-8l4-7Z"/>', rationale: "Contrasting shapes make this a good fit for a diverse asset library." },
  ],
  settings: [
    { name: "Fine controls", body: '<path fill="none" d="M5 3v5m0 6v7M12 3v10m0 6v2M19 3v2m0 6v10"/><circle cx="5" cy="11" r="3"/><circle cx="12" cy="16" r="3"/><circle cx="19" cy="8" r="3"/>', rationale: "Independent sliders communicate control and customization without a dense gear shape." },
    { name: "Horizontal controls", body: '<path fill="none" d="M3 5h8m6 0h4M3 12h2m6 0h10M3 19h10m6 0h2"/><circle cx="14" cy="5" r="3"/><circle cx="8" cy="12" r="3"/><circle cx="16" cy="19" r="3"/>', rationale: "Horizontal sliders echo the controls users adjust throughout the product." },
    { name: "Simple cog", body: '<path d="m10 3 4 0 .6 3 2 .9 2.6-1.5 2 3.4-2.3 2v2.4l2.3 2-2 3.4-2.6-1.5-2 .9L14 21h-4l-.6-3-2-.9-2.6 1.5-2-3.4 2.3-2v-2.4l-2.3-2 2-3.4L7.4 7l2-.9L10 3Z"/><circle cx="12" cy="12" r="3"/>', rationale: "A familiar cog gives settings a clear, conventional destination." },
    { name: "Toggle settings", body: '<rect x="3" y="4" width="18" height="6" rx="3"/><circle cx="7" cy="7" r="1"/><rect x="3" y="14" width="18" height="6" rx="3"/><circle cx="17" cy="17" r="1"/>', rationale: "Two toggles make this variant feel closely connected to preferences and options." },
    { name: "Control dial", body: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path fill="none" d="m14 10 4-4M12 3v2M3 12h2m14 0h2M12 19v2"/>', rationale: "A calibrated dial conveys precision, especially for visual or technical settings." },
    { name: "Preferences panel", body: '<rect x="3" y="3" width="18" height="18" rx="3"/><path fill="none" d="M7 8h10M7 16h10M10 6v4m4 4v4"/>', rationale: "A contained panel ties settings to the rest of a structured interface system." },
    { name: "Equalizer", body: '<path fill="none" d="M5 3v18M12 3v18M19 3v18"/><rect x="3" y="6" width="4" height="4" rx="1"/><rect x="10" y="14" width="4" height="4" rx="1"/><rect x="17" y="8" width="4" height="4" rx="1"/>', rationale: "Square handles provide a more technical, deliberately precise control language." },
    { name: "Adjustments", body: '<path fill="none" d="M3 6h18M3 12h18M3 18h18"/><rect x="6" y="3" width="4" height="6" rx="1.5"/><rect x="14" y="9" width="4" height="6" rx="1.5"/><rect x="8" y="15" width="4" height="6" rx="1.5"/>', rationale: "Offset handles keep the shape balanced and recognizable on a compact grid." },
  ],
  profile: [
    { name: "Person", body: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 6 0 0 1 16 0v2H4Z"/>', rationale: "A simple portrait has a warm, approachable shape with a strong account metaphor." },
    { name: "Avatar circle", body: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path fill="none" d="M5 18c2-6 12-6 14 0"/>', rationale: "A circular frame connects naturally to user avatars across a product." },
    { name: "Profile card", body: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2.5"/><path fill="none" d="M5 17c0-5 8-5 8 0m3-9h2m-2 4h2m-2 4h2"/>', rationale: "An identity card suggests richer account details and personal information." },
    { name: "Personal space", body: '<path fill="none" d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/><circle cx="12" cy="9" r="3"/><path fill="none" d="M7 17c0-5 10-5 10 0"/>', rationale: "An open frame keeps the portrait airy and emphasizes a personal workspace." },
    { name: "Team member", body: '<circle cx="10" cy="7" r="4"/><path fill="none" d="M3 21v-2a7 6 0 0 1 14 0v2m0-17a4 4 0 0 1 0 7m3 4a6 6 0 0 1 2 6"/>', rationale: "A second silhouette connects the individual account to a collaborative team." },
    { name: "Verified person", body: '<circle cx="10" cy="7" r="4"/><path fill="none" d="M3 21v-2a7 6 0 0 1 11-5m1 5 2 2 4-5"/>', rationale: "A check mark adds a clear signal for verified or completed profiles." },
    { name: "Account badge", body: '<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z"/><circle cx="12" cy="9" r="2.5"/><path fill="none" d="M7 17c0-5 10-5 10 0"/>', rationale: "A geometric badge provides a distinctive account shape for more technical products." },
    { name: "Minimal portrait", body: '<circle cx="12" cy="8" r="5"/><path fill="none" d="M3 21c0-8 18-8 18 0"/>', rationale: "Two generous curves reduce visual noise and stay clear at the smallest sizes." },
  ],
};

// Filled silhouettes need deliberate negative space. These small overrides avoid turning
// lenses, avatars, and framed controls into featureless disks when switching styles.
const FILLED_OVERRIDES: Record<string, Record<number, string>> = {
  search: {
    1: '<path fill-rule="evenodd" d="M7 3h6a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7Z"/><path fill="none" d="m16 16 5 5"/>',
    2: '<path fill-rule="evenodd" d="M10 3a7 7 0 1 0 4.2 12.6l5.7 5.7 1.4-1.4-5.7-5.7A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/><path fill="none" d="M7.5 10h5m-2.5-2.5v5"/>',
    3: '<path fill-rule="evenodd" d="M13 3a7 7 0 1 0 4.2 12.6l3.4 5.2 1.6-1.1-3.5-5.3A7 7 0 0 0 13 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/><path fill="none" d="M3 8h2M3 12h2M4 18h7"/>',
    4: '<path fill-rule="evenodd" d="M9 3a6 6 0 1 0 3.5 10.9l3.8 3.8 1.4-1.4-3.8-3.8A6 6 0 0 0 9 3Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path fill="none" d="M3 21h18M19 4h2m-2 4h2m-2 4h2"/>',
    5: '<path fill-rule="evenodd" d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z"/><path fill="none" d="M12 3v3m9 6h-3m-6 9v-3m-9-6h3"/><circle cx="12" cy="12" r="2"/>',
    6: '<path fill-rule="evenodd" d="M10 3a7 7 0 1 0 4.2 12.6l5.7 5.7 1.4-1.4-5.7-5.7A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/><path fill="none" d="M7 10a3 3 0 0 1 3-3"/>',
    7: '<path fill-rule="evenodd" d="M7 4h10a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3H7Z"/><path fill="none" d="M11 10a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm-1 2 3 3m3-4h2"/>',
  },
  notification: {
    3: '<path fill-rule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4v2h10V7H7Zm0 4v2h6v-2H7Z"/>',
    4: '<path fill-rule="evenodd" d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm0 2a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7Z"/><path fill="none" d="M3 12h5l2-5 4 10 2-5h5"/>',
    6: '<path fill-rule="evenodd" d="M12 3 21 7v6c0 5-9 8-9 8s-9-3-9-8V7l9-4Zm-1 4v7h2V7h-2Zm0 9v2h2v-2h-2Z"/>',
    7: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-1 4v7h2V7h-2Zm0 9v2h2v-2h-2Z"/>',
  },
  settings: {
    2: '<path fill-rule="evenodd" d="m10 3 4 0 .6 3 2 .9 2.6-1.5 2 3.4-2.3 2v2.4l2.3 2-2 3.4-2.6-1.5-2 .9L14 21h-4l-.6-3-2-.9-2.6 1.5-2-3.4 2.3-2v-2.4l-2.3-2 2-3.4L7.4 7l2-.9L10 3Zm2 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>',
    3: '<path fill-rule="evenodd" d="M6 4h12a3 3 0 0 1 0 6H6a3 3 0 0 1 0-6Zm1 1a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-1 9h12a3 3 0 0 1 0 6H6a3 3 0 0 1 0-6Zm11 1a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>',
    4: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z"/><circle cx="12" cy="12" r="3"/><path fill="none" d="m14 10 4-4"/>',
    5: '<path fill-rule="evenodd" d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H6Z"/><path fill="none" d="M7 8h10M7 16h10M10 6v4m4 4v4"/>',
  },
  profile: {
    1: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z"/><circle cx="12" cy="9" r="3"/><path d="M6 18a6 5 0 0 1 12 0l-6 2-6-2Z"/>',
    2: '<path fill-rule="evenodd" d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H6Z"/><circle cx="9" cy="9" r="2.5"/><path d="M5 17a4 4 0 0 1 8 0H5Z"/><path fill="none" d="M16 8h2m-2 4h2m-2 4h2"/>',
    6: '<path fill-rule="evenodd" d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 2-7 4v6l7 4 7-4V9l-7-4Z"/><circle cx="12" cy="9" r="2.5"/><path d="M7 17a5 4 0 0 1 10 0l-5 2-5-2Z"/>',
  },
};
for (const [category, overrides] of Object.entries(FILLED_OVERRIDES)) {
  for (const [index, geometry] of Object.entries(overrides)) RECIPES[category][Number(index)].filled = geometry;
}

// Combined is a deliberate mixture of solid accents and separate outlined structure.
// It is not duotone and never means adding a stroke around every filled silhouette.
const COMBINED_SOLIDS: Record<string, number[][]> = {
  workspace: [[0], [0], [1], [0], [], [1], [0], [0]],
  search: [[], [], [], [], [], [2], [], []],
  notification: [[0], [1], [0], [], [], [], [], []],
  collection: [[], [0], [0], [1], [], [0], [0], [0]],
  settings: [[1], [1], [1], [1], [1], [], [1], [1]],
  profile: [[0], [1], [1], [1], [0], [0], [1], [0]],
};
const COMBINED_DETAILS: Record<string, Record<number, string>> = {
  workspace: {
    4: '<rect x="3" y="3" width="18" height="18" rx="1"/><path fill="none" d="M3 9h18M9 9v12"/><rect data-solid="1" x="4.5" y="4.5" width="15" height="3" rx=".5"/>',
  },
  search: {
    0: '<circle cx="10.5" cy="10.5" r="7"/><path data-solid="1" d="m15.8 17.2 4.1 4.1 1.4-1.4-4.1-4.1-1.4 1.4Z"/>',
    1: '<rect x="3" y="3" width="14" height="14" rx="1"/><path data-solid="1" d="m16 17.4 3.9 3.9 1.4-1.4-3.9-3.9-1.4 1.4Z"/>',
    2: '<circle cx="10" cy="10" r="6.5"/><path fill="none" d="m15 15 6 6"/><path data-solid="1" d="M9 7h2v2h2v2h-2v2H9v-2H7V9h2V7Z"/>',
    3: '<circle cx="13" cy="10" r="6.5"/><path fill="none" d="m18 15 3 5M3 8h3M3 12h3"/><rect data-solid="1" x="3" y="16" width="8" height="2"/>',
    4: '<circle cx="9" cy="9" r="5.5"/><path fill="none" d="m13 13 4 4M19 4h2m-2 4h2m-2 4h2"/><rect data-solid="1" x="3" y="20" width="18" height="2"/>',
    6: '<circle cx="10.5" cy="10.5" r="7"/><path fill="none" d="m16 16 5 5"/><path data-solid="1" d="M6 10.5A4.5 4.5 0 0 1 10.5 6v2A2.5 2.5 0 0 0 8 10.5H6Z"/>',
    7: '<rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="11" r="3"/><path fill="none" d="m11 13 2 2"/><rect data-solid="1" x="16" y="10" width="3" height="2"/>',
  },
  notification: {
    3: '<path d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><rect data-solid="1" x="7" y="7" width="10" height="2"/><path fill="none" d="M7 12h6"/>',
    4: '<rect x="3" y="3" width="18" height="18" rx="1"/><path fill="none" d="M3 12h5l2-5 4 10 2-5h5"/><circle data-solid="1" cx="10" cy="7" r="1.6"/>',
    5: '<path d="m3 14 3-10h12l3 10v6H3v-6Z"/><path data-solid="1" d="M4 15h3.5l2 3h5l2-3H20v4H4v-4Z"/><path fill="none" d="M12 7v4"/>',
    6: '<path d="M12 3 21 7v6c0 5-9 8-9 8s-9-3-9-8V7l9-4Z"/><rect data-solid="1" x="11" y="7" width="2" height="7"/><rect data-solid="1" x="11" y="16" width="2" height="2"/>',
    7: '<circle cx="12" cy="12" r="9"/><rect data-solid="1" x="11" y="7" width="2" height="7"/><rect data-solid="1" x="11" y="16" width="2" height="2"/>',
  },
  collection: {
    0: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path fill="none" d="M3 9h18"/><path data-solid="1" d="M4.5 7.5v-2A1 1 0 0 1 5.5 4.5H9l2.2 3H4.5Z"/>',
    4: '<path d="M6 3h12v18l-6-4-6 4V3Z"/><rect data-solid="1" x="9" y="6" width="6" height="2"/><path fill="none" d="M9 11h6"/>',
  },
  settings: {
    5: '<rect x="3" y="3" width="18" height="18" rx="1"/><path fill="none" d="M7 8h10M7 16h10"/><rect data-solid="1" x="9" y="6" width="2" height="4"/><rect data-solid="1" x="13" y="14" width="2" height="4"/>',
  },
};
for (const [category, recipes] of Object.entries(RECIPES)) {
  recipes.forEach((recipe, index) => {
    let shape = -1;
    recipe.combined = COMBINED_DETAILS[category]?.[index] ?? recipe.body.replace(/<(path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)>/g, (tag, name, attributes) => {
      shape++;
      return COMBINED_SOLIDS[category][index].includes(shape) ? `<${name} data-solid="1"${attributes}>` : tag;
    });
  });
}

function categoryFor(brief: string): string {
  const text = brief.toLowerCase();
  if (/search|find|discover|lens|lookup/.test(text)) return "search";
  if (/notif|bell|alert|activity|inbox/.test(text)) return "notification";
  if (/collect|folder|librar|archive|bookmark|saved|asset/.test(text)) return "collection";
  if (/setting|prefer|control|adjust|config|slider/.test(text)) return "settings";
  if (/profile|person|account|avatar|member|user|team/.test(text)) return "profile";
  return "workspace";
}

function demoSvg(recipe: DemoRecipe, standards: Standards): string {
  const size = standards.gridSize;
  const duo = effectiveColorMode(standards) === "duo";
  const accent = duo ? standards.secondaryColor : standards.primaryColor;
  const filled = standards.style === "filled";
  let body = standards.style === "combined" ? recipe.combined! : filled && recipe.filled ? recipe.filled : recipe.body;
  const hasStrokes = !filled || body.includes('fill="none"');
  const inset = Math.max(standards.padding, hasStrokes ? standards.strokeWidth / 2 : 0);
  const scale = (size - inset * 2) / 18;
  const translate = inset - scale * 3;
  const weight = standards.strokeWidth / scale;
  const fill = filled ? standards.primaryColor : standards.style === "duotone" ? accent : "none";
  // Keep rounding quiet on the final grid; prebuilt paths retain their authored geometry.
  body = body.replace(/ rx="[^"]+"/g, ` rx="${standards.corner === "square" ? "0" : round(0.75 / scale)}"`);
  body = body.replace(/ data-solid="1"/g, ` fill="${accent}" stroke="none"`);
  // Open detail paths retain a stroke in the filled recipe. Closed surfaces become solid.
  if (filled) body = body.replace(/<path fill="none"/g, `<path fill="none" stroke="${standards.primaryColor}"`);
  if (duo && ["line", "filled"].includes(standards.style)) {
    // One authored detail receives the accent; color mode never changes paint roles.
    const shapePattern = /<(?:path|rect|circle|ellipse|line|polyline|polygon)\b[^>]*>/g;
    const matches = [...body.matchAll(shapePattern)];
    if (matches.length > 1) {
      const detail = matches[matches.length - 1];
      const attribute = filled && !detail[0].includes('fill="none"') ? "fill" : "stroke";
      const painted = detail[0].replace(new RegExp(` ${attribute}="[^"]*"`, "g"), "").replace(/^(<[a-z]+)/, `$1 ${attribute}="${accent}"`);
      body = body.slice(0, detail.index) + painted + body.slice(detail.index! + detail[0].length);
    }
  }
  if (effectiveColorMode(standards) === "color" || standards.palette && effectiveColorMode(standards) !== "mono") {
    const pattern = /<(path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)>/g;
    const shapes = [...body.matchAll(pattern)].map(match => {
      const attrs = new Map([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(pair => [pair[1], pair[2]]));
      const shapeFill = attrs.get("fill") ?? fill, shapeStroke = attrs.get("stroke") ?? (filled ? "none" : standards.primaryColor);
      const paints: ("fill" | "stroke")[] = [];
      if (match[1] !== "line" && !["none", "transparent"].includes(shapeFill)) paints.push("fill");
      if (!["none", "transparent"].includes(shapeStroke)) paints.push("stroke");
      const estimatedArea = paints.reduce((sum, paint) => sum + paintWeight(match[1], name => name === "stroke-width" ? attrs.get(name) ?? String(weight) : attrs.get(name) ?? null, paint), 0);
      return { paints, weight: estimatedArea };
    });
    const colors = allocatePaletteColors(shapes.map(shape => shape.weight), getPalette(standards));
    let index = 0;
    body = body.replace(pattern, (tag) => {
      const shape = shapes[index], color = colors[index++];
      for (const attribute of shape.paints) tag = tag.replace(new RegExp(` ${attribute}="[^"]*"`, "g"), "").replace(/^(<[a-z]+)/, `$1 ${attribute}="${color}"`);
      return tag;
    });
  }
  return `<svg xmlns="${SVG_NS}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" data-iconify-source-viewbox="3 3 18 18" fill="${fill}" stroke="${filled ? "none" : standards.primaryColor}" stroke-width="${round(weight)}" stroke-linecap="${standards.corner === "round" ? "round" : "square"}" stroke-linejoin="${standards.corner === "round" ? "round" : "miter"}"><g data-iconify-fit="1" transform="translate(${round(translate)} ${round(translate)}) scale(${round(scale)})">${body}</g></svg>`;
}

/** Curated preview concepts. These are deterministic demo recipes, not an AI response. */
export function createDemoCandidates(brief: string, requested: Standards, count: number, iteration = 1): Candidate[] {
  const standards = validateStandards(requested);
  const category = categoryFor(brief);
  const recipes = RECIPES[category];
  const amount = Math.max(4, Math.min(8, Math.floor(Number.isFinite(count) ? count : 6)));
  const currentRound = Math.max(1, Math.floor(Number.isFinite(iteration) ? iteration : 1));
  const offset = ((currentRound - 1) * 2) % recipes.length;
  return Array.from({ length: amount }, (_, index): Candidate[] => {
    const recipe = recipes[(offset + index) % recipes.length];
    const pairId = `demo-${stableHash(`${brief}-${JSON.stringify(standards)}-${currentRound}-${index}`)}`;
    const treatments = standards.style === "both" ? ["line", "filled"] as const : [standards.style];
    return treatments.map(style => ({
      id: `${pairId}-${style}`,
      name: recipe.name,
      svg: demoSvg(recipe, { ...standards, style }),
      rationale: `${recipe.rationale} Curated demo concept; connect AI to explore your exact brief.`,
      status: "pending" as const,
      source: "demo" as const,
      ...(standards.style === "both" ? { pairId, treatment: style as "line" | "filled" } : {}),
    }));
  }).flat();
}

export function createSampleSet(standards: Standards = DEFAULT_STANDARDS): IconItem[] {
  return [
    { name: "Workspace", brief: "A workspace dashboard for a productivity app. Clear, modular, and balanced." },
    { name: "Search", brief: "Find and discover content across a productivity workspace." },
    { name: "Notifications", brief: "Notifications for new activity, updates, and messages." },
    { name: "Collections", brief: "Organize saved assets in a curated collection or library." },
    { name: "Settings", brief: "Configure preferences and adjust workspace settings." },
    { name: "Profile", brief: "A personal user profile and account in a productivity app." },
  ].map((sample, index) => ({ ...sample, id: `sample-${index + 1}`, candidates: createDemoCandidates(sample.brief, standards, 6), round: 1, standards: { ...standards } }));
}

function safeFileName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "icon";
}

function download(blob: Blob, name: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("Downloads are available in your browser.");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvg(svg: string, name: string): void {
  download(new Blob([sanitizeSvg(svg)], { type: "image/svg+xml;charset=utf-8" }), `${safeFileName(name)}.svg`);
}

type ExportFile = { name: string; content: string };

/** Collect export files without initiating a download. SVG reference IDs are scoped in the sprite. */
export function buildExportBundle(items: IconItem[], standards: Standards): ExportFile[] {
  validateStandards(standards);
  const files: ExportFile[] = [];
  const manifest: { name: string; file: string; source: Candidate["source"]; status: Candidate["status"]; standards: Standards | null; treatment?: Candidate["treatment"]; pairId?: string; standardsNote?: string }[] = [];
  const symbols: string[] = [];
  const filenames = new Set<string>(["sprite"]);
  for (const item of items) {
    const accepted = item.candidates.filter((candidate) => candidate.status === "accepted");
    const shortlisted = item.candidates.filter((candidate) => candidate.status === "shortlisted");
    const selected = accepted.length ? accepted : shortlisted.length ? shortlisted : item.candidates.slice(0, 1);
    for (const [index, candidate] of selected.entries()) {
      const root = parseSafe(candidate.svg);
      const base = `${safeFileName(item.name)}${candidate.treatment ? `-${candidate.treatment === "line" ? "outlined" : "filled"}` : selected.length > 1 ? `-${index + 1}` : ""}`;
      let name = base;
      let suffix = 2;
      while (filenames.has(name)) name = `${base}-${suffix++}`;
      filenames.add(name);
      const file = `${name}.svg`;
      files.push({ name: file, content: serialize(root) });
      manifest.push({ name: item.name, file, source: candidate.source, status: candidate.status, treatment: candidate.treatment, pairId: candidate.pairId, standards: item.standards ? {...item.standards, ...(candidate.treatment ? {style:candidate.treatment} : {})} : null, ...(!item.standards ? { standardsNote: "No standards snapshot was recorded for this icon. Inspect the SVG to verify its geometry." } : {}) });
      const symbol = root.ownerDocument.createElementNS(SVG_NS, "symbol");
      for (const attribute of Array.from(root.attributes)) {
        if (!["xmlns", "xmlns:xlink", "width", "height", "id", "role", "aria-hidden", "aria-label"].includes(attribute.name)) symbol.setAttribute(attribute.name, attribute.value);
      }
      symbol.setAttribute("id", name);
      while (root.firstChild) symbol.appendChild(root.firstChild);
      const ids = new Map<string, string>();
      for (const node of Array.from(symbol.querySelectorAll("[id]"))) {
        const original = node.getAttribute("id")!;
        const scoped = `${name}--${original}`;
        ids.set(original, scoped);
        node.setAttribute("id", scoped);
      }
      for (const node of [symbol, ...Array.from(symbol.querySelectorAll("*"))]) {
        for (const attribute of Array.from(node.attributes)) {
          const local = attribute.value.match(/^url\(\s*#([^\s)]+)\s*\)$/);
          if (local && ids.has(local[1])) node.setAttribute(attribute.name, `url(#${ids.get(local[1])})`);
          if (["href", "xlink:href"].includes(attribute.name) && ids.has(attribute.value.slice(1))) node.setAttribute(attribute.name, `#${ids.get(attribute.value.slice(1))}`);
        }
      }
      symbols.push(serialize(symbol));
    }
  }
  if (!files.length) throw new Error("Add at least one icon before exporting a set.");
  files.push({ name: "sprite.svg", content: `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">${symbols.join("")}</svg>` });
  files.push({ name: "manifest.json", content: JSON.stringify({ product: "Iconoclast.ai", version: 1, workspaceStandards: standards, standardsNote: "Workspace settings may differ from the settings used for an earlier accepted icon. Each icon records its own standards snapshot when available; snapshots describe intended settings, not a guarantee of visual compliance.", selection: "Accepted candidates, otherwise shortlisted candidates, otherwise the first candidate for each icon.", icons: manifest }, null, 2) });
  files.push({ name: "README.txt", content: "Iconoclast.ai SVG export\n\nIndividual SVGs are ready to use. sprite.svg contains named <symbol> elements.\nReference a symbol with <svg viewBox=\"0 0 24 24\"><use href=\"sprite.svg#icon-name\" /></svg>, adapting the viewBox to your grid.\n\nmanifest.json records your standards and each exported candidate's source and review status.\nSelection: accepted candidates first; otherwise shortlisted candidates; otherwise the first candidate.\nDemo candidates are curated examples, not AI-generated results.\n" });
  return files;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A standards-compliant uncompressed ZIP; no dependency or upload is needed. */
export function createZip(files: ExportFile[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(12, 33, true); // A stable valid DOS date: 1980-01-01.
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    chunks.push(local);
    const directory = new Uint8Array(46 + name.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(8, 0x0800, true);
    directoryView.setUint16(14, 33, true);
    directoryView.setUint32(16, crc, true);
    directoryView.setUint32(20, data.length, true);
    directoryView.setUint32(24, data.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory);
    centralSize += directory.length;
    offset += local.length;
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let position = 0;
  for (const chunk of [...chunks, ...central, end]) { output.set(chunk, position); position += chunk.length; }
  return output;
}

export function exportSet(items: IconItem[], standards: Standards): void {
  const zip = createZip(buildExportBundle(items, standards));
  download(new Blob([zip], { type: "application/zip" }), "iconoclast-icon-set.zip");
}
