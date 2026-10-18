'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Check, CheckCheck, ChevronDown, CircleAlert, FileCode2, History, LoaderCircle, LockKeyhole, PenTool, ScanSearch, Sparkles, X } from 'lucide-react';
import type { Candidate, IconItem, Standards } from '../lib/icon-types';
import { directionCount, directionLetter, versionLabel } from '../lib/candidate-versions';
import './treatment-settings.css';
import './icon-set-board.css';
import IconPreview from './icon-preview';

export type SetBoardItem = IconItem & {
  analysis?: { meaning: string; visualNotes: string; designIntent: string };
  suggestions?: string[];
};

export type IconSetBoardProps = {
  items: SetBoardItem[];
  standards: Standards;
  showGuides: boolean;
  darkCanvas?: boolean;
  selectedIds: string[];
  activeId: string;
  busy: boolean;
  states: Record<string, 'working' | 'done' | 'failed'>;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  onBriefChange: (id: string, brief: string) => void;
  onRedesign: (id: string) => void;
  onStatus: (itemId: string, candidateId: string, status: Candidate['status']) => void;
  onInspect: (itemId: string, candidate: Candidate) => void;
  onHistory: (id: string) => void;
  renderRules?: (item: SetBoardItem) => ReactNode;
};

const sourceLabels: Record<Candidate['source'], string> = {
  ai: 'AI redesign',
  demo: 'Demo concept',
  normalized: 'Style adjustment',
  edited: 'Edited vector',
};

function Preview({ svg, label, standards, showGuides }: { svg: string; label: string; standards?:Standards; showGuides?:boolean }) {
  return <IconPreview svg={svg} label={label} size={64} standards={standards} showGuides={showGuides}/>;
}

