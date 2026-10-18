import StudioSelect from './studio-select';
import ColorPalette from './color-palette';
import type { Standards } from '@/lib/icon-types';

export type Creativity = 'faithful' | 'exploratory' | 'radical';
type Props = { standards: Standards; onChange: (patch: Partial<Standards>) => void; creativity: Creativity; onCreativityChange: (value: Creativity) => void; disabled?: boolean };

function Example({ rounded, treatment = 'line' }: { rounded: boolean; treatment?: 'line' | 'filled' | 'combined' }) {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={rounded?'M5 7.5A1.5 1.5 0 0 1 6.5 6h11A1.5 1.5 0 0 1 19 7.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5Z':'M5 6h14v14H5Z'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin={rounded?'round':'miter'} fill={treatment==='filled'?'currentColor':'none'}/>
    <path d="M9 3v6m6-6v6" stroke={treatment==='filled'?'#f8f6ff':'currentColor'} strokeWidth="1.5" strokeLinecap={rounded?'round':'square'}/>
    <path d="M9 13h2v3H9z" fill="currentColor"/>
    {treatment==='combined'?<path d="M14 12h5v8h-5Z" fill="currentColor"/>:<path d="M14 14h2" stroke={treatment==='filled'?'#f8f6ff':'currentColor'} strokeWidth="1.5"/>}
  </svg>;
}
export default function CreativeDirection({standards,onChange,creativity,onCreativityChange,disabled}:Props) {
  return <section className="creative-settings" aria-label="Creative direction">
    <div className="creative-settings-title"><strong>Creative direction</strong><span>Applied to every new design</span></div>
    <div className="creative-settings-fields">
      <fieldset disabled={disabled}><legend>Character</legend><div className="creative-choice-pair">
        <button className={standards.corner==='square'?'chosen':''} aria-pressed={standards.corner==='square'} onClick={()=>onChange({corner:'square'})}><Example rounded={false}/><span><strong>Rough edges</strong><small>Square caps. Sharp corners.</small></span></button>
        <button className={standards.corner==='round'?'chosen':''} aria-pressed={standards.corner==='round'} onClick={()=>onChange({corner:'round'})}><Example rounded/><span><strong>Rounded</strong><small>Subtle curves. Gentle corners.</small></span></button>
      </div></fieldset>
      <fieldset disabled={disabled}><legend>Treatment</legend><div className="treatment-choices">{(['line','filled','combined'] as const).map(style=><button key={style} className={standards.style===style?'chosen':''} aria-pressed={standards.style===style} onClick={()=>onChange({style})}><Example rounded={standards.corner==='round'} treatment={style}/><strong>{style==='line'?'Outlined':style==='filled'?'Filled':'Combined'}</strong></button>)}</div></fieldset>
      <fieldset disabled={disabled}><legend>Creative freedom</legend><StudioSelect label="Creative freedom" value={creativity} disabled={disabled} onValueChange={value=>onCreativityChange(value as Creativity)} options={[{value:'faithful',label:'Refine the familiar'},{value:'exploratory',label:'Explore new forms'},{value:'radical',label:'Reimagine · Maximum creativity'}]}/><p>{creativity==='radical'?'New metaphors, bold compositions and unexpected forms. Keep the meaning.':creativity==='exploratory'?'Rethink the silhouette and construction while keeping it recognizable.':'Keep the visual idea. Improve proportions, balance and clarity.'}</p><label className="inline-weight">Line weight <input type="number" aria-label="Creative line weight" min="0.5" max="4" step="0.25" value={standards.strokeWidth} onChange={e=>{const n=Number(e.target.value);if(n>=0.5&&n<=4)onChange({strokeWidth:n});}}/> px</label></fieldset>
      <div className="creative-palette"><ColorPalette standards={standards} onChange={onChange} disabled={disabled}/></div>
    </div>
  </section>;
}
