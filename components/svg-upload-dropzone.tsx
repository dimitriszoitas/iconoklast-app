'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Flame, Upload } from 'lucide-react';
import './svg-upload-dropzone.css';

type Props = {
  disabled?: boolean;
  onBrowse: () => void;
  onFiles: (files: FileList) => Promise<void>;
};

const hasFiles = (transfer: DataTransfer) => Array.from(transfer.types).includes('Files');

export default function SvgUploadDropzone({ disabled = false, onBrowse, onFiles }: Props) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const dragDepth = useRef(0);
  const importInFlight = useRef(false);
  const unavailable = disabled || importing;
  const resetDrag = () => { dragDepth.current = 0; setDragging(false); };

  useEffect(() => {
    const reset = () => { dragDepth.current = 0; setDragging(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('keydown', escape);
    };
  }, []);

  async function drop(event: DragEvent<HTMLElement>) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    resetDrag();
    if (disabled || importInFlight.current) return;
    const files = event.dataTransfer.files;
    if (!files.length) return;
    importInFlight.current = true;
    setImporting(true);
    try { await onFiles(files); }
    finally { importInFlight.current = false; setImporting(false); }
  }

  return <section className={`set-upload-empty svg-upload-dropzone${dragging && !unavailable ? ' is-dragging' : ''}`} aria-label="Upload SVG icons" aria-busy={importing}
    onDragEnter={event => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (unavailable) return;
      dragDepth.current += 1;
      setDragging(true);
    }}
    onDragOver={event => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = unavailable ? 'none' : 'copy';
    }}
    onDragLeave={() => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    }}
    onDrop={event => void drop(event)}>
    {dragging && !unavailable ? <Flame className="dropzone-symbol" size={28} aria-hidden="true" /> : <Upload className="dropzone-symbol" size={28} aria-hidden="true" />}
    <div className="dropzone-message" role="status" aria-live="polite" aria-atomic="true">
      <h2>{importing ? 'Bringing your icons in…' : dragging && !unavailable ? 'Drop it like it’s hot' : 'Bring your icon set'}</h2>
      <p>{dragging && !unavailable ? 'Release to add your SVGs.' : 'Drag SVGs here. Each original stays beside its redesigns.'}</p>
    </div>
    <button type="button" className="button primary" disabled={unavailable} onClick={onBrowse}>Upload SVGs</button>
  </section>;
}
