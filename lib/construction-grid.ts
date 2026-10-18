/** Construction references redrawn from the user's two grids; never icon artwork. */
export type ConstructionGrid = 'none' | 'keyline' | 'concentric';
export type GuideRole = 'minor' | 'major' | 'boundary';
export type GuidePrimitive =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; role: GuideRole }
  | { type: 'rect'; x: number; y: number; width: number; height: number; rx: number; role: GuideRole }
  | { type: 'circle'; cx: number; cy: number; r: number; role: GuideRole };

export const GRID_LABELS: Record<ConstructionGrid, string> = { none: 'No construction grid', keyline: 'Keylines', concentric: 'Concentric' };
export const CONSTRUCTION_BASE_SIZE = 24;

export function getConstructionGuides(grid: ConstructionGrid, gridSize = 24, padding = 2): GuidePrimitive[] {
  if (grid === 'none') return [];
  if (!['keyline', 'concentric'].includes(grid) || !Number.isInteger(gridSize) || gridSize < 8 || gridSize > 256 || !Number.isFinite(padding) || padding < 0 || padding >= gridSize / 2) throw new Error('Invalid construction grid settings.');
  const scale = gridSize / CONSTRUCTION_BASE_SIZE;
  const c = gridSize / 2;
  const result: GuidePrimitive[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, role: GuideRole = 'major') => result.push({ type: 'line', x1, y1, x2, y2, role });
  const rect = (width: number, height: number, rx: number, role: GuideRole = 'major') => result.push({ type: 'rect', x: c - width / 2, y: c - height / 2, width, height, rx, role });
  const circle = (r: number) => result.push({ type: 'circle', cx: c, cy: c, r, role: 'major' });
  // One construction cell is one SVG unit and one pixel at the export size.
  // Optical padding applies to the artwork; it must not resize the references.
  for (let v = 0; v <= gridSize; v++) {
    line(v, 0, v, gridSize, 'minor'); line(0, v, gridSize, v, 'minor');
  }
  if (grid === 'keyline') {
    // Reference 1: a 20×20 circle and square, with 18×20 / 20×18 frames.
    circle(10 * scale);
    rect(20 * scale, 20 * scale, scale);
    rect(18 * scale, 20 * scale, scale);
    rect(20 * scale, 18 * scale, scale);
    for (const v of [c - 3 * scale, c, c + 3 * scale]) { line(v, 0, v, gridSize); line(0, v, gridSize, v); }
  } else {
    // Reference 2: a 20×20 boundary and circle, preserving the inner circle ratios.
    rect(20 * scale, 20 * scale, 4.4 * scale, 'boundary');
    const outerRadius = 10 * scale;
    const innerRadius = outerRadius * .187 / .435;
    for (const ratio of [1, .263 / .435, .187 / .435]) circle(outerRadius * ratio);
    for (const v of [c - innerRadius, c, c + innerRadius]) { line(v, 0, v, gridSize); line(0, v, gridSize, v); }
  }
  line(0, 0, gridSize, gridSize); line(gridSize, 0, 0, gridSize);
  return result;
}

const n = (value: number) => Number(value.toFixed(3));
export function describeConstructionGrid(grid: ConstructionGrid, gridSize = 24, padding = 2): string {
  if (grid === 'none') return 'No construction grid selected. Follow the canvas, padding, proportions and optical-balance requirements.';
  const guides = getConstructionGuides(grid, gridSize, padding).filter(g => g.role !== 'minor');
  const geometry = guides.map(g => g.type === 'line' ? `line (${n(g.x1)},${n(g.y1)})–(${n(g.x2)},${n(g.y2)})` : g.type === 'circle' ? `circle center (${n(g.cx)},${n(g.cy)}), radius ${n(g.r)}` : `rectangle x=${n(g.x)}, y=${n(g.y)}, width=${n(g.width)}, height=${n(g.height)}, guide corner radius=${n(g.rx)}`).join('; ');
  return `${GRID_LABELS[grid]} construction reference on a ${gridSize}×${gridSize} canvas, centered at (${gridSize / 2},${gridSize / 2}). The grid contains ${gridSize}×${gridSize} cells: 1 pixel = 1 SVG unit = 1 grid square. Use viewBox="0 0 ${gridSize} ${gridSize}" and width="${gridSize}" height="${gridSize}"; author geometry directly in those units without hidden scaling. Fractional coordinates are allowed for Bézier control points and optical adjustments. Its fixed 24-unit reference uses a 20×20 outer circle and square${grid === 'keyline' ? ', an 18×20 vertical rectangle and a 20×18 horizontal rectangle' : ', with smaller concentric circles'}; guide coordinates scale proportionally to the canvas size, independently of optical padding: ${geometry}. Optical padding is separately set to ${padding} canvas units and applies to the artwork, including strokes; changing it does not resize the grid or guide shapes. Use these keylines, intersections, diagonals and circles to organize the icon's major structure, spacing and curves. They are guides, not shapes to reproduce. Keep painted edges within the outer guide boundaries and the required optical padding; inset stroke centerlines accordingly. The chosen corner treatment controls the actual artwork; a rounded guide does not override Rough edges. When square proportion is selected, tall/wide guides may organize internal details but must not produce a tall/wide final silhouette. Never export the grid, reference frames, guide colors, or artificial background plates.`;
}