export default function IconSetBoard({ standards, showGuides, darkCanvas = false, items, selectedIds, activeId, busy, states, onToggle, onFocus, onBriefChange, onRedesign, onStatus, onInspect, onHistory, renderRules }: IconSetBoardProps) {
  if (!items.length) return <section className="isb-empty-board" aria-label="Uploaded icon set"><FileCode2 size={25} /><h3>Your set starts here</h3><p>Upload SVGs to see each original beside its redesigned alternatives.</p></section>;

  return <section className={`isb-board ${darkCanvas?'dark-previews':''}`} aria-label="Your uploaded icons and their alternatives">
    {items.map((item, itemIndex) => {
      // A round-zero upload is the reference, never an invented alternative.
      const alternatives = item.candidates.filter((candidate) => !(item.round === 0 && item.originalSvg && candidate.svg === item.originalSvg));
      const originalCandidate: Candidate | undefined = item.originalSvg ? item.candidates.find((candidate) => candidate.svg === item.originalSvg) || {
        id: `${item.id}-original`, name: 'Original upload', svg: item.originalSvg,
        rationale: 'Your preserved source. Editing creates a new alternative.', source: 'normalized', status: 'pending',
      } : undefined;
      const state = states[item.id];
      const working = state === 'working';
      const accepted = alternatives.some((candidate) => candidate.status === 'accepted');
      const hasAdjustments = alternatives.some((candidate) => candidate.source === 'normalized');
      const hasDemo = alternatives.some((candidate) => candidate.source === 'demo');
      const statusText = working ? 'Redesigning' : state === 'failed' ? 'Needs retry' : accepted ? 'Accepted' : state === 'done' ? 'Ready to review' : alternatives.length ? 'Explore directions' : 'Ready for redesign';
      const rules = renderRules?.(item);
      return <article className={`isb-row ${activeId === item.id ? 'is-focused' : ''} ${working ? 'is-working' : ''}`} key={item.id} aria-labelledby={`isb-name-${item.id}`} aria-busy={working}>
        <header className="isb-row-header">
          <label className="isb-select" title={`Include ${item.name} in the selected set`}><input type="checkbox" checked={selectedIds.includes(item.id)} disabled={busy} onChange={() => onToggle(item.id)} aria-label={`Select ${item.name} for redesign`} /><span aria-hidden="true"><Check size={11} /></span></label>
          <span className="isb-row-number">{String(itemIndex + 1).padStart(2, '0')}</span>
          <button className="isb-filename" onClick={() => onFocus(item.id)} title={`Focus ${item.name}`} aria-current={activeId === item.id ? 'true' : undefined}><FileCode2 size={14} /><h3 id={`isb-name-${item.id}`}>{item.name}</h3><span>SVG</span></button>
          <span className={`isb-row-status status-${working ? 'working' : state === 'failed' ? 'failed' : accepted ? 'accepted' : 'ready'}`} role={working || state === 'failed' ? 'status' : undefined}>{working ? <LoaderCircle size={11} className="isb-spinning" /> : state === 'failed' ? <CircleAlert size={11} /> : accepted ? <CheckCheck size={11} /> : <i />}{statusText}</span>
          <div className="isb-header-actions"><button className="isb-history" onClick={() => onHistory(item.id)} title={`Version history for ${item.name}`} aria-label={`Version history for ${item.name}`}><History size={14} /></button><button className="isb-redesign secondary" disabled={busy} onClick={() => onRedesign(item.id)}>{working ? <LoaderCircle size={12} className="isb-spinning" /> : <Sparkles size={12} />}<span>{working ? 'Redesigning…' : state === 'failed' ? 'Retry this icon' : 'Redesign this icon'}</span></button></div>
        </header>

        {(item.analysis?.meaning || item.analysis?.designIntent) && <div className="isb-analysis"><span className="isb-analysis-label"><ScanSearch size={12} /> Understanding</span><p>{item.analysis.meaning}{item.analysis.designIntent && <span><b>Direction:</b> {item.analysis.designIntent}</span>}</p></div>}

        {rules && <div className="isb-rules">{rules}</div>}

        <div className="isb-row-subhead"><span>REFERENCE <LockKeyhole size={9} /></span><div><strong>{alternatives.length ? alternatives.some(c=>c.pairId)?`${directionCount(alternatives)} directions · ${alternatives.length} versions`:`${alternatives.length} ${alternatives.length === 1 ? 'alternative' : 'alternatives'}` : 'Your next directions'}</strong><span>{item.round > 0 && `Round ${item.round}`}</span>{alternatives.length > 0 && <small>Compare →</small>}</div></div>

        {alternatives.some(c=>c.pairId)&&<p className="isb-paired-help">Matching letters are the same design in two treatments. Accept one outlined and one filled version for export.</p>}
        <div className="isb-strip" role="region" aria-label={`Original and ${alternatives.length} alternatives for ${item.name}`} tabIndex={0}>
          <div className="isb-original"><button type="button" className="isb-original-image" disabled={!originalCandidate} onClick={() => { if (originalCandidate) onInspect(item.id, originalCandidate); }} aria-label={`Open original ${item.name}`} aria-haspopup="dialog">{item.originalSvg ? <Preview svg={item.originalSvg} label={`Original ${item.name}`} /> : <FileCode2 size={34} strokeWidth={1.1} />}</button><strong>Original</strong><span>Your source icon</span><div className="isb-original-lock"><LockKeyhole size={10} /><span>Preserved</span></div></div>

          {alternatives.length ? alternatives.map((candidate) => <div className={`isb-candidate ${candidate.status === 'accepted' ? 'is-accepted' : ''} ${candidate.status === 'rejected' ? 'is-rejected' : ''}`} key={candidate.id}>
            <div className="isb-card-top"><span className="isb-letter">{directionLetter(candidate,alternatives)}</span><span className={`isb-source source-${candidate.source}`}>{candidate.status === 'accepted' ? <><Check size={12} /> Accepted</> : candidate.status === 'rejected' ? <><X size={12} /> Rejected</> : sourceLabels[candidate.source] || 'Direction'}</span></div>
            <button type="button" className="isb-candidate-preview" onClick={() => onInspect(item.id, candidate)} aria-label={`Open ${candidate.name}${candidate.treatment?` · ${versionLabel(candidate)}`:""} for ${item.name}`} aria-haspopup="dialog"><Preview svg={candidate.svg} label={candidate.name} standards={standards} showGuides={showGuides}/></button>
            <div className="isb-candidate-caption"><strong title={candidate.name}>{candidate.name}</strong>{candidate.treatment&&<span className="treatment-badge">{versionLabel(candidate)}</span>}</div>
            <div className="isb-candidate-actions"><button type="button" disabled={busy} className={`decision-accept ${candidate.status === 'accepted' ? 'is-active accepted' : ''}`} aria-pressed={candidate.status === 'accepted'} aria-label={`${candidate.status === 'accepted' ? 'Undo acceptance of' : 'Accept'} ${candidate.name}${candidate.treatment?` · ${versionLabel(candidate)}`:""} for ${item.name}`} onClick={() => onStatus(item.id, candidate.id, candidate.status === 'accepted' ? 'pending' : 'accepted')}><Check size={13} /><span>Accept</span></button><button type="button" disabled={busy} className={`decision-reject ${candidate.status === 'rejected' ? 'is-active rejected' : ''}`} aria-pressed={candidate.status === 'rejected'} aria-label={`${candidate.status === 'rejected' ? 'Undo rejection of' : 'Reject'} ${candidate.name}${candidate.treatment?` · ${versionLabel(candidate)}`:""} for ${item.name}`} onClick={() => onStatus(item.id, candidate.id, candidate.status === 'rejected' ? 'pending' : 'rejected')}><X size={13} /><span>Reject</span></button></div>
          </div>) : <div className={`isb-awaiting ${working ? 'is-generating' : ''}`}><div className="isb-awaiting-icon">{working ? <LoaderCircle size={21} className="isb-spinning" /> : <Sparkles size={21} strokeWidth={1.25} />}</div><div><strong>{working ? 'Exploring new ways to express this icon' : 'A new perspective on the same idea'}</strong><p>{working ? 'Your original stays here. The new directions will appear together in this row.' : 'Redesign this icon to create 4–8 directions, guided by its meaning and your set’s visual language.'}</p>{!working && <button disabled={busy} onClick={() => onRedesign(item.id)}>Explore alternatives <ArrowRight size={12} /></button>}</div></div>}
        </div>

        {(hasAdjustments || hasDemo || state === 'failed') && <div className={`isb-provenance-note ${state === 'failed' ? 'is-failure' : ''}`}><CircleAlert size={12} /><span>{state === 'failed' ? 'The redesign did not finish. Your original and previous alternatives are preserved. Retry this icon when you are ready.' : hasAdjustments ? '“Style adjustment” directions only change styling. They are not AI redesigns. Redesign this icon for new visual ideas.' : 'These are handcrafted demo concepts, not AI redesigns of your uploaded icon.'}</span></div>}

        <details className="isb-brief-details"><summary><PenTool size={11} /><span>Meaning / brief</span><span className="isb-brief-preview">{item.brief}</span><ChevronDown size={12} /></summary><div className="isb-brief-content"><label htmlFor={`isb-brief-${item.id}`}>What should {item.name} communicate?</label><textarea id={`isb-brief-${item.id}`} value={item.brief} disabled={busy} rows={2} maxLength={2000} placeholder="Describe the idea this icon represents, where it is used, and what must stay recognizable." onChange={(event) => onBriefChange(item.id, event.target.value)} /><p>The redesign uses this meaning together with your creative direction and icon standards.</p>{item.analysis?.visualNotes && <div className="isb-visual-notes"><strong>Visual observations</strong><p>{item.analysis.visualNotes}</p></div>}{!!item.suggestions?.length && <div className="isb-visual-notes"><strong>Suggested refinements</strong><ul>{item.suggestions.map((suggestion, index) => <li key={`${item.id}-suggestion-${index}`}>{suggestion}</li>)}</ul></div>}</div></details>
      </article>;
    })}
  </section>;
}
