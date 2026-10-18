import { createZip, sanitizeSvg } from './icon-engine.ts';
import type { IconItem } from './icon-types.ts';

type LibraryFile = { name: string; content: string };
export type LibrarySelection = { itemId: string; candidateId: string; original: boolean };

/** Pick SVG tiles for download without including unselected originals or versions. */
export function selectLibraryEntries(items: IconItem[], selected: LibrarySelection[]): IconItem[] {
  return items.flatMap(item => {
    const entries = selected.filter(entry => entry.itemId === item.id);
    if (!entries.length) return [];
    const originalSvg = entries.some(entry => entry.original) ? item.originalSvg : undefined;
    const ids = new Set(entries.filter(entry => !entry.original).map(entry => entry.candidateId));
    const candidates = item.candidates.filter(candidate => ids.has(candidate.id));
    return originalSvg || candidates.length ? [{ ...item, originalSvg, candidates }] : [];
  });
}

const filePart = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'icon';

/** Export every current SVG, independently of the accepted-set export selection. */
export function buildLibraryBundle(items: IconItem[]): LibraryFile[] {
  if (!items.length) throw new Error('Your library is empty.');
  const files: LibraryFile[] = [];
  const folders = new Set<string>();
  const manifest: Array<{ id: string; name: string; brief: string; round: number; standards?: IconItem['standards']; original?: string; versions: Array<{ id: string; name: string; file: string; status: string; source: string; treatment?: string; pairId?: string }> }> = [];
  for (const item of items) {
    const base = filePart(item.name);
    let folder = base;
    for (let suffix = 2; folders.has(folder); suffix++) folder = `${base}-${suffix}`;
    folders.add(folder);
    const record: typeof manifest[number] = { id: item.id, name: item.name, brief: item.brief, round: item.round, standards: item.standards, versions: [] };
    if (item.originalSvg) {
      record.original = `${folder}/original.svg`;
      files.push({ name: record.original, content: sanitizeSvg(item.originalSvg) });
    }
    const names = new Set<string>();
    for (const candidate of item.candidates) {
      let file: string;
      if (item.round === 0 && item.originalSvg && candidate.svg === item.originalSvg) {
        file = record.original!;
      } else {
        const version = `${filePart(candidate.name)}${candidate.treatment ? `-${candidate.treatment === 'line' ? 'outlined' : 'filled'}` : ''}`;
        let name = version;
        for (let suffix = 2; names.has(name); suffix++) name = `${version}-${suffix}`;
        names.add(name);
        file = `${folder}/versions/${name}.svg`;
        files.push({ name: file, content: sanitizeSvg(candidate.svg) });
      }
      record.versions.push({ id: candidate.id, name: candidate.name, file, status: candidate.status, source: candidate.source, treatment: candidate.treatment, pairId: candidate.pairId });
    }
    manifest.push(record);
  }
  files.push({ name: 'manifest.json', content: JSON.stringify({ product: 'iconoklast.app', version: 1, scope: 'The original SVGs and design versions included in this download. Earlier revision history is not included.', icons: manifest }, null, 2) });
  files.push({ name: 'README.txt', content: 'iconoklast.app Library\n\nEach folder contains the original SVG and design versions included in this download. Download all includes every current version; Download selected includes only the selected SVGs. Review status does not limit these downloads.\n\nmanifest.json records names, statuses, and design standards. Earlier revision history is not included. This SVG archive is not a restorable workspace backup.\n' });
  return files;
}

export function downloadLibrary(items: IconItem[]): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('Downloads are available in your browser.');
  const zip = createZip(buildLibraryBundle(items));
  const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'iconoklast-library.zip';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
