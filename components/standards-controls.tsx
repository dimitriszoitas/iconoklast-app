'use client';

import { useId } from 'react';
import { Grid2X2, Layers, LoaderCircle, Maximize2, MoveHorizontal, Palette, PenTool } from 'lucide-react';
import type { Standards } from '@/lib/icon-types';
import { resolveArtworkFit } from '@/lib/artwork-fit';
import type { Creativity } from './creative-direction';
import ColorPalette from './color-palette';
import SpacingSettings from './spacing-settings';
import StudioSelect from './studio-select';
import './standards-controls.css';

type Props = {
  standards: Standards;
  onChange: (patch: Partial<Standards>) => void;
  creativity: Creativity;
  onCreativityChange: (value: Creativity) => void;
  disabled?: boolean;
  count: number;
  canFit: boolean;
  fitting: boolean;
  onFit: () => void;
};

const STYLES = [
  { value: 'line', label: 'Outlined' },
  { value: 'filled', label: 'Filled' },
  { value: 'combined', label: 'Combined' },
  { value: 'both', label: 'Both' },
] as const;
const GRIDS = [
  { value: 'none', label: 'None' },
  { value: 'keyline', label: 'Keylines' },
  { value: 'concentric', label: 'Concentric' },
] as const;
const formatUnit = (value: number) => Number(value.toFixed(2)).toString();

function StyleSample({ style, rounded }: { style: typeof STYLES[number]['value']; rounded: boolean }) {
  const corner = rounded ? 1.5 : 0;
  return <svg className="std-style-sample" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {style === 'both' ? <>
      <rect x="2" y="6" width="8" height="12" rx={corner} stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 10h2m-2 4h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap={rounded ? 'round' : 'butt'} />
      <rect x="14" y="6" width="8" height="12" rx={corner} fill="currentColor" />
      <path d="M17 10h2m-2 4h2" stroke="var(--surface, #fff)" strokeWidth="1.5" strokeLinecap={rounded ? 'round' : 'butt'} />
    </> : <>
      <rect x="5" y="4" width="14" height="16" rx={corner} stroke="currentColor" strokeWidth="1.5" fill={style === 'filled' ? 'currentColor' : 'none'} />
      {style === 'combined' && <path d="M12 11h7v8a1 1 0 0 1-1 1h-6Z" fill="currentColor" />}
      <path d={style === 'combined' ? 'M9 8h6M9 12v4' : 'M9 8h6M9 12h6M9 16h3'} stroke={style === 'filled' ? 'var(--surface, #fff)' : 'currentColor'} strokeWidth="1.5" strokeLinecap={rounded ? 'round' : 'butt'} />
    </>}
  </svg>;
}

function GridSample({ grid }: { grid: typeof GRIDS[number]['value'] }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
    {grid === 'none' ? <><rect x="3" y="3" width="18" height="18" strokeDasharray="2 2" opacity=".6" /><path d="m6 18 12-12" /></> : <>
      <path d="M12 1v22M1 12h22M2 2l20 20M22 2 2 22" opacity=".4" />
      <rect x="2" y="2" width="20" height="20" rx="3" opacity=".6" />
      <circle cx="12" cy="12" r="10" />
      {grid === 'keyline' ? <><rect x="3" y="2" width="18" height="20" rx="2" /><rect x="2" y="3" width="20" height="18" rx="2" /></> : <><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="4" /></>}
    </>}
  </svg>;
}

