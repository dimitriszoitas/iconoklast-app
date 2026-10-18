'use client';

import { useId, type KeyboardEvent } from 'react';
import { resolveArtworkFit } from '@/lib/artwork-fit';
import type { Standards } from '@/lib/icon-types';
import './spacing-settings.css';

type Props = {
  standards: Standards;
  onChange: (patch: Partial<Standards>) => void;
  disabled?: boolean;
};

const units = (value: number) => Number(value.toFixed(2)).toString();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function Preview({ gridSize, value, kind, id }: { gridSize: number; value: number; kind: 'spacing' | 'padding'; id: string }) {
  const isPadding = kind === 'padding';
  const height = isPadding ? gridSize : gridSize / 2;
  const barWidth = Math.min(6, (gridSize - value - 4) / 2);
  const barHeight = gridSize / 3;
  const left = (gridSize - value) / 2 - barWidth;
  const top = (height - barHeight) / 2;
  return <svg className={`spacing-settings-preview ${isPadding ? 'is-padding' : ''}`} viewBox={`0 0 ${gridSize} ${height}`} aria-hidden="true">
    <defs><pattern id={id} width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#dce5ea" strokeWidth=".035"/></pattern></defs>
    <rect width={gridSize} height={height} fill={`url(#${id})`}/>
    {isPadding ? <>
      <rect x=".12" y=".12" width={gridSize - .24} height={gridSize - .24} fill="none" stroke="#9bafb9" strokeWidth=".24"/>
      <rect x={value} y={value} width={Math.max(0, gridSize - value * 2)} height={Math.max(0, gridSize - value * 2)} fill="#e1efe5" stroke="#1f883d" strokeWidth=".24"/>
      <path d={`M.25 ${gridSize / 2}H${value}M.25 ${gridSize / 2 - 1}v2M${value} ${gridSize / 2 - 1}v2`} fill="none" stroke="#1f883d" strokeWidth=".25"/>
    </> : <>
      <rect x={left} y={top} width={barWidth} height={barHeight} fill="#596e7a"/>
      <rect x={left + barWidth + value} y={top} width={barWidth} height={barHeight} fill="#596e7a"/>
      <path d={`M${left + barWidth} ${height / 2}h${value}M${left + barWidth} ${height / 2 - 1}v2M${left + barWidth + value} ${height / 2 - 1}v2`} fill="none" stroke="#1f883d" strokeWidth=".25"/>
    </>}
  </svg>;
}

export default function SpacingSettings({ standards, onChange, disabled }: Props) {
  const uid = useId().replace(/:/g, '');
  const fit = resolveArtworkFit(standards);
  const hasGuides = standards.constructionGrid === 'keyline' || standards.constructionGrid === 'concentric';
  const minPadding = hasGuides ? standards.gridSize / 12 : 0;
  const maxPadding = Math.floor(Math.min(6, standards.gridSize / 3) * 2) / 2;
  const maxSpacing = standards.gridSize / 4;
  const spacing = clamp(standards.minSpacing ?? 1, 0, maxSpacing);
  const padding = fit.padding;
  const changePadding = (value: number) => onChange({
    artworkFit: 'padding',
    padding: value <= minPadding + .0001 ? minPadding : clamp(Math.round(value * 4) / 4, minPadding, maxPadding),
  });

  // Guide insets can be fractional (16 / 12). Keep their exact starting value,
  // while keyboard changes move through quarter-unit values inside the range.
  const onPaddingKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.ceil((padding + .0001) * 4) / 4;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.floor((padding - .0001) * 4) / 4;
    else if (event.key === 'PageUp') next = padding + 1;
    else if (event.key === 'PageDown') next = padding - 1;
    else if (event.key === 'Home') next = minPadding;
    else if (event.key === 'End') next = maxPadding;
    else return;
    event.preventDefault();
    changePadding(next);
  };

  return <div className="spacing-settings">
    <div className="spacing-settings-row" title="Minimum gap between separate painted edges. Intentional joins stay connected. Applies to the next design or redesign.">
      <div className="spacing-settings-visual"><Preview gridSize={standards.gridSize} value={spacing} kind="spacing" id={`${uid}-spacing-grid`}/></div>
      <div className="spacing-settings-control">
        <div className="spacing-settings-heading"><label htmlFor={`${uid}-spacing`}>Spacing</label><output htmlFor={`${uid}-spacing`}>{units(spacing)} <span>u</span></output></div>
        <input id={`${uid}-spacing`} type="range" aria-label="Minimum internal spacing" min="0" max={maxSpacing} step=".25" value={spacing} disabled={disabled} onChange={event => onChange({ minSpacing: Number(event.target.value) })} aria-valuetext={`${units(spacing)} grid units`}/>
        <span className="spacing-settings-caption">Between elements</span>
      </div>
    </div>
    <div className="spacing-settings-row" title={hasGuides ? 'Space around the artwork. Changing this uses custom padding; the construction keyline inset is the minimum.' : 'Space around the artwork, measured in grid units.'}>
      <div className="spacing-settings-visual"><Preview gridSize={standards.gridSize} value={padding} kind="padding" id={`${uid}-padding-grid`}/></div>
      <div className="spacing-settings-control">
        <div className="spacing-settings-heading"><label htmlFor={`${uid}-padding`}>Padding</label><output htmlFor={`${uid}-padding`}>{units(padding)} <span>u</span></output></div>
        <input id={`${uid}-padding`} type="range" aria-label="Optical padding" min={minPadding} max={maxPadding} step="any" value={padding} disabled={disabled} onChange={event => changePadding(Number(event.target.value))} onKeyDown={onPaddingKeyDown} aria-valuetext={`${units(padding)} grid units${fit.mode === 'keyline' ? ', matching keylines' : ''}`}/>
        <span className="spacing-settings-caption">Around artwork{fit.mode === 'keyline' ? ' · Auto' : ''}</span>
      </div>
    </div>
  </div>;
}
