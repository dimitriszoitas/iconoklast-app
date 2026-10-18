import type paper from 'paper';
import { importVectorSvg, renderedPathData } from './vector-editor-geometry.ts';
import { vectorJunctionCaps } from './vector-junction-caps.ts';
import { disposePaperScope } from './load-paper.ts';

/** Update derived caps after a live width change, without serializing or
 * rewriting any original path. Paper is loaded by generation and the editor.
 */
export function refreshSvgJunctionCaps(svg: string): string {
  if (typeof window === 'undefined') return svg;
  const library = (window as unknown as { paper?: typeof paper }).paper;
  if (!library) return svg;
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (root.getAttribute('data-iconify-junctions') !== '1') return svg;
  // Our exports use flat, native-unit paths. Leave arbitrary external SVG
  // transforms and inherited presentation alone.
  const sources = Array.from(root.children).filter(node => node.getAttribute('data-iconify-junction-cap') !== '1');
  if (!sources.length || sources.some(node => node.localName !== 'path' || node.hasAttribute('transform'))) return svg;
  const scope = new library.PaperScope();
  scope.setup(new library.Size(24, 24));
  try {
    const doc = importVectorSvg(scope, svg);
    if (doc.shapes.length !== sources.length) return svg;
    const caps = vectorJunctionCaps(scope, doc.shapes.map(shape => ({ ...shape, d: renderedPathData(scope, shape) })));
    for (const cap of Array.from(root.querySelectorAll('[data-iconify-junction-cap="1"]'))) cap.remove();
    doc.shapes.forEach((shape, index) => {
      for (const cap of caps.filter(cap => cap.shapeId === shape.id)) {
        const node = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        for (const [name, value] of Object.entries({ 'data-iconify-junction-cap': '1', d: cap.d, fill: 'none', stroke: shape.stroke, 'stroke-width': String(shape.strokeWidth), 'stroke-linecap': 'square' })) node.setAttribute(name, value);
        root.insertBefore(node, sources[index].nextSibling);
      }
    });
    return new XMLSerializer().serializeToString(root);
  } finally { disposePaperScope(scope); }
}
