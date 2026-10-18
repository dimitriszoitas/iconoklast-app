import { useId } from 'react';
import { getConstructionGuides } from '@/lib/construction-grid';
import type { Standards } from '@/lib/icon-types';
import type { SvgCanvas } from '@/lib/svg-preview-space';

type Props = {
  grid: NonNullable<Standards['constructionGrid']>;
  gridSize?: number;
  padding?: number;
  artworkPadding?: number;
  className?: string;
  canvas?: SvgCanvas;
  preserveAspectRatio?: string;
  viewport?: { x: number; y: number; width: number; height: number };
};

/** Display-only guides. They are never part of an icon's SVG document. */
export function GuideShapes({ grid, gridSize = 24, canvas = { x: 0, y: 0, width: gridSize, height: gridSize }, artworkPadding, strokeWidth = Math.max(canvas.width, canvas.height) / 190, showGrid = true }: Omit<Props, 'className'> & { strokeWidth?: number; showGrid?: boolean }) {
  const id = useId().replace(/:/g, '');
  const scale = Math.min(canvas.width, canvas.height) / 24;
  const x = canvas.x + (canvas.width - 24 * scale) / 2;
  const y = canvas.y + (canvas.height - 24 * scale) / 2;
  if (grid === 'none') return null;
  return <g fill="none" pointerEvents="none" aria-hidden="true" data-construction-guide={grid}>
    <defs>
      <clipPath id={`${id}-clip`}><rect x={canvas.x} y={canvas.y} width={canvas.width} height={canvas.height}/></clipPath>
      <pattern id={`${id}-grid`} x={canvas.x} y={canvas.y} width={1} height={1} patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" stroke="#9bb0c0" strokeWidth={strokeWidth * .55} opacity={.48}/></pattern>
    </defs>
    <g clipPath={`url(#${id}-clip)`}>
      {showGrid && <rect x={canvas.x} y={canvas.y} width={canvas.width} height={canvas.height} fill={`url(#${id}-grid)`}/>}
      {/* Reference shapes fit the actual artboard; the one-unit grid is never scaled. */}
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        {getConstructionGuides(grid, 24, 0).filter(guide => guide.role !== 'minor').map((guide, index) => {
          const appearance = {
            stroke: guide.role === 'boundary' ? '#718896' : '#577c98',
            strokeWidth: strokeWidth / scale,
            opacity: .72,
          };
          if (guide.type === 'line') return <line key={index} x1={guide.x1} y1={guide.y1} x2={guide.x2} y2={guide.y2} {...appearance} />;
          if (guide.type === 'rect') return <rect key={index} x={guide.x} y={guide.y} width={guide.width} height={guide.height} rx={guide.rx} {...appearance} />;
          return <circle key={index} cx={guide.cx} cy={guide.cy} r={guide.r} {...appearance} />;
        })}
      </g>
      {artworkPadding !== undefined && Number.isFinite(artworkPadding) && artworkPadding > 2 * scale && artworkPadding < 12 * scale && <rect
        data-artwork-boundary="padding"
        x={x + artworkPadding} y={y + artworkPadding}
        width={24 * scale - 2 * artworkPadding} height={24 * scale - 2 * artworkPadding}
        stroke="#1f883d" strokeWidth={strokeWidth}
        strokeDasharray={`${strokeWidth * 3} ${strokeWidth * 2}`}
      />}
    </g>
  </g>;
}

export default function ConstructionGuide({ grid, gridSize = 24, canvas = { x: 0, y: 0, width: gridSize, height: gridSize }, artworkPadding, className, preserveAspectRatio = 'xMidYMid meet', viewport }: Props) {
  return <svg className={className} viewBox={`${canvas.x} ${canvas.y} ${canvas.width} ${canvas.height}`} preserveAspectRatio={preserveAspectRatio} fill="none" aria-hidden="true" focusable="false" style={{ pointerEvents: 'none', ...(viewport ? { inset: 'auto', left: `${viewport.x * 100}%`, top: `${viewport.y * 100}%`, width: `${viewport.width * 100}%`, height: `${viewport.height * 100}%` } : {}) }}>
    <GuideShapes grid={grid} canvas={canvas} artworkPadding={artworkPadding} />
  </svg>;
}
