export type SvgCanvas = { x: number; y: number; width: number; height: number };

function svgAttributes(svg: string): Map<string, string> {
  // Read only the root opening tag; this works during server rendering too.
  const opening = svg.match(/<svg\b(?:[^<>"']|"[^"]*"|'[^']*')*>/i)?.[0] || '';
  return new Map(Array.from(opening.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g), match => [match[1], match[3]]));
}

const dimension = (value?: string) => value && /^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?\s*$/i.test(value) ? Number(value.trim().replace(/px$/i, '')) : NaN;

function canvasFromAttributes(attributes: Map<string, string>): SvgCanvas | null {
  const box = attributes.get('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    return { x: box[0], y: box[1], width: box[2], height: box[3] };
  }
  const width = dimension(attributes.get('width')), height = dimension(attributes.get('height'));
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { x: 0, y: 0, width, height } : null;
}

/** Actual SVG coordinates, independent of the currently selected standards. */
export function getSvgCanvas(svg: string): SvgCanvas | null {
  return canvasFromAttributes(svgAttributes(svg));
}

/** Match the image's contained viewport as well as its internal SVG coordinates. */
export function getSvgPreviewSpace(svg: string) {
  const attributes = svgAttributes(svg);
  const canvas = canvasFromAttributes(attributes);
  if (!canvas) return null;
  const width = dimension(attributes.get('width')), height = dimension(attributes.get('height'));
  const ratio = width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? width / height : canvas.width / canvas.height;
  const viewportWidth = Math.min(1, ratio), viewportHeight = Math.min(1, 1 / ratio);
  return {
    canvas,
    preserveAspectRatio: attributes.get('preserveAspectRatio') || 'xMidYMid meet',
    viewport: { x: (1 - viewportWidth) / 2, y: (1 - viewportHeight) / 2, width: viewportWidth, height: viewportHeight },
  };
}
