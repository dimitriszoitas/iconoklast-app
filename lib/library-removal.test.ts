import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeLibraryEntries } from './library-removal.ts';
import type { IconItem } from './icon-types.ts';

const original = '<svg><path d="M0 0L1 1"/></svg>';
const source = { id: 'source', name: 'Original', svg: original, rationale: '', status: 'pending' as const, source: 'normalized' as const };
const version = { ...source, id: 'version', name: 'Version', svg: '<svg><circle r="1"/></svg>', source: 'edited' as const };
const family: IconItem & { revisions: string[] } = { id: 'family', name: 'Family', brief: 'A brief', originalSvg: original, round: 1, candidates: [version], revisions: ['earlier work'] };

test('removing an original preserves redesigns, metadata, and history', () => {
  const [remaining] = removeLibraryEntries([family], [{ itemId: 'family', candidateId: 'original:family', original: true }]);
  assert.equal(remaining.originalSvg, undefined);
  assert.deepEqual(remaining.candidates, [version]);
  assert.equal(remaining.brief, family.brief);
  assert.deepEqual(remaining.revisions, family.revisions);
});
test('removing a version preserves the source and the other family', () => {
  const untouched = { ...family, id: 'other' };
  const result = removeLibraryEntries([family, untouched], [{ itemId: 'family', candidateId: 'version', original: false }]);
  assert.equal(result[0].originalSvg, original);
  assert.deepEqual(result[0].candidates, []);
  assert.equal(result[1], untouched);
});
test('removing a round-zero source drops only its matching source candidate', () => {
  const [remaining] = removeLibraryEntries([{ ...family, round: 0, candidates: [source, version] }], [{ itemId: 'family', candidateId: 'source', original: true }]);
  assert.deepEqual(remaining.candidates, [version]);
});
test('removing all current SVGs removes the family; stale selection is harmless', () => {
  assert.deepEqual(removeLibraryEntries([family], [{ itemId: 'family', candidateId: 'version', original: false }, { itemId: 'family', candidateId: 'original:family', original: true }]), []);
  assert.equal(removeLibraryEntries([family], [{ itemId: 'family', candidateId: 'missing', original: false }])[0], family);
});