export default function StandardsControls({ standards, onChange, creativity, onCreativityChange, disabled = false, count, canFit, fitting, onFit }: Props) {
  const id = useId();
  const fit = resolveArtworkFit(standards);
  const hasGuides = !!standards.constructionGrid && standards.constructionGrid !== 'none';
  const radius = standards.corner === 'square' ? 0 : standards.cornerRadius ?? 1;
  const previewRadius = Math.min(radius, standards.gridSize / 2);
  const currentStyle = standards.style === 'duotone' ? 'filled' : standards.style;

  return <div className="std-controls">
    <section className="std-section" aria-labelledby={`${id}-style`}>
      <h3 id={`${id}-style`} className="std-section-title"><Layers size={15} aria-hidden="true" />Style</h3>
      <div className="std-style-list" role="radiogroup" aria-labelledby={`${id}-style`}>
        {STYLES.map(style => <label key={style.value} className={`std-style-row ${currentStyle === style.value ? 'is-selected' : ''}`}>
          <StyleSample style={style.value} rounded={standards.corner === 'round'} />
          <span>{style.label}</span>
          <input type="radio" name={`${id}-style`} value={style.value} checked={currentStyle === style.value} disabled={disabled} onChange={() => onChange({ style: style.value })} />
        </label>)}
      </div>
      {currentStyle === 'both' && <p className="std-note">{count} directions, each with separate outlined and filled versions.</p>}
      <div className="std-choice-pair" role="group" aria-label="Edge shape">
        <button type="button" disabled={disabled} aria-pressed={standards.corner === 'round'} onClick={() => onChange({ corner: 'round' })}>
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 16V9a5 5 0 0 1 5-5h7" strokeLinecap="round" /></svg>Rounded
        </button>
        <button type="button" disabled={disabled} aria-pressed={standards.corner === 'square'} onClick={() => onChange({ corner: 'square' })}>
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 16V4h12" /></svg>Rough edges
        </button>
      </div>
      <div className="std-field">
        <span className="std-field-label" id={`${id}-perspective`}>Perspective</span>
        <div className="std-choice-pair" role="group" aria-labelledby={`${id}-perspective`}>
          <button type="button" disabled={disabled} aria-pressed={standards.perspective !== 'isometric'} onClick={() => onChange({ perspective: 'front' })}>Face-on</button>
          <button type="button" disabled={disabled} aria-pressed={standards.perspective === 'isometric'} onClick={() => onChange({ perspective: 'isometric' })}>Isometric</button>
        </div>
      </div>
    </section>

    <section className="std-section" aria-labelledby={`${id}-color`}>
      <h3 id={`${id}-color`} className="std-section-title"><Palette size={15} aria-hidden="true" />Color palette</h3>
      <ColorPalette standards={standards} onChange={onChange} disabled={disabled} />
    </section>

    <section className="std-section" aria-labelledby={`${id}-stroke`}>
      <h3 id={`${id}-stroke`} className="std-section-title"><PenTool size={15} aria-hidden="true" />Stroke &amp; corners</h3>
      <div className="std-range-control">
        <div className="std-field-heading"><label htmlFor={`${id}-weight`}>Stroke weight</label><output htmlFor={`${id}-weight`}>{formatUnit(standards.strokeWidth)} u</output></div>
        <div className="std-range-sample">
          <svg viewBox="0 0 12 6" aria-hidden="true"><path className="std-sample-grid" d="M0 0V6M1 0V6M2 0V6M3 0V6M4 0V6M5 0V6M6 0V6M7 0V6M8 0V6M9 0V6M10 0V6M11 0V6M12 0V6M0 0H12M0 1H12M0 2H12M0 3H12M0 4H12M0 5H12M0 6H12" /><path d="M2 3h8" fill="none" stroke="currentColor" strokeWidth={standards.strokeWidth} strokeLinecap={standards.corner === 'round' ? 'round' : 'butt'} /></svg>
          <input id={`${id}-weight`} type="range" aria-valuetext={`${formatUnit(standards.strokeWidth)} grid units`} min="0.5" max="4" step="0.25" value={standards.strokeWidth} disabled={disabled} onChange={event => onChange({ strokeWidth: Number(event.target.value) })} />
        </div>
      </div>
      <div className="std-range-control">
        <div className="std-field-heading"><label htmlFor={`${id}-radius`}>Corner radius</label><output htmlFor={`${id}-radius`}>{formatUnit(radius)} u</output></div>
        <div className={`std-range-sample ${standards.corner === 'square' ? 'is-disabled' : ''}`}>
          <svg viewBox={`0 0 ${standards.gridSize + 4} ${standards.gridSize / 2 + 4}`} fill="none" aria-hidden="true"><path d={`M2 ${standards.gridSize / 2 + 2}V2h${standards.gridSize}`} stroke="var(--border-strong, #b6c3cc)" strokeWidth=".6" strokeDasharray="1 1" /><path d={`M2 ${standards.gridSize / 2 + 2}V${2 + previewRadius}${previewRadius ? `a${previewRadius} ${previewRadius} 0 0 1 ${previewRadius} ${-previewRadius}` : ''}H${standards.gridSize + 2}`} stroke="currentColor" strokeWidth={standards.strokeWidth} /></svg>
          <input id={`${id}-radius`} type="range" aria-valuetext={`${formatUnit(radius)} grid units`} min="0" max={standards.gridSize / 2} step="0.25" value={radius} disabled={disabled || standards.corner === 'square'} onChange={event => onChange({ cornerRadius: Number(event.target.value) })} />
        </div>
      </div>
      <p className="std-note">1 u = 1 square = 1 export pixel. Weight updates live; radius guides new designs.</p>
    </section>

    <section className="std-section" aria-labelledby={`${id}-spacing`}>
      <h3 id={`${id}-spacing`} className="std-section-title"><MoveHorizontal size={15} aria-hidden="true" />Spacing &amp; padding</h3>
      <SpacingSettings standards={standards} onChange={onChange} disabled={disabled} />
    </section>

    <section className="std-section" aria-labelledby={`${id}-canvas`}>
      <h3 id={`${id}-canvas`} className="std-section-title"><Grid2X2 size={15} aria-hidden="true" />Canvas &amp; construction</h3>
      <div className="std-field">
        <span className="std-field-label" id={`${id}-grid-size`}>Canvas grid</span>
        <div className="std-choice-pair std-grid-sizes" role="group" aria-labelledby={`${id}-grid-size`}>
          {[16, 24, 32, 48].map(size => <button key={size} type="button" disabled={disabled} aria-label={`${size} by ${size} grid`} aria-pressed={standards.gridSize === size} onClick={() => onChange({ gridSize: size })}>{size}×{size}</button>)}
        </div>
      </div>
      <div className="std-field">
        <span className="std-field-label" id={`${id}-ratio`}>Artwork ratio</span>
        <div className="std-choice-pair" role="group" aria-labelledby={`${id}-ratio`}>
          <button type="button" disabled={disabled} aria-pressed={standards.proportion !== 'square'} onClick={() => onChange({ proportion: 'natural' })}>Natural</button>
          <button type="button" disabled={disabled} aria-pressed={standards.proportion === 'square'} onClick={() => onChange({ proportion: 'square' })} title="Design equal visible width and height without stretching">Square · 1:1</button>
        </div>
      </div>
      <div className="std-field">
        <div className="std-field-heading"><span id={`${id}-fit`}>Artwork size</span><span className="std-value">{formatUnit(fit.extent)} × {formatUnit(fit.extent)} u</span></div>
        <div className="std-choice-pair" role="group" aria-labelledby={`${id}-fit`}>
          <button type="button" disabled={disabled || !hasGuides} aria-pressed={fit.mode === 'keyline'} onClick={() => onChange({ artworkFit: 'keyline' })} title={hasGuides ? 'Fit to the construction keylines' : 'Choose Keylines or Concentric below to match keylines'}>Match keylines</button>
          <button type="button" disabled={disabled} aria-pressed={fit.mode === 'padding'} onClick={() => onChange({ artworkFit: 'padding' })}>Custom padding</button>
        </div>
      </div>
      <div className="std-field">
        <label className="std-field-label" htmlFor={`${id}-freedom`}>Creative freedom</label>
        <StudioSelect id={`${id}-freedom`} label="Creative freedom" size="sm" value={creativity} disabled={disabled} onValueChange={value => onCreativityChange(value as Creativity)} options={[
          { value: 'faithful', label: 'Refine the familiar' },
          { value: 'exploratory', label: 'Explore new forms' },
          { value: 'radical', label: 'Reimagine · Maximum creativity' },
        ]} />
      </div>
      <div className="std-field">
        <span className="std-field-label" id={`${id}-guides`}>Construction grid</span>
        <div className="std-guide-options" role="group" aria-labelledby={`${id}-guides`}>
          {GRIDS.map(grid => <button type="button" key={grid.value} disabled={disabled} aria-pressed={(standards.constructionGrid ?? 'none') === grid.value} onClick={() => onChange({ constructionGrid: grid.value })}><GridSample grid={grid.value} /><span>{grid.label}</span></button>)}
        </div>
      </div>
      <button type="button" className="std-fit-button" disabled={disabled || !canFit || fitting} onClick={onFit}>{fitting ? <LoaderCircle size={14} className="spin" /> : <Maximize2 size={14} />}Fit existing designs</button>
      <p className="std-note">{standards.gridSize} × {standards.gridSize} px SVG. Fit includes visible strokes.</p>
    </section>
  </div>;
}
