import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveArtworkFit } from './artwork-fit.ts';

test('legacy construction-grid workspaces fill the keylines despite saved padding', () => {
  for (const constructionGrid of ['keyline', 'concentric'] as const) {
    assert.deepEqual(resolveArtworkFit({ gridSize: 24, padding: 6, constructionGrid }), { mode: 'keyline', padding: 2, extent: 20 });
    assert.deepEqual(resolveArtworkFit({ gridSize: 48, padding: 6, constructionGrid }), { mode: 'keyline', padding: 4, extent: 40 });
  }
});

test('custom padding remains explicit and respects the outer guide boundary', () => {
  assert.deepEqual(resolveArtworkFit({ gridSize: 24, padding: 6, constructionGrid: 'keyline', artworkFit: 'padding' }), { mode: 'padding', padding: 6, extent: 12 });
  assert.deepEqual(resolveArtworkFit({ gridSize: 24, padding: 0, constructionGrid: 'keyline', artworkFit: 'padding' }), { mode: 'padding', padding: 2, extent: 20 });
  assert.deepEqual(resolveArtworkFit({ gridSize: 24, padding: 0, constructionGrid: 'none', artworkFit: 'padding' }), { mode: 'padding', padding: 0, extent: 24 });
});

test('workspaces without guides retain their padding even when a preset previously matched keylines', () => {
  assert.deepEqual(resolveArtworkFit({ gridSize: 24, padding: 3 }), { mode: 'padding', padding: 3, extent: 18 });
  const preset = { gridSize: 24, padding: 6, artworkFit: 'keyline' as const };
  assert.deepEqual(resolveArtworkFit({ ...preset, constructionGrid: 'keyline' }), { mode: 'keyline', padding: 2, extent: 20 });
  assert.deepEqual(resolveArtworkFit({ ...preset, constructionGrid: 'none' }), { mode: 'padding', padding: 6, extent: 12 });
  assert.deepEqual(resolveArtworkFit({ ...preset, constructionGrid: 'concentric' }), { mode: 'keyline', padding: 2, extent: 20 });
});
