'use client';

import { useId, type Ref } from 'react';
import { Grid2X2, KeyRound, PanelLeftOpen, WandSparkles } from 'lucide-react';

export type CollapsedSidebarProps = {
  expandedButtonRef: Ref<HTMLButtonElement>;
  onExpand: () => void;
  onStudio: () => void;
  onLibrary: () => void;
  onSettings: () => void;
  view: 'studio' | 'collection';
  busy: boolean;
  aiEnabled: boolean;
  libraryCount: number;
};

export default function CollapsedSidebar({ expandedButtonRef, onExpand, onStudio, onLibrary, onSettings, view, busy, aiEnabled, libraryCount }: CollapsedSidebarProps) {
  const connectionId = useId();
  const connectionLabel = aiEnabled ? 'AI Enabled' : 'AI Not Enabled';
  return <aside className="collapsed-sidebar-rail" aria-label="Collapsed workspace navigation">
    <span className="collapsed-sidebar-brand" role="img" aria-label="iconoklast.app"><i /><i /><i /><i /></span>
    <button ref={expandedButtonRef} type="button" className="collapsed-sidebar-button collapsed-sidebar-expand" aria-label="Expand sidebar" title="Expand sidebar" aria-expanded={false} aria-controls="workspace-sidebar" onClick={onExpand}>
      <PanelLeftOpen size={19} aria-hidden="true" />
    </button>
    <nav className="collapsed-sidebar-nav" aria-label="Workspace">
      <button type="button" className="collapsed-sidebar-button" aria-label="Icon studio" title="Icon studio" aria-current={view === 'studio' ? 'page' : undefined} disabled={busy} onClick={onStudio}>
        <WandSparkles size={20} aria-hidden="true" />
      </button>
      <button type="button" className="collapsed-sidebar-button" aria-label="Library" title={`Library (${libraryCount})`} aria-current={view === 'collection' ? 'page' : undefined} disabled={busy} onClick={onLibrary}>
        <Grid2X2 size={20} aria-hidden="true" />
      </button>
    </nav>
    <div className="collapsed-sidebar-footer">
      <button type="button" className="collapsed-sidebar-button collapsed-sidebar-settings" aria-label="LLM API settings" aria-describedby={connectionId} title={`LLM API settings · ${connectionLabel}`} disabled={busy} onClick={onSettings}>
        <KeyRound size={20} aria-hidden="true" />
        <span className={`collapsed-sidebar-status${aiEnabled ? ' is-enabled' : ''}`} aria-hidden="true" />
      </button>
      <span className="collapsed-sidebar-sr-only" id={connectionId}>{connectionLabel}</span>
    </div>
  </aside>;
}
