import type { Candidate, IconItem } from './icon-types.ts';
import { applyReviewDecision } from './review-decisions.ts';
import { emptySessionRules, normalizeSessionRules, ruleTextKey, type SessionRules } from './session-rules.ts';

export type IconSetSession = { id: string; name: string; rules: SessionRules; direction?: string };

export const LEGACY_UPLOAD_SESSION_ID = 'legacy-upload-set';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;
}

/** Merge previously separate rules without treating any pending proposal as approved. */
function mergeRules(states: unknown[]): SessionRules {
  const merged = emptySessionRules();
  const ruleIds = new Set<string>();
  const ruleTexts = new Set<string>();
  const suggestionIds = new Set<string>();
  let renamedRule = 0;
  let renamedSuggestion = 0;
  for (const state of states) {
    const normalized = normalizeSessionRules(state);
    for (const rule of normalized.rules) {
      if (ruleTexts.has(ruleTextKey(rule.text))) continue;
      let id = rule.id;
      while (ruleIds.has(id)) id = `merged-rule-${++renamedRule}`;
      ruleIds.add(id);
      ruleTexts.add(ruleTextKey(rule.text));
      merged.rules.push({ ...rule, id });
    }
    merged.feedback.push(...normalized.feedback);
    merged.dismissedRules.push(...normalized.dismissedRules);
    for (const suggestion of normalized.suggestions) {
      let id = suggestion.id;
      while (suggestionIds.has(id)) id = `merged-suggestion-${++renamedSuggestion}`;
      suggestionIds.add(id);
      merged.suggestions.push({ ...suggestion, id });
    }
  }
  return normalizeSessionRules(merged);
}

/** Restore set identities and migrate older uploads into one shared session. */
export function migrateIconSetSessions<T extends IconItem>(items: T[], saved: unknown): { items: T[]; sessions: IconSetSession[] } {
  const savedById = new Map<string, IconSetSession>();
  for (const value of Array.isArray(saved) ? saved.slice(0, 1_000) : []) {
    if (!record(value)) continue;
    const id = text(value.id, 160);
    if (!id || savedById.has(id)) continue;
    const direction = text(value.direction, 1_000);
    savedById.set(id, { id, name: text(value.name, 120) ?? 'Uploaded icon set', rules: normalizeSessionRules(value.rules), ...(direction ? { direction } : {}) });
  }

  const members = new Map<string, T[]>();
  const migrated = items.map(item => {
    const sessionId = text(item.sessionId, 160) ?? (item.originalSvg ? LEGACY_UPLOAD_SESSION_ID : undefined);
    if (!sessionId) {
      if (!item.sessionId) return item;
      const cleaned = { ...item };
      delete cleaned.sessionId;
      return cleaned;
    }
    members.set(sessionId, [...(members.get(sessionId) ?? []), item]);
    const cleaned = { ...item, sessionId };
    delete cleaned.sessionRules;
    return cleaned;
  });
  const sessions = [...members].map(([id, group]) => {
    const previous = savedById.get(id);
    return {
      id,
      name: previous?.name ?? 'Uploaded icon set',
      rules: mergeRules([previous?.rules, ...group.map(item => item.sessionRules)]),
      ...(previous?.direction ? { direction: previous.direction } : {}),
    };
  });
  return { items: migrated, sessions };
}

/** Generation and learning must resolve the same approved rules for every member. */
export function getItemSessionRules(item: IconItem, sessions: IconSetSession[]): SessionRules {
  const shared = item.sessionId ? sessions.find(session => session.id === item.sessionId) : undefined;
  return normalizeSessionRules(shared?.rules ?? item.sessionRules);
}

// Include every member's full brief in the version, even when its visible context
// must be shortened to the model's brief limit. Two independent 32-bit hashes
// avoid a late member edit retaining an earlier request's learning fingerprint.
function contextVersion(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const character = value.charCodeAt(index);
    first = Math.imul(first ^ character, 0x01000193);
    second = Math.imul(second ^ character, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

function learningItem(session: IconSetSession, members: IconItem[]): IconItem {
  const direction = text(session.direction, 1_000);
  const version = contextVersion(JSON.stringify([direction ?? '', members.map(item => [item.id, item.name, item.brief])]));
  const introduction = `Shared icon set: ${session.name}. Learn only visual rules that can apply consistently across this set. Context ${version}.\n`;
  const context = `${direction ? `Set direction: ${direction}\n` : ''}${members.map(item => `${item.name}: ${item.brief}`).join('\n')}`;
  return {
    id: session.id,
    sessionId: session.id,
    name: session.name,
    brief: `${introduction}${context}`.slice(0, 2_000),
    candidates: members.flatMap(item => item.candidates),
    round: Math.max(0, ...members.map(item => item.round)),
    sessionRules: normalizeSessionRules(session.rules),
  };
}

/** One learning job per set prevents one icon's review from racing another's. */
export function buildRuleLearningItems(items: IconItem[], sessions: IconSetSession[]): IconItem[] {
  const grouped = new Map<string, IconItem[]>();
  for (const item of items) {
    if (item.sessionId) grouped.set(item.sessionId, [...(grouped.get(item.sessionId) ?? []), item]);
  }
  const emitted = new Set<string>();
  return items.flatMap(item => {
    if (!item.sessionId) return [item];
    if (emitted.has(item.sessionId)) return [];
    emitted.add(item.sessionId);
    const members = grouped.get(item.sessionId)!;
    const session = sessions.find(value => value.id === item.sessionId) ?? {
      id: item.sessionId,
      name: 'Uploaded icon set',
      rules: mergeRules(members.map(member => member.sessionRules)),
    };
    return [learningItem(session, members)];
  });
}

/** A verdict changes this icon's choices while accumulating evidence for its set. */
export function applySessionReviewDecision<T extends IconItem>(
  items: T[],
  sessions: IconSetSession[],
  itemId: string,
  candidateId: string,
  status: 'accepted' | 'rejected' | 'pending',
): { items: T[]; sessions: IconSetSession[]; context?: IconItem; reviewed?: Candidate } {
  const item = items.find(value => value.id === itemId);
  if (!item?.candidates.some(candidate => candidate.id === candidateId)) return { items, sessions };
  const next = applyReviewDecision({ ...item, sessionRules: getItemSessionRules(item, sessions) }, candidateId, status);
  const reviewed = next.candidates.find(candidate => candidate.id === candidateId);
  if (!item.sessionId) {
    return { items: items.map(value => value.id === itemId ? next : value), sessions, context: next, reviewed };
  }
  const previousSession = sessions.find(value => value.id === item.sessionId);
  const updatedSession: IconSetSession = {
    ...previousSession,
    id: item.sessionId,
    name: previousSession?.name ?? 'Uploaded icon set',
    rules: next.sessionRules,
  };
  delete (next as IconItem).sessionRules;
  const updatedItems = items.map(value => value.id === itemId ? next : value);
  const updatedSessions = sessions.some(value => value.id === item.sessionId)
    ? sessions.map(value => value.id === item.sessionId ? updatedSession : value)
    : [...sessions, updatedSession];
  return {
    items: updatedItems,
    sessions: updatedSessions,
    context: learningItem(updatedSession, updatedItems.filter(value => value.sessionId === item.sessionId)),
    reviewed,
  };
}
