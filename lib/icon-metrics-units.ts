import { METRICS_RASTER_SIZE, type PaintedMetrics } from './icon-metrics.ts';
import { getSvgCanvas } from './svg-preview-space.ts';

/** Convert the uniformly contained measurement raster back to actual SVG units. */
export function getArtworkDimensionsInUnits(svg: string, bounds: PaintedMetrics['bounds']) {
  const canvas = getSvgCanvas(svg);
  if (!canvas) return null;
  // Measurement uses a square viewport with xMidYMid meet. Both axes share
  // the same scale, including the letterboxing around rectangular artboards.
  const unitsPerPixel = Math.max(canvas.width, canvas.height) / METRICS_RASTER_SIZE;
  return {
    artwork: { width: bounds.width * unitsPerPixel, height: bounds.height * unitsPerPixel },
    canvas: { width: canvas.width, height: canvas.height },
  };
}
