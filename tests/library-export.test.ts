import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { buildLibraryBundle, selectLibraryEntries } from '../lib/library-export.ts';
import type { Candidate, IconItem } from '../lib/icon-types.ts';

const window = new Window();
Object.defineProperty(globalThis, 'DOMParser', { configurable: true, writable: true, value: window.DOMParser });
Object.defineProperty(globalThis, 'XMLSerializer', { configurable: true, writable: true, value: window.XMLSerializer });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4L20 20" fill="none" stroke="#000"/></svg>';
const candidate = (id: string, status: Candidate['status']): Candidate => ({ id, name: 'Same version', svg, status, source: 'demo', rationale: '' });
const item = (id: string): IconItem => ({ id, name: '../Same / family', brief: 'A sample icon', originalSvg: svg, round: 2, candidates: [candidate(`${id}-a`, 'accepted'), candidate(`${id}-b`, 'pending'), candidate(`${id}-c`, 'shortlisted')] });

test('library archive includes every current version and original without changing review state', () => {
  const items = [item('one'), item('two')];
  const before = JSON.stringify(items);
  const files = buildLibraryBundle(items);
  assert.equal(files.filter(file => file.name.endsWith('.svg')).length, 8);
  assert.equal(new Set(files.map(file => file.name)).size, files.length, 'duplicate family and version names stay distinct');
  assert.ok(files.every(file => !file.name.includes('..')));
  const manifest = JSON.parse(files.find(file => file.name === 'manifest.json')!.content);
  assert.deepEqual(manifest.icons[0].versions.map((version: { status: string }) => version.status), ['accepted', 'pending', 'shortlisted']);
  assert.equal(JSON.stringify(items), before);
});

test('round-zero source is written once and remains available through its version manifest', () => {
  const source = { ...item('source'), round: 0, candidates: [candidate('original', 'pending')] };
  const files = buildLibraryBundle([source]);
  assert.equal(files.filter(file => file.name.endsWith('.svg')).length, 1);
  const manifest = JSON.parse(files.find(file => file.name === 'manifest.json')!.content);
  assert.equal(manifest.icons[0].original, manifest.icons[0].versions[0].file);
  assert.throws(() => buildLibraryBundle([]), /empty/);
});


test('selected tile export excludes unselected originals and sibling versions', () => {
  const source = item('family');
  const entries = selectLibraryEntries([source], [{ itemId: source.id, candidateId: 'family-b', original: false }]);
  const files = buildLibraryBundle(entries);
  assert.equal(files.filter(file => file.name.endsWith('.svg')).length, 1);
  assert.equal(entries[0].originalSvg, undefined);
  assert.deepEqual(entries[0].candidates.map(candidate => candidate.id), ['family-b']);
  const onlyOriginal = selectLibraryEntries([source], [{ itemId: source.id, candidateId: 'original:family', original: true }]);
  assert.equal(onlyOriginal[0].originalSvg, svg);
  assert.equal(onlyOriginal[0].candidates.length, 0);
  assert.equal(source.candidates.length, 3);
});
