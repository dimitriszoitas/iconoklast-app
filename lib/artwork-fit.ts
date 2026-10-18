import type { Standards } from './icon-types';

export type ArtworkFitMode = 'keyline' | 'padding';
export type ArtworkFitFrame = { mode: ArtworkFitMode; padding: number; extent: number };

/** Resolve one artwork frame for AI generation, fitting, and the interface.
 * Saved workspaces without a sizing mode follow their selected construction
 * guides. Their old optical-padding value only applies after choosing it.
 */
export function resolveArtworkFit(standards: Pick<Standards, 'gridSize' | 'padding' | 'constructionGrid' | 'artworkFit'>): ArtworkFitFrame {
  const hasGuides = standards.constructionGrid === 'keyline' || standards.constructionGrid === 'concentric';
  const mode = hasGuides ? standards.artworkFit ?? 'keyline' : 'padding';
  const guideInset = standards.gridSize / 12;
  const padding = mode === 'keyline' ? guideInset : Math.max(standards.padding, hasGuides ? guideInset : 0);
  return { mode, padding, extent: standards.gridSize - 2 * padding };
}
