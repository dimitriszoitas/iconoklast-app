import type paper from 'paper';
import type { Standards } from './icon-types';
import { resolveArtworkFit } from './artwork-fit.ts';
import { vectorJunctionCaps } from './vector-junction-caps.ts';
import { paperItem, renderedPathData, type VectorBounds, type VectorDocument, type VectorShape } from './vector-editor-geometry.ts';

const FIT_TOLERANCE = 0.001;

function transformForFit(scope: paper.PaperScope, shape: VectorShape, scale: number, tx: number, ty: number): VectorShape {
  const item = paperItem(scope, shape);
  try {
    item.transform(new scope.Matrix(scale, 0, 0, scale, tx, ty));
    // Paper's default five-decimal serialization can turn tiny curve handles
    // into zero-length handles midway through the search. Keep the construction
    // precise so intrinsic curves do not suddenly become sharp corner candidates.
    const d = (item as paper.PathItem & { getPathData(matrix: null, precision: number): string }).getPathData(null, 12);
    const endpoints = shape.endpoints?.map(({ firstIn, lastOut }) => ({
      firstIn: { x: firstIn.x * scale, y: firstIn.y * scale },
      lastOut: { x: lastOut.x * scale, y: lastOut.y * scale },
    }));
    return { ...shape, d, ...(endpoints ? { endpoints } : {}) };
  } finally { item.remove(); }
}

function visibleColor(scope: paper.PaperScope, paint: string): paper.Color | null {
  if (!paint || paint === 'none') return null;
  const color = new scope.Color(paint);
  return color.alpha > 0 ? color : null;
}

/** Bounds of the rendered fillets and painted strokes, not the editable skeleton.
 * Paper includes caps, joins, and miters; dashed strokes use conservative bounds.
 */
export function paintedVectorBounds(scope: paper.PaperScope, shapes: VectorShape[]): VectorBounds | null {
  let bounds: paper.Rectangle | null = null;
  const rendered = shapes.map(shape => ({ ...shape, d: renderedPathData(scope, shape) }));
  const caps = vectorJunctionCaps(scope, rendered);
  const capShapes = caps.map(cap => ({ ...rendered.find(shape => shape.id === cap.shapeId)!, d: cap.d, fill: 'none', lineCap: 'square' as const, cornerRadius: 0 }));
  for (const shape of [...rendered, ...capShapes]) {
    if (shape.opacity <= 0) continue;
    const fill = visibleColor(scope, shape.fill);
    const stroke = shape.strokeWidth > 0 ? visibleColor(scope, shape.stroke) : null;
    if (!fill && !stroke) continue;
    const item = paperItem(scope, { d: shape.d, fillRule: shape.fillRule });
    try {
      item.fillColor = fill;
      item.strokeColor = stroke;
      item.strokeWidth = shape.strokeWidth;
      item.strokeCap = shape.lineCap;
      item.strokeJoin = shape.lineJoin;
      item.miterLimit = shape.miterLimit ?? 4;
      const painted = item.strokeBounds;
      if (![painted.x, painted.y, painted.width, painted.height].every(Number.isFinite)) throw new Error('This icon has invalid painted bounds.');
      bounds = bounds ? bounds.unite(painted) : painted.clone();
    } finally { item.remove(); }
  }
  return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
}

/** Fit the visible icon to its usable grid, preserving proportions and absolute
 * stroke/corner units. Path coordinates are baked; no hidden fit transform remains.
 */
export function fitVectorToGrid(scope: paper.PaperScope, doc: VectorDocument, standards: Standards): VectorDocument {
  const { gridSize, padding, strokeWidth } = standards;
  if (!Number.isInteger(gridSize) || gridSize < 8 || gridSize > 256 || !Number.isFinite(padding) || padding < 0 || padding >= gridSize / 2 || !Number.isFinite(strokeWidth) || strokeWidth < 0.25 || strokeWidth > 12) {
    throw new Error('Choose a valid canvas grid, optical padding, and stroke weight before fitting.');
  }
  const { extent: available } = resolveArtworkFit(standards);
  const shapes = doc.shapes.map(shape => shape.opacity > 0 && shape.strokeWidth > 0 && visibleColor(scope, shape.stroke)
    ? { ...shape, strokeWidth } : shape);
  const initial = paintedVectorBounds(scope, shapes);
  if (!initial || Math.max(initial.width, initial.height) < 1e-8) throw new Error('This icon has no visible artwork to fit.');
  const sourceCenter = { x: initial.x + initial.width / 2, y: initial.y + initial.height / 2 };
  const centerShapes = (fitted: VectorShape[], bounds: VectorBounds) => {
    const tx = gridSize / 2 - bounds.x - bounds.width / 2;
    const ty = gridSize / 2 - bounds.y - bounds.height / 2;
    return Math.abs(tx) < FIT_TOLERANCE && Math.abs(ty) < FIT_TOLERANCE ? fitted
      : fitted.map(shape => transformForFit(scope, shape, 1, tx, ty));
  };
  // Preserve already-fitted path data rather than introduce rounding drift on
  // each click or round trip through the editor.
  if (Math.abs(Math.max(initial.width, initial.height) - available) < FIT_TOLERANCE) {
    return { width: gridSize, height: gridSize, shapes: centerShapes(shapes, initial) };
  }
  const atScale = (scale: number) => {
    const scaled = shapes.map(shape => transformForFit(scope, shape, scale, -sourceCenter.x * scale, -sourceCenter.y * scale));
    const bounds = paintedVectorBounds(scope, scaled);
    if (!bounds) throw new Error('This icon has no visible artwork to fit.');
    return { shapes: scaled, bounds };
  };
  // Stroke thickness and live radii do not scale with the paths, so scaling the
  // initial painted box by a simple ratio would produce the wrong final size.
  const target = available - FIT_TOLERANCE / 10;
  const fits = (bounds: VectorBounds) => bounds.width <= target && bounds.height <= target;
  if (!fits(atScale(0.000001).bounds)) throw new Error('The selected stroke and corners cannot fit inside this grid. Reduce padding or choose a larger canvas.');
  let low = 0;
  let high = Math.max(1, available / Math.max(initial.width, initial.height));
  while (fits(atScale(high).bounds)) {
    low = high;
    high *= 2;
    if (high > 1_000_000) throw new Error('This artwork is too small or degenerate to fit reliably.');
  }
  for (let iteration = 0; iteration < 36; iteration++) {
    const scale = (low + high) / 2;
    if (fits(atScale(scale).bounds)) low = scale;
    else high = scale;
  }
  const fitted = atScale(low);
  // Very short paths can collapse at SVG serialization precision. Do not
  // mistake empty bounds for a successful fit of an oversized stroke. A small
  // gap is valid when conservative miter bounds change at a corner transition.
  if (Math.max(fitted.bounds.width, fitted.bounds.height) < FIT_TOLERANCE || !fits(fitted.bounds)) {
    throw new Error('The selected stroke and corners cannot fit inside this grid. Reduce padding or choose a larger canvas.');
  }
  return { width: gridSize, height: gridSize, shapes: centerShapes(fitted.shapes, fitted.bounds) };
}
