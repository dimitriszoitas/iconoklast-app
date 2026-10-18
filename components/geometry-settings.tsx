import type { Standards } from '@/lib/icon-types';
import ConstructionGuide from './construction-guide';
import './geometry-settings.css';

type Props = { standards: Standards; onChange: (patch: Partial<Standards>) => void; disabled?: boolean; compact?: boolean };
const grids = [
  { value: 'none', label: 'None' },
  { value: 'keyline', label: 'Keylines' },
  { value: 'concentric', label: 'Concentric' },
] as const;

export default function GeometrySettings({ standards, onChange, disabled, compact }: Props) {
  const square = standards.proportion === 'square';
  const grid = standards.constructionGrid || 'none';
  const keyline = (units:number) => Number((units*standards.gridSize/24).toFixed(2));
  return <section className={`geometry-settings${compact ? ' geometry-settings-compact' : ''}`} aria-label="Proportions and construction">
    {!compact && <div className="geometry-settings-heading"><strong>Proportions &amp; construction</strong><span>A balanced family of icons</span></div>}
    <div className="geometry-settings-fields">
      <fieldset disabled={disabled}>
        <legend>Square ratio</legend>
        <div className="geometry-ratio-choices">
          <button type="button" aria-pressed={!square} className={!square ? 'chosen' : ''} onClick={() => onChange({ proportion: 'natural' })}><span className="geometry-ratio-symbol natural" aria-hidden="true" />Natural</button>
          <button type="button" aria-pressed={square} className={square ? 'chosen' : ''} onClick={() => onChange({ proportion: 'square' })}><span className="geometry-ratio-symbol square" aria-hidden="true" />Square · 1:1</button>
        </div>
        <p>{square ? 'Design the visible artwork with equal height and width, balanced around the center. Shapes are redesigned, never stretched.' : 'Let the subject keep its natural proportions, with balanced spacing inside the square canvas.'}</p>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Construction grid</legend>
        <div className="geometry-grid-choices">{grids.map(({ value, label }) => <button type="button" key={value} className={grid === value ? 'chosen' : ''} aria-pressed={grid === value} onClick={() => onChange({ constructionGrid: value })}>
          {value === 'none' ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="1" stroke="currentColor" strokeWidth=".35" strokeDasharray="1 1" /><path d="m8 16 8-8" stroke="currentColor" strokeWidth=".65" /></svg> : <ConstructionGuide grid={value} gridSize={standards.gridSize} padding={standards.padding} />}
          <span>{label}</span>
        </button>)}</div>
        <p>{grid === 'none' ? 'Free construction within your optical padding.' : grid === 'keyline' ? `${standards.gridSize} × ${standards.gridSize} unit grid. ${keyline(20)} × ${keyline(20)} circle and square; ${keyline(18)} × ${keyline(20)} and ${keyline(20)} × ${keyline(18)} rectangles.` : `${standards.gridSize} × ${standards.gridSize} unit grid. ${keyline(20)} × ${keyline(20)} boundary and outer circle, with smaller concentric circles.`} {grid !== 'none' && 'Each small square is one unit. Artwork size below controls the fitting target.'}</p>
      </fieldset>
    </div>
  </section>;
}
