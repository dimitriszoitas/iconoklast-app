import type { Standards } from './icon-types';
import { loadPaper, disposePaperScope } from './load-paper.ts';
import { exportVectorSvg, importVectorSvg, recoverEditableCorners } from './vector-editor-geometry.ts';
import { fitVectorToGrid } from './vector-grid-fit.ts';

/** Keep a sharp construction path alongside the rounded, portable SVG artwork. */
export async function applyEditableCorners(svg: string, standards: Standards): Promise<string> {
  const library = await loadPaper();
  const scope = new library.PaperScope();
  scope.setup(new library.Size(standards.gridSize, standards.gridSize));
  try {
    const doc = importVectorSvg(scope, svg);
    const radius = standards.corner === 'square' ? 0 : Math.min(standards.gridSize / 2, Math.max(0, standards.cornerRadius ?? 1));
    const shapes = doc.shapes.map(shape => ({ ...recoverEditableCorners(scope, shape, { preserveAppearance: false }), cornerRadius: radius, lineJoin: 'miter' as const }));
    return exportVectorSvg(fitVectorToGrid(scope, { ...doc, shapes }, standards), scope);
  } finally {
    disposePaperScope(scope);
  }
}
