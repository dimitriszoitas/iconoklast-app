/** Ignore barely visible antialiasing (less than 8 / 255 alpha) at the painted edge. */
export const METRICS_ALPHA_THRESHOLD = 8;
export const METRICS_RASTER_SIZE = 512;
export const SQUARE_TOLERANCE_PERCENT = 5;

export type PaintedMetrics = {
  bounds: { x: number; y: number; width: number; height: number };
  /** Width divided by height of painted bounds, rather than the SVG canvas. */
  ratio: number;
  /** Symmetric deviation: (longer side / shorter side - 1) * 100. */
  squareDeviationPercent: number;
  nearSquare: boolean;
  /** Alpha-weighted pixel-center coordinates, including holes and stroke coverage. */
  centroid: { x: number; y: number };
  centerOffset: { xPercent: number; yPercent: number; distancePercent: number };
  touchesCanvasEdge: boolean;
};

export type IconMeasurement =
  | ({ status: 'measured' } & PaintedMetrics)
  | { status: 'empty' | 'unavailable'; reason: string };

/**
 * Measures RGBA pixels on a transparent canvas. RGB does not affect coverage, so
 * white paint counts and transparent pixels do not. Holes affect the centroid;
 * painted bounds include strokes but not empty space within the icon.
 */
export function analyzeAlphaBounds(data: ArrayLike<number>, width: number, height: number): PaintedMetrics | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_777_216 || data.length !== width * height * 4) {
    throw new Error('A complete, bounded RGBA image is required to measure the icon.');
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let mass = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 255) throw new Error('The icon contains invalid alpha values.');
      if (alpha < METRICS_ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      mass += alpha;
      weightedX += (x + 0.5) * alpha;
      weightedY += (y + 0.5) * alpha;
    }
  }
  if (!mass) return null;
  const paintedWidth = maxX - minX + 1;
  const paintedHeight = maxY - minY + 1;
  const centroid = { x: weightedX / mass, y: weightedY / mass };
  const xPercent = (centroid.x - width / 2) / width * 100;
  const yPercent = (centroid.y - height / 2) / height * 100;
  const squareDeviationPercent = (Math.max(paintedWidth, paintedHeight) / Math.min(paintedWidth, paintedHeight) - 1) * 100;
  return {
    bounds: { x: minX, y: minY, width: paintedWidth, height: paintedHeight },
    ratio: paintedWidth / paintedHeight,
    squareDeviationPercent,
    nearSquare: squareDeviationPercent <= SQUARE_TOLERANCE_PERCENT + 1e-9,
    centroid,
    centerOffset: { xPercent, yPercent, distancePercent: Math.hypot(xPercent, yPercent) },
    touchesCanvasEdge: minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1,
  };
}

const measurements = new Map<string, Promise<IconMeasurement>>();
const CACHE_LIMIT = 128;

async function rasterizeAndMeasure(raw: string): Promise<IconMeasurement> {
  try {
    if (typeof document === 'undefined' || typeof Image === 'undefined') throw new Error('Measurement is available in the browser.');
    // Keep the math helper usable without a DOM; sanitize before loading any image.
    const { sanitizeSvg } = await import('./icon-engine');
    const root = new DOMParser().parseFromString(sanitizeSvg(raw), 'image/svg+xml').documentElement;
    // Fit the source viewBox uniformly in a square viewport. This never stretches
    // rectangular artwork to create a misleading 1:1 result.
    root.setAttribute('width', String(METRICS_RASTER_SIZE));
    root.setAttribute('height', String(METRICS_RASTER_SIZE));
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const svg = new XMLSerializer().serializeToString(root);
    return await new Promise<IconMeasurement>((resolve) => {
      const img = new Image();
      let settled = false;
      const finish = (result: IconMeasurement) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish({ status: 'unavailable', reason: 'The icon preview took too long to measure.' });
        img.src = '';
      }, 8000);
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = METRICS_RASTER_SIZE;
          canvas.height = METRICS_RASTER_SIZE;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Canvas measurement is unavailable.');
          // No background: painted alpha includes actual strokes, fills and masks.
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(img, 0, 0, canvas.width, canvas.height);
          const measured = analyzeAlphaBounds(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
          finish(measured ? { status: 'measured', ...measured } : { status: 'empty', reason: 'No visible artwork above the alpha threshold.' });
        } catch {
          finish({ status: 'unavailable', reason: 'This icon could not be measured in your browser.' });
        }
      };
      img.onerror = () => finish({ status: 'unavailable', reason: 'The icon could not be rendered for measurement.' });
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
  } catch {
    return { status: 'unavailable', reason: 'This icon could not be safely measured.' };
  }
}

/** Cached, browser-only measurement; never changes the source SVG or calls AI. */
export function measureIcon(svg: string): Promise<IconMeasurement> {
  const cached = measurements.get(svg);
  if (cached) {
    measurements.delete(svg);
    measurements.set(svg, cached);
    return cached;
  }
  const pending = rasterizeAndMeasure(svg);
  measurements.set(svg, pending);
  if (measurements.size > CACHE_LIMIT) measurements.delete(measurements.keys().next().value!);
  return pending;
}
