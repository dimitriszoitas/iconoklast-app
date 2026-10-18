'use client';

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { Check, Download, FileCode2, FolderOpen, Image, LockKeyhole, PenTool, Search, Trash2, X } from 'lucide-react';
import type { Candidate, IconItem, Standards } from '@/lib/icon-types';
import { versionLabel } from '@/lib/candidate-versions';
import type { LibrarySelection } from '@/lib/library-export';
import { removeLibraryEntries } from '@/lib/library-removal';
export type { LibrarySelection } from '@/lib/library-export';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import IconPreview from './icon-preview';
import './icon-library.css';

export const LIBRARY_PREVIEW_SIZES = [16, 24, 32, 48, 96, 128] as const;
export type LibraryPreviewSize = typeof LIBRARY_PREVIEW_SIZES[number];
export type IconLibraryFilter = 'all' | 'accepted' | 'originals';

export type IconLibraryProps = {
  items: IconItem[];
  standards: Standards;
  busy?: boolean;
  darkCanvas: boolean;
  previewSize: LibraryPreviewSize;
  onPreviewSizeChange: (size: LibraryPreviewSize) => void;
  filter: IconLibraryFilter;
  onFilterChange: (filter: IconLibraryFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenItem: (itemId: string) => void;
  onInspect: (itemId: string, candidate: Candidate) => void;
  onEdit: (itemId: string, candidate: Candidate) => void;
  onStatus: (itemId: string, candidateId: string, status: Candidate['status']) => void;
  onDownload: (itemId: string, candidate: Candidate) => void;
  onRemoveItem?: (itemId: string) => void;
  onDownloadItems: (itemIds: string[]) => void;
  onRemoveItems: (itemIds: string[]) => void;
  onDownloadEntries: (entries: LibrarySelection[]) => void;
  onRemoveEntries: (entries: LibrarySelection[]) => void;
};

type LibraryEntry = { candidate: Candidate; original: boolean; canAccept: boolean };
const selectionKey = (entry: LibrarySelection) => JSON.stringify([entry.itemId, entry.candidateId, entry.original]);
type RemovalRequest = { kind: 'entries'; entries: LibrarySelection[] } | { kind: 'families'; ids: string[]; all: boolean };

function itemEntries(item: IconItem): LibraryEntry[] {
  const originalCandidate = item.round === 0 && item.originalSvg
    ? item.candidates.find(candidate => candidate.svg === item.originalSvg)
    : undefined;
  const original: LibraryEntry[] = item.originalSvg ? [{
    original: true,
    canAccept: Boolean(originalCandidate),
    candidate: originalCandidate || {
      id: `original:${item.id}`,
      name: `${item.name} · Original`,
      svg: item.originalSvg,
      rationale: 'Your preserved source. Editing creates a new alternative.',
      source: 'normalized',
      status: 'pending',
    },
  }] : [];
  return [...original, ...item.candidates
    .filter(candidate => candidate.id !== originalCandidate?.id)
    .map(candidate => ({ candidate, original: false, canAccept: true }))];
}

export default function IconLibrary({ items, standards, busy = false, darkCanvas, previewSize, onPreviewSizeChange, filter, onFilterChange, query, onQueryChange, onOpenItem, onInspect, onEdit, onStatus, onDownload, onRemoveItem, onDownloadItems, onRemoveItems, onDownloadEntries, onRemoveEntries }: IconLibraryProps) {
  const [selection, setSelection] = useState<LibrarySelection[]>([]);
  const [removal, setRemoval] = useState<RemovalRequest | null>(null);
  const searchId = useId();
  const sizeId = useId();
  const search = query.trim().toLocaleLowerCase();
  const allGroups = useMemo(() => items.map(item => ({ item, entries: itemEntries(item) })), [items]);
  const counts = allGroups.reduce((total, group) => ({
    all: total.all + group.entries.length,
    accepted: total.accepted + group.entries.filter(entry => entry.candidate.status === 'accepted').length,
    originals: total.originals + group.entries.filter(entry => entry.original).length,
  }), { all: 0, accepted: 0, originals: 0 });
  const groups = allGroups.map(group => ({ ...group, entries: group.entries.filter(entry => {
    if (filter === 'accepted' && entry.candidate.status !== 'accepted') return false;
    if (filter === 'originals' && !entry.original) return false;
    return !search || `${group.item.name} ${entry.original ? 'original' : entry.candidate.name} ${versionLabel(entry.candidate)}`.toLocaleLowerCase().includes(search);
  }) })).filter(group => group.entries.length > 0 || (filter === 'all' && !group.item.originalSvg && !group.item.candidates.length && (!search || group.item.name.toLocaleLowerCase().includes(search))));
  const visibleCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const availableKeys = new Set(allGroups.flatMap(({ item, entries }) => entries.map(entry => selectionKey({ itemId: item.id, candidateId: entry.candidate.id, original: entry.original }))));
  const selected = selection.filter(entry => availableKeys.has(selectionKey(entry)));
  const selectedKeys = new Set(selected.map(selectionKey));
  const visibleEntries = groups.flatMap(({ item, entries }) => entries.map(entry => ({ itemId: item.id, candidateId: entry.candidate.id, original: entry.original })));
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every(entry => selectedKeys.has(selectionKey(entry)));
  const toggleEntry = (entry: LibrarySelection) => setSelection(current => current.some(value => selectionKey(value) === selectionKey(entry)) ? current.filter(value => selectionKey(value) !== selectionKey(entry)) : [...current, entry]);
  const changeFilter = (value: IconLibraryFilter) => { setSelection([]); onFilterChange(value); };
  const changeQuery = (value: string) => { setSelection([]); onQueryChange(value); };
  const removeConfirmed = () => {
    if (!removal || busy) return;
    if (removal.kind === 'entries') onRemoveEntries(removal.entries);
    else onRemoveItems(removal.ids);
    setSelection([]); setRemoval(null);
  };
  const removalCount = removal?.kind === 'entries' ? removal.entries.length : removal?.ids.length || 0;
  const retainedFamilyIds = removal?.kind === 'entries' ? new Set(removeLibraryEntries(items, removal.entries).map(item => item.id)) : null;
  const removedFamilyCount = retainedFamilyIds ? items.filter(item => !retainedFamilyIds.has(item.id)).length : 0;
  const removalNames = removal ? items.filter(item => removal.kind === 'entries' ? removal.entries.some(entry => entry.itemId === item.id) : removal.ids.includes(item.id)).map(item => item.name) : [];

  const sizeIndex = Math.max(0, LIBRARY_PREVIEW_SIZES.indexOf(previewSize));
  const galleryStyle = {
    '--library-preview-size': `${previewSize}px`,
    '--library-tile-width': `${Math.max(128, previewSize + 48)}px`,
    '--library-preview-height': `${Math.max(64, previewSize + 28)}px`,
  } as CSSProperties;

  return <section className={`icon-library${darkCanvas ? ' library-dark-previews' : ''}`} aria-label="Icon library" style={galleryStyle}>
    <header className="library-toolbar">
      <div className="library-toolbar-top">
        <div className="library-title"><span className="library-title-icon"><FolderOpen size={19} /></span><div><h1>Library</h1><span>{counts.all} {counts.all === 1 ? 'SVG' : 'SVGs'} · {items.length} {items.length === 1 ? 'family' : 'families'}</span></div></div>
        <label className="library-search" htmlFor={searchId}><Search size={15} /><input id={searchId} type="search" value={query} onChange={event => changeQuery(event.target.value)} placeholder="Search icons…" autoComplete="off" aria-label="Search library" />{query && <button type="button" onClick={() => changeQuery('')} aria-label="Clear library search"><X size={14} /></button>}</label>
        <div className="library-header-actions"><button type="button" className="library-action library-download-all" disabled={!counts.all} onClick={() => onDownloadItems(items.map(item => item.id))} title="Download every current original and design version as a ZIP"><Download size={14} /><span>Download all</span></button><button type="button" className="library-action library-clear" disabled={busy || !items.length} onClick={() => setRemoval({ kind: 'families', ids: items.map(item => item.id), all: true })}><Trash2 size={14} /><span>Clear library</span></button></div>
      </div>
      <div className="library-view-controls">
        <div className="library-filters" role="group" aria-label="Filter library">{(['all', 'accepted', 'originals'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeFilter(value)}>{value === 'all' ? 'All' : value === 'accepted' ? 'Accepted' : 'Originals'}<span>{counts[value]}</span></button>)}</div>
        <div className="library-size-control"><label htmlFor={sizeId}><Image size={14} /><span>Preview size</span></label><input id={sizeId} type="range" min={0} max={LIBRARY_PREVIEW_SIZES.length - 1} step={1} value={sizeIndex} aria-valuetext={`${previewSize} pixels`} onChange={event => onPreviewSizeChange(LIBRARY_PREVIEW_SIZES[Number(event.target.value)])} /><output htmlFor={sizeId}>{previewSize} px</output></div>
      </div>
      {selected.length > 0 && <div className="library-bulk-actions" role="region" aria-label="Selected library SVGs"><strong>{selected.length} {selected.length === 1 ? 'SVG' : 'SVGs'} selected</strong><button type="button" className="library-action" onClick={() => onDownloadEntries(selected)}><Download size={14} />Download selected</button><button type="button" className="library-action library-clear" disabled={busy} onClick={() => setRemoval({ kind: 'entries', entries: selected })}><Trash2 size={14} />Remove selected</button><button type="button" className="library-selection-clear" onClick={() => setSelection([])} aria-label="Clear selection"><X size={14} /></button></div>}
    </header>
    <div className="library-results-summary"><label className="library-select-visible"><input type="checkbox" checked={allVisibleSelected} disabled={busy || !visibleEntries.length} onChange={() => setSelection(allVisibleSelected ? [] : visibleEntries)} aria-label="Select all visible SVGs" /><span>{allVisibleSelected ? 'All visible selected' : 'Select visible'}</span></label><span role="status">{visibleCount} {visibleCount === 1 ? 'SVG' : 'SVGs'}{search && ` matching “${query.trim()}”`}</span></div>
    {groups.length ? <div className="library-groups">{groups.map(({ item, entries }) => <section key={item.id} className="library-group" aria-label={`${item.name} icon family`}>
      <header className="library-group-heading"><button type="button" onClick={() => onOpenItem(item.id)} title={`Open ${item.name} in studio`}><FileCode2 size={14} /><h2>{item.name}</h2></button><span>{entries.length} {entries.length === 1 ? 'SVG' : 'SVGs'}</span><button type="button" className="library-open-family" onClick={() => onOpenItem(item.id)} aria-label={`Open ${item.name} in studio`}>Open in studio</button>{onRemoveItem && <button type="button" className="library-remove-family" disabled={busy} onClick={() => setRemoval({ kind: 'families', ids: [item.id], all: false })} aria-label={`Remove ${item.name} and its versions from library`} title={`Remove ${item.name}`}><Trash2 size={13} /></button>}</header>
      {!entries.length && <button type="button" className="library-family-empty" onClick={() => onOpenItem(item.id)}>No versions yet · Create directions</button>}
      <div className="library-grid">{entries.map(({ candidate, original, canAccept }) => {
        const entry = { itemId: item.id, candidateId: candidate.id, original };
        const isSelected = selectedKeys.has(selectionKey(entry));
        const accepted = candidate.status === 'accepted';
        const label = original ? 'Original' : candidate.name;
        const context = `${label}${candidate.treatment ? ` · ${versionLabel(candidate)}` : ''} for ${item.name}`;
        return <article key={candidate.id} className={`library-tile${accepted ? ' is-accepted' : ''}${original ? ' is-original' : ''}${isSelected ? ' is-selected' : ''}`}>
          <label className="library-tile-select"><input type="checkbox" checked={isSelected} disabled={busy} onChange={() => toggleEntry(entry)} aria-label={`Select ${context}`} /></label>
          <button type="button" className="library-thumbnail" onClick={() => onInspect(item.id, candidate)} aria-label={`Inspect ${context}`} title={`Inspect ${context}`}><IconPreview svg={candidate.svg} label="" size={previewSize} standards={item.standards || standards} showGuides={false} /></button>
          <div className="library-tile-caption"><strong title={label}>{label}</strong><span><span className="library-version-kind">{original ? <><LockKeyhole size={10} />Original</> : candidate.treatment ? versionLabel(candidate) : candidate.source === 'edited' ? 'Edited SVG' : 'SVG'}</span>{accepted && <span className="library-accepted-status"><Check size={11} />Accepted</span>}</span></div>
          <div className="library-tile-actions"><button type="button" disabled={busy} onClick={() => onEdit(item.id, candidate)} aria-label={`Edit ${context}`} title={original ? 'Edit a copy of original' : 'Edit paths'}><PenTool size={13} /><span>Edit</span></button>{canAccept && <button type="button" disabled={busy} className={accepted ? 'library-accept is-active' : 'library-accept'} aria-pressed={accepted} onClick={() => onStatus(item.id, candidate.id, accepted ? 'pending' : 'accepted')} aria-label={`${accepted ? 'Unaccept' : 'Accept'} ${context}`} title={accepted ? 'Remove from accepted' : 'Accept for export'}><Check size={13} /><span>{accepted ? 'Accepted' : 'Accept'}</span></button>}<button type="button" onClick={() => onDownload(item.id, candidate)} aria-label={`Download ${context} as SVG`} title="Download SVG"><Download size={13} /><span className="library-download-label">SVG</span></button></div>
        </article>;
      })}</div>
    </section>)}</div> : <div className="library-empty"><FolderOpen size={28} /><h2>{search ? 'No matching icons' : filter === 'accepted' ? 'No accepted icons yet' : filter === 'originals' ? 'No uploaded originals yet' : 'Your library starts here'}</h2><p>{search ? 'Try another name or clear the search.' : filter === 'accepted' ? 'Accept a direction to collect it here and export your set.' : filter === 'originals' ? 'Upload SVGs to keep their originals here.' : 'Create an icon or upload SVGs. All your versions will appear here.'}</p>{(search || filter !== 'all') && <button type="button" className="button secondary" onClick={() => { changeQuery(''); changeFilter('all'); }}>Show all icons</button>}</div>}
    <AlertDialog open={Boolean(removal)} onOpenChange={open => { if (!open) setRemoval(null); }}>
      <AlertDialogContent className="library-confirm-dialog">
        <AlertDialogHeader><AlertDialogTitle>{removal?.kind === 'families' && removal.all ? 'Clear your library?' : `Remove ${removalCount} ${removal?.kind === 'entries' ? removalCount === 1 ? 'SVG' : 'SVGs' : removalCount === 1 ? 'icon family' : 'icon families'}?`}</AlertDialogTitle><AlertDialogDescription>{removal?.kind === 'entries' ? <>The selected SVGs will be removed from this browser. {removedFamilyCount > 0 && <>This removes the last current SVG from {removedFamilyCount} {removedFamilyCount === 1 ? 'icon family' : 'icon families'}, so {removedFamilyCount === 1 ? 'that family and its' : 'those families and their'} revision history will also be deleted. </>}Unselected SVGs stay in your library.</> : 'These icon families, their originals, versions, and revision history will be removed from this browser. Your design standards and new-icon draft stay saved.'}</AlertDialogDescription></AlertDialogHeader>
        <p className="library-confirm-names">{removalNames.slice(0, 3).join(', ')}{removalNames.length > 3 ? ` and ${removalNames.length - 3} more` : ''}</p>
        <p className="library-confirm-note">Download any SVGs you want to keep before removing them.</p>
        <AlertDialogFooter><AlertDialogCancel className="library-confirm-cancel">Cancel</AlertDialogCancel><AlertDialogAction className="library-confirm-delete" variant="destructive" disabled={busy} onClick={removeConfirmed}>{removal?.kind === 'families' && removal.all ? 'Clear library' : 'Remove'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
