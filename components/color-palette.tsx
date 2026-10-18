'use client';

import { LockKeyhole, Plus, RotateCcw, X } from 'lucide-react';
import type { PaletteColor, Standards } from '@/lib/icon-types';
import { addPaletteColor, getPalette, removePaletteColor, setPalettePercentage, unlockPaletteColor } from '@/lib/color-palette';
import './color-palette.css';

const SUGGESTED_COLORS = ['#252331', '#39796b', '#4e73b8', '#b86b45', '#7254d4', '#d16483'];

export default function ColorPalette({ standards, onChange, disabled = false }: {
  standards: Standards;
  onChange: (patch: Partial<Standards>) => void;
  disabled?: boolean;
}) {
  const colored = standards.colorMode === 'color' || standards.colorMode === 'duo' || (!standards.colorMode && standards.style === 'duotone');
  const palette = getPalette({ ...standards, colorMode: 'color' });
  const updatePalette = (next: PaletteColor[]) => onChange({ palette: next, primaryColor: next[0].color, secondaryColor: next[1]?.color ?? next[0].color });
  const updateColor = (index: number, color: string) => updatePalette(palette.map((entry, i) => i === index ? { ...entry, color } : entry));
  const addColor = () => updatePalette(addPaletteColor(palette, SUGGESTED_COLORS.find(color => !palette.some(entry => entry.color.toLowerCase() === color)) ?? '#4e73b8'));

  return <fieldset className="icon-palette" disabled={disabled} aria-label="Icon color palette">
    <div className="segmented-control palette-mode">
      <button type="button" aria-pressed={!colored} className={!colored ? 'active' : ''} onClick={() => onChange({ colorMode: 'mono' })}>Monochrome</button>
      <button type="button" aria-pressed={colored} className={colored ? 'active' : ''} onClick={() => onChange({ colorMode: 'color', palette })}>Color</button>
    </div>
    {colored ? <>
      <div className="palette-proportions" aria-label="Color proportions">{palette.map((entry, index) => <span key={index} style={{ background: entry.color, flexGrow: entry.percentage }} title={`Color ${index + 1}: ${entry.percentage}%`} />)}</div>
      <div className="palette-entries">{palette.map((entry, index) => <div className="palette-entry" key={index}>
        <div className="palette-paint"><input type="color" aria-label={`Color ${index + 1}`} value={entry.color} onChange={event => updateColor(index, event.target.value)} /><span>{entry.color.toUpperCase()}</span></div>
        <label className="palette-percentage"><input type="number" aria-label={`Color ${index + 1} percentage`} min={0} max={100} step={1} readOnly={!entry.locked && palette.filter(color => !color.locked).length === 1} title={!entry.locked && palette.filter(color => !color.locked).length === 1 ? "Remaining share. Reset a fixed color to automatic to redistribute it." : "Percentage of visible color coverage"} onFocus={event => event.currentTarget.select()} value={entry.percentage} onChange={event => { if (event.target.value !== '') updatePalette(setPalettePercentage(palette, index, Number(event.target.value))); }} /><span>%</span></label>
        <button type="button" className={`palette-allocation ${entry.locked ? 'is-fixed' : ''}`} disabled={!entry.locked} aria-label={entry.locked ? `Reset color ${index + 1} to automatic` : `Color ${index + 1} is automatic`} title={entry.locked ? 'Reset to an equal share of the remainder' : 'Shares the remaining percentage equally'} onClick={() => updatePalette(unlockPaletteColor(palette, index))}>{entry.locked ? <><LockKeyhole size={12} />Fixed</> : 'Auto'}</button>
        <button type="button" className="palette-remove" disabled={palette.length === 1} aria-label={`Remove color ${index + 1}`} title={`Remove color ${index + 1}`} onClick={() => updatePalette(removePaletteColor(palette, index))}><X size={14} /></button>
      </div>)}</div>
      <div className="palette-actions"><button type="button" className="text-button tertiary" disabled={palette.length >= 4} onClick={addColor}><Plus size={14} />Add color <span>{palette.length}/4</span></button><button type="button" className="palette-reset" disabled={!palette.some(entry => entry.locked)} onClick={() => updatePalette(palette.map(entry => ({ ...entry, locked: false, percentage: 100 / palette.length })))} aria-label="Split all colors equally" title="Split all colors equally"><RotateCcw size={14} /></button></div>
      <p className="palette-help" title="Percentages guide visible painted-area coverage in new designs.">Fixed shares stay; Auto colors split the rest.</p>
    </> : <div className="color-input"><input type="color" aria-label="Primary icon color" value={standards.primaryColor} onChange={event => updateColor(0, event.target.value)} /><span>{standards.primaryColor.toUpperCase()}</span><small>Primary</small></div>}
    {!colored && <div className="quick-colors">{SUGGESTED_COLORS.map(color => <button type="button" key={color} style={{ background: color }} className={standards.primaryColor === color ? 'active' : ''} aria-label={`Use color ${color}`} onClick={() => updateColor(0, color)} />)}</div>}
  </fieldset>;
}
