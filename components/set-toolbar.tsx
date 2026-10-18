'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, LoaderCircle, Palette, SlidersHorizontal, Sparkles, Upload } from 'lucide-react';
import './set-toolbar.css';
import StudioSelect from './studio-select';

export type SetToolbarProps = {
  total: number;
  selected: number;
  count: number;
  onCountChange: (count: number) => void;
  brief: string;
  onBriefChange: (brief: string) => void;
  connected: boolean;
  busy: boolean;
  canRecolor: boolean;
  onAddSvgs: () => void;
  onRecolor: () => void;
  onRedesign: () => void;
  onCancel: () => void;
  onConnect: () => void;
  onToggleAll: () => void;
  showGuides: boolean;
  onShowGuidesChange: (show: boolean) => void;
  proportionLabel: string;
  gridLabel: string;
};

export default function SetToolbar({ total, selected, count, onCountChange, brief, onBriefChange, connected, busy, canRecolor, onAddSvgs, onRecolor, onRedesign, onCancel, onConnect, onToggleAll, showGuides, onShowGuidesChange, proportionLabel, gridLabel }: SetToolbarProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [pastStart, setPastStart] = useState(false);
  const [expandedByUser, setExpandedByUser] = useState(false);
  const [controlsFocused, setControlsFocused] = useState(false);
  const compact = pastStart && !expandedByUser && !controlsFocused;

  useEffect(() => {
    const marker = sentinel.current;
    if (!marker || typeof IntersectionObserver === 'undefined') return;
    const root = marker.closest('.workspace-scroll');
    const observer = new IntersectionObserver(([entry]) => {
      // The marker is outside the sticky section, so changing its height does
      // not change the point at which it becomes compact.
      const passed = entry.boundingClientRect.bottom < (entry.rootBounds?.top ?? 0);
      setPastStart(passed);
      if (!passed) setExpandedByUser(false);
    }, { root, threshold: 0 });
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);

  const countSelect = <StudioSelect className="set-toolbar-count" label="Alternatives per icon" value={String(count)} disabled={busy} onValueChange={value=>onCountChange(Number(value))} options={[4,5,6,7,8].map(value=>({value:String(value),label:`${value} per icon`}))}/>;
  const redesignButton = busy
    ? <button type="button" className="set-toolbar-action secondary is-secondary" onClick={onCancel}><LoaderCircle size={15} className="set-toolbar-spinner" /><span>Cancel</span></button>
    : <button type="button" className="set-toolbar-action primary" disabled={!selected} onClick={onRedesign}><Sparkles size={15} /><span>Redesign<span className="set-toolbar-action-extra"> selected</span> ({selected})</span></button>;

  return <>
    <div className="set-toolbar-sentinel" ref={sentinel} aria-hidden="true" />
    <section className={`set-toolbar${compact ? ' is-compact' : ''}${pastStart ? ' is-stuck' : ''}`} aria-label="Uploaded set controls">
      <div className="set-toolbar-heading">
        <h2>{compact ? <><span className="set-toolbar-compact-title">Your set · </span>{selected}<span className="set-toolbar-total">/{total}</span><span className="set-toolbar-selected-label"> selected</span></> : <>{total} uploaded {total === 1 ? 'icon' : 'icons'}</>}</h2>
        {compact ? <div className="set-toolbar-compact-actions">{countSelect}{redesignButton}</div> : <div className="set-toolbar-utilities">
          {!connected && <button type="button" disabled={busy} className="set-toolbar-link tertiary set-toolbar-connect" aria-label="Connect AI" onClick={onConnect}><Sparkles size={14} /><span>Connect AI</span></button>}
          <button type="button" disabled={busy || !canRecolor} className="set-toolbar-link tertiary" aria-label="Recolor selected designs" onClick={onRecolor} title="Apply the current palette to selected designs"><Palette size={14} /><span>Recolor</span></button>
          <button type="button" disabled={busy} className="set-toolbar-link tertiary" aria-label="Add SVGs" onClick={onAddSvgs}><Upload size={14} /><span>Add SVGs</span></button>
        </div>}
        {pastStart && <button type="button" className="set-toolbar-expand secondary" aria-expanded={!compact} aria-controls={panelId} aria-label={compact ? 'Expand set controls' : 'Collapse set controls'} title={compact ? 'Expand set controls' : 'Collapse set controls'} onClick={() => setExpandedByUser(!compact ? false : true)}><SlidersHorizontal size={14} /><span>Controls</span>{compact ? <ChevronDown size={13} /> : <ChevronUp size={13} />}</button>}
      </div>
      <div id={panelId} hidden={compact} className="set-toolbar-details" onFocusCapture={event => setControlsFocused(event.target instanceof HTMLInputElement && event.target.type !== 'checkbox')} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setControlsFocused(false); }}>
        {!compact && <>
          <div className="set-toolbar-design-row">
            <input className="set-toolbar-brief" aria-label="Shared instructions for uploaded set" value={brief} disabled={busy} maxLength={1000} onChange={event => onBriefChange(event.target.value)} placeholder="Optional direction for the set…" />
            {countSelect}{redesignButton}
          </div>
          <div className="set-toolbar-options">
            <div className="set-toolbar-selection"><span>{selected} of {total} selected</span><button type="button" disabled={busy} onClick={onToggleAll}>{selected === total ? 'Deselect all' : 'Select all'}</button></div>
            <label className="set-toolbar-guides" title="Construction guides are for preview only and are excluded from SVG exports."><input type="checkbox" checked={showGuides} onChange={event => onShowGuidesChange(event.target.checked)} />Show guides</label>
            <span className="set-toolbar-standards" title={`${proportionLabel} · ${gridLabel}. Set your direction in the right panel.`}>{proportionLabel} · {gridLabel}</span>
          </div>
        </>}
      </div>
    </section>
  </>;
}
