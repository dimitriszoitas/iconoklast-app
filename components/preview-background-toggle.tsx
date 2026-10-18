"use client";

import { Moon, Sun } from 'lucide-react';

export default function PreviewBackgroundToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return <button type="button" className="preview-background-toggle" aria-label="Dark preview background" aria-pressed={dark} title={`Switch to ${dark ? 'light' : 'dark'} preview background`} onClick={onToggle}>
    {dark ? <Moon size={15}/> : <Sun size={15}/>}<span>Preview background: <strong>{dark ? 'dark' : 'light'}</strong></span>
  </button>;
}
