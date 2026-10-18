import type { Standards } from '@/lib/icon-types';
import { getSvgPreviewSpace } from '@/lib/svg-preview-space';
import { resolveArtworkFit } from '@/lib/artwork-fit';
import ConstructionGuide from './construction-guide';
import './icon-preview.css';

export default function IconPreview({ svg, label = '', size = 56, standards, showGuides = false }: { svg: string; label?: string; size?: number; standards?: Standards; showGuides?: boolean }) {
  const space = showGuides ? getSvgPreviewSpace(svg) : null;
  const fit = space && standards ? resolveArtworkFit({ ...standards, gridSize: Math.min(space.canvas.width, space.canvas.height) }) : null;
  return <span className="guided-preview" style={{width:size,height:size}}>
    {/* The SVG artwork stays in its own image. Guides are display-only siblings. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={label} width={size} height={size} draggable={false}/>
    {space && standards?.constructionGrid && standards.constructionGrid !== 'none' && <ConstructionGuide className="icon-construction-overlay" grid={standards.constructionGrid} canvas={space.canvas} artworkPadding={fit?.mode === 'padding' ? fit.padding : undefined} preserveAspectRatio={space.preserveAspectRatio} viewport={space.viewport}/>}
  </span>;
}
