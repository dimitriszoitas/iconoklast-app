import type { Candidate } from './icon-types';

export function directionCount(candidates: Candidate[]): number {
  return new Set(candidates.map(c => c.pairId || c.id)).size;
}

export function directionLetter(candidate: Candidate, candidates: Candidate[]): string {
  const ids = [...new Set(candidates.map(c => c.pairId || c.id))];
  return String.fromCharCode(65 + ids.indexOf(candidate.pairId || candidate.id));
}

export function versionLabel(candidate: Pick<Candidate, 'treatment'>): string {
  return candidate.treatment === 'line' ? 'Outlined' : candidate.treatment === 'filled' ? 'Filled' : '';
}

export function candidateFileName(name: string, candidate: Pick<Candidate, 'treatment'>): string {
  return `${name}${candidate.treatment ? `-${candidate.treatment === 'line' ? 'outlined' : 'filled'}` : ''}`;
}
