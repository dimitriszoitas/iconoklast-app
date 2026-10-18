import type { IconItem } from './icon-types.ts';
import type { LibrarySelection } from './library-export.ts';

/** Remove selected current SVGs without discarding the family's other work. */
export function removeLibraryEntries<T extends IconItem>(items: T[], selection: LibrarySelection[]): T[] {
  return items.flatMap(item => {
    const entries = selection.filter(entry => entry.itemId === item.id);
    if (!entries.length) return [item];
    const removeOriginal = Boolean(item.originalSvg) && entries.some(entry => entry.original);
    const removedIds = new Set(entries.filter(entry => !entry.original).map(entry => entry.candidateId));
    const candidates = item.candidates.filter(candidate => !removedIds.has(candidate.id)
      && !(removeOriginal && item.round === 0 && candidate.svg === item.originalSvg));
    if (!removeOriginal && candidates.length === item.candidates.length) return [item];
    const originalSvg = removeOriginal ? undefined : item.originalSvg;
    return originalSvg || candidates.length ? [{ ...item, originalSvg, candidates }] : [];
  });
}
