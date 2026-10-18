import type { Standards } from './icon-types';
import { sanitizeSvg } from './icon-engine.ts';
import { loadPaper, disposePaperScope } from './load-paper.ts';
import { exportVectorSvg, importVectorSvg, recoverEditableCorners } from './vector-editor-geometry.ts';
import { fitVectorToGrid } from './vector-grid-fit.ts';

/** Fit an existing design while retaining its own editable corner radii. */
export async function fitSvgToGrid(svg: string, standards: Standards): Promise<string> {
  const safe = sanitizeSvg(svg);
  const library = await loadPaper();
  const scope = new library.PaperScope();
  scope.setup(new library.Size(standards.gridSize, standards.gridSize));
  try {
    const doc = importVectorSvg(scope, safe);
    const shapes = doc.shapes.map(shape => recoverEditableCorners(scope, shape));
    const fitted = fitVectorToGrid(scope, { ...doc, shapes }, standards);
    const root = new DOMParser().parseFromString(safe, 'image/svg+xml').documentElement;
    const nativeCanvas = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number).every((value, index) => value === [0, 0, standards.gridSize, standards.gridSize][index])
      && Number(root.getAttribute('width')?.replace(/px$/, '')) === standards.gridSize && Number(root.getAttribute('height')?.replace(/px$/, '')) === standards.gridSize;
    // Importing a path rounds Paper's internal representation. If no fit or
    // stroke change was needed, keep the existing precise construction metadata.
    if (nativeCanvas && root.getAttribute("data-iconify-junctions") === "1" && fitted.shapes.every((shape, index) => shape.d === doc.shapes[index].d && shape.cornerRadius === doc.shapes[index].cornerRadius && shape.strokeWidth === doc.shapes[index].strokeWidth)) return safe;
    return sanitizeSvg(exportVectorSvg(fitted, scope));
  } finally {
    disposePaperScope(scope);
  }
}
