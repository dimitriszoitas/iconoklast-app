'use client';

import { useEffect, useRef, useState } from 'react';
import { measureIcon, type IconMeasurement } from '../lib/icon-metrics';
import { getArtworkDimensionsInUnits } from '../lib/icon-metrics-units';
import './icon-metrics.css';

export type IconMetricsProps = { svg: string; targetSquare?: boolean; compact?: boolean };

export default function IconMetrics({ svg, targetSquare = false, compact = false }: IconMetricsProps) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [measurement, setMeasurement] = useState<{ svg: string; result: IconMeasurement } | null>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let active = true;
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => { if (active) setVisible(true); });
      return () => { active = false; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '150px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void measureIcon(svg).then((result) => { if (active) setMeasurement({ svg, result }); });
    return () => { active = false; };
  }, [svg, visible]);
  const result = measurement?.svg === svg ? measurement.result : null;
  const className = `icon-metrics${compact ? ' icon-metrics-compact' : ''}`;
  if (!result) return <div ref={element} className={className}><span className="icon-metrics-muted">{visible ? 'Measuring proportions…' : 'Artwork proportions'}</span></div>;
  if (result.status !== 'measured') return <div ref={element} className={className} title={result.reason}><span className="icon-metrics-muted">Ratio unavailable</span>{!compact && <p>{result.reason}</p>}</div>;
  const ratio = result.ratio.toFixed(2);
  const dimensions = getArtworkDimensionsInUnits(svg, result.bounds);
  const units = (value: number) => Number(value.toFixed(1));
  return <div ref={element} className={className}>
    <div className="icon-metrics-values"><span title="Width and height of visible painted artwork, measured at 512 px. Nearly transparent pixels below 8/255 alpha are ignored.">W:H <strong>{ratio}:1</strong></span>{targetSquare && <span className={`icon-metrics-badge ${result.nearSquare ? 'is-near' : 'needs-review'}`} title={`${result.squareDeviationPercent.toFixed(1)}% difference between the longer and shorter painted sides. Near 1:1 allows up to 5%.`}>{result.nearSquare ? 'Near 1:1' : 'Review ratio'}</span>}</div>
    {!compact && <>{dimensions && <p className="icon-metrics-dimensions" title="Approximate visible fill and stroke bounds in the SVG's own canvas units. Preview zoom does not change these dimensions."><span>Artwork <strong>≈{units(dimensions.artwork.width)} × {units(dimensions.artwork.height)} u</strong></span><span aria-hidden="true">·</span><span>Canvas <strong>{units(dimensions.canvas.width)} × {units(dimensions.canvas.height)} u</strong></span></p>}<p>Visual center offset: <strong>{result.centerOffset.distancePercent.toFixed(1)}%</strong> of the canvas.</p><p className="icon-metrics-muted">Artwork size includes visible fills and strokes. Proportions and center of mass help review balance; they do not guarantee perceptual balance.{result.touchesCanvasEdge ? ' Artwork touches the canvas edge; check for clipping.' : ''}</p></>}
  </div>;
}
