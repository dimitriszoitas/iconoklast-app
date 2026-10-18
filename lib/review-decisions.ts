import type { Candidate, IconItem, Standards } from './icon-types.ts';
import { emptySessionRules, recordRuleFeedback } from './session-rules.ts';

export function applyReviewDecision<T extends IconItem>(item: T, candidateId: string, requested: 'accepted' | 'rejected' | 'pending'): T {
  const candidate = item.candidates.find(value => value.id === candidateId);
  if (!candidate) return item;
  const decision = candidate.status === requested ? 'pending' : requested;
  let sessionRules = item.sessionRules ?? emptySessionRules();
  const candidates = item.candidates.map(value => {
    if (value.id === candidateId) return { ...value, status: decision };
    if (decision === 'accepted' && value.status === 'accepted' && (!candidate.pairId || value.treatment === candidate.treatment || !value.pairId)) {
      sessionRules = recordRuleFeedback(sessionRules, value, 'pending');
      return { ...value, status: 'pending' as const };
    }
    return value;
  });
  sessionRules = recordRuleFeedback(sessionRules, candidate, decision);
  return { ...item, candidates, sessionRules };
}

export function ruleLearningFingerprint(item: Pick<IconItem, 'brief' | 'sessionRules'>, standards: Standards): string {
  const value = item.sessionRules ?? emptySessionRules();
  return JSON.stringify([item.brief, standards, value.rules.map(rule => rule.text), value.feedback, value.dismissedRules]);
}
