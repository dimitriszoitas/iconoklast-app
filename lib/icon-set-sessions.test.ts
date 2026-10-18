import assert from 'node:assert/strict';
import test from 'node:test';
import type { Candidate, IconItem, Standards } from './icon-types.ts';
import { applySessionReviewDecision, buildRuleLearningItems, getItemSessionRules, LEGACY_UPLOAD_SESSION_ID, migrateIconSetSessions, type IconSetSession } from './icon-set-sessions.ts';
import { ruleLearningFingerprint } from './review-decisions.ts';
import { emptySessionRules, recordRuleFeedback, type SessionRules } from './session-rules.ts';

const svg = '<svg viewBox="0 0 24 24"><path d="M4 4H20V20H4Z"/></svg>';
const standards = { style: 'line', strokeWidth: 2, gridSize: 24, corner: 'round', primaryColor: '#252331', secondaryColor: '#7254d4', padding: 2 } as Standards;
function icon(id: string, sessionId?: string): IconItem {
  return {
    id, name: id, brief: `A clear ${id} icon.`, sessionId, originalSvg: svg, round: 1,
    candidates: [0, 1].map(index => ({ id: `${id}-${index}`, name: `${id} direction ${index}`, svg, rationale: 'Simple geometric construction.', status: 'pending', source: 'ai' })),
  };
}
function rules(text = 'Keep outlines consistent.'): SessionRules {
  return { ...emptySessionRules(), rules: [{ id: 'r', text, source: 'manual' }] };
}
function session(id = 'set-a'): IconSetSession { return { id, name: 'Business icons', rules: rules() }; }

test('legacy uploads migrate to one set, deduplicate approved rules and preserve pending approval', () => {
  const customer = icon('customer');
  customer.sessionRules = recordRuleFeedback(rules(), customer.candidates[0], 'accepted');
  customer.sessionRules.suggestions = [{ id: 's', text: 'Prefer open counters.', reason: 'The accepted direction has open counters.', evidenceIds: ['customer-0'] }];
  const office = icon('office');
  office.sessionRules = recordRuleFeedback(rules('KEEP outlines consistent'), office.candidates[1], 'rejected');
  office.sessionRules.rules.push({ id: 'other', text: 'Use square visible bounds.', source: 'learned' });
  office.sessionRules.dismissedRules = ['Avoid diagonal details.'];
  const ordinary = { ...icon('folder'), originalSvg: undefined, sessionRules: rules('Keep the tab visible.') };
  const migrated = migrateIconSetSessions([customer, office, ordinary], undefined);
  assert.deepEqual(migrated.items.map(item => item.sessionId), [LEGACY_UPLOAD_SESSION_ID, LEGACY_UPLOAD_SESSION_ID, undefined]);
  assert.equal(migrated.sessions.length, 1);
  assert.equal(migrated.items[0].sessionRules, undefined);
  assert.equal(migrated.items[1].sessionRules, undefined);
  assert.equal(migrated.items[2], ordinary);
  const shared = migrated.sessions[0].rules;
  assert.deepEqual(shared.rules.map(rule => rule.text), ['Keep outlines consistent.', 'Use square visible bounds.']);
  assert.deepEqual(shared.rules.map(rule => rule.source), ['manual', 'learned']);
  assert.deepEqual(shared.feedback.map(entry => entry.candidateId), ['customer-0', 'office-1']);
  assert.deepEqual(shared.suggestions.map(suggestion => suggestion.text), ['Prefer open counters.']);
  assert.deepEqual(shared.dismissedRules, ['Avoid diagonal details.']);
  assert.equal(customer.sessionRules.rules.length, 1);
  assert.deepEqual(migrateIconSetSessions(migrated.items, migrated.sessions), migrated);
});

test('migration keeps valid sets distinct, preserves a member without its original and drops orphan records', () => {
  const first = { ...icon('customer', 'set-a'), originalSvg: undefined, revisions: [{ round: 1 }] };
  const second = icon('office', 'set-b');
  const prior = [session(), { ...session('set-b'), rules: rules('Use heavier details.') }, session('orphan')];
  const migrated = migrateIconSetSessions<IconItem & { revisions?: { round: number }[] }>([first, second], prior);
  assert.deepEqual(migrated.sessions.map(value => value.id), ['set-a', 'set-b']);
  assert.deepEqual(migrated.items[0].revisions, first.revisions);
  assert.equal(migrated.items[0].originalSvg, undefined);
  assert.deepEqual(getItemSessionRules(migrated.items[0], migrated.sessions).rules, prior[0].rules.rules);
  assert.deepEqual(getItemSessionRules(migrated.items[1], migrated.sessions).rules, prior[1].rules.rules);
});

test('restored set records are bounded and invalid identities and names are sanitized', () => {
  const invalid = { ...icon('customer'), sessionId: ' '.repeat(5) };
  const restored = migrateIconSetSessions([invalid, icon('office', 'set-a')], [
    null, { id: 'x'.repeat(161), name: 'Invalid', rules: rules() },
    { id: 'set-a', name: 'x'.repeat(121), rules: { rules: Array.from({ length: 40 }, (_, index) => ({ id: `r${index}`, text: `Keep feature ${index}`, source: 'manual' })) } },
  ]);
  assert.equal(restored.items[0].sessionId, LEGACY_UPLOAD_SESSION_ID);
  assert.equal(restored.sessions[1].name, 'Uploaded icon set');
  assert.equal(restored.sessions[1].rules.rules.length, 20);
  const clean = migrateIconSetSessions([{ ...icon('new'), originalSvg: undefined, sessionId: 'x'.repeat(161) }], []);
  assert.equal(clean.items[0].sessionId, undefined);
  assert.deepEqual(clean.sessions, []);
});

test('colliding legacy IDs do not lose distinct approved rules during merge', () => {
  const first = { ...icon('customer'), sessionRules: rules('Use open counters.') };
  const second = { ...icon('office'), sessionRules: rules('Use rounded corners.') };
  const merged = migrateIconSetSessions([first, second], []).sessions[0].rules;
  assert.equal(merged.rules.length, 2);
  assert.equal(new Set(merged.rules.map(rule => rule.id)).size, 2);
});

test('set directions restore within their bound and remain attached after a verdict', () => {
  const members = [icon('customer', 'set-a'), icon('office', 'set-b')];
  const saved = [{ ...session(), direction: '  Use a calmer architectural language.  ' }, { ...session('set-b'), direction: 'x'.repeat(1_001) }];
  const migrated = migrateIconSetSessions(members, saved);
  assert.equal(migrated.sessions[0].direction, 'Use a calmer architectural language.');
  assert.equal(migrated.sessions[1].direction, undefined);
  const reviewed = applySessionReviewDecision(migrated.items, migrated.sessions, 'customer', 'customer-0', 'accepted');
  assert.equal(reviewed.sessions[0].direction, migrated.sessions[0].direction);
  assert.match(reviewed.context!.brief, /Set direction: Use a calmer architectural language\./);
  assert.equal(reviewed.sessions[1].direction, undefined);
});

test('cross-icon decisions share feedback, undo independently, and supersede acceptance only inside one icon', () => {
  const source = [icon('customer', 'set-a'), icon('office', 'set-a'), icon('other', 'set-b')];
  const saved = [session(), session('set-b')];
  let result = applySessionReviewDecision(source, saved, 'customer', 'customer-0', 'accepted');
  result = applySessionReviewDecision(result.items, result.sessions, 'office', 'office-0', 'accepted');
  assert.equal(result.items[0].candidates[0].status, 'accepted');
  assert.equal(result.items[1].candidates[0].status, 'accepted');
  assert.deepEqual(result.sessions[0].rules.feedback.map(entry => entry.candidateId), ['customer-0', 'office-0']);
  assert.equal(result.context?.id, 'set-a');
  assert.equal(result.context?.candidates.length, 4);
  assert.equal(result.reviewed?.id, 'office-0');
  assert.equal(result.items[1].sessionRules, undefined);
  assert.deepEqual(result.sessions[1], saved[1]);
  result = applySessionReviewDecision(result.items, result.sessions, 'customer', 'customer-1', 'accepted');
  assert.equal(result.items[0].candidates[0].status, 'pending');
  assert.equal(result.items[1].candidates[0].status, 'accepted');
  assert.deepEqual(result.sessions[0].rules.feedback.map(entry => entry.candidateId), ['office-0', 'customer-1']);
  result = applySessionReviewDecision(result.items, result.sessions, 'office', 'office-0', 'accepted');
  assert.equal(result.items[1].candidates[0].status, 'pending');
  assert.deepEqual(result.sessions[0].rules.feedback.map(entry => entry.candidateId), ['customer-1']);
  result = applySessionReviewDecision(result.items, result.sessions, 'customer', 'customer-1', 'rejected');
  assert.deepEqual(result.sessions[0].rules.feedback.map(entry => entry.decision), ['rejected']);
  assert.deepEqual(source.map(item => item.candidates[0].status), ['pending', 'pending', 'pending']);
  assert.deepEqual(saved[0].rules.feedback, []);
});

test('paired treatments remain independently accepted within a shared set', () => {
  const item = icon('customer', 'set-a');
  item.candidates = item.candidates.map((candidate, index) => ({ ...candidate, pairId: 'pair', treatment: index ? 'filled' : 'line' } as Candidate));
  let result = applySessionReviewDecision([item], [session()], item.id, 'customer-0', 'accepted');
  result = applySessionReviewDecision(result.items, result.sessions, item.id, 'customer-1', 'accepted');
  assert.deepEqual(result.items[0].candidates.map(candidate => candidate.status), ['accepted', 'accepted']);
  assert.equal(result.sessions[0].rules.feedback.length, 2);
});

test('ordinary design sessions keep their own rules and unknown candidates are a no-op', () => {
  const ordinary = { ...icon('folder'), originalSvg: undefined, sessionRules: rules('Keep the tab visible.') };
  const items = [ordinary, icon('customer', 'set-a')];
  const sessions = [session()];
  const changed = applySessionReviewDecision(items, sessions, ordinary.id, 'folder-0', 'rejected');
  assert.equal(changed.context?.id, ordinary.id);
  assert.equal(changed.items[0].sessionRules?.feedback.length, 1);
  assert.equal(changed.sessions, sessions);
  assert.deepEqual(applySessionReviewDecision(items, sessions, ordinary.id, 'missing', 'accepted'), { items, sessions });
});

test('all members resolve the same generation rules and one learning context reflects every brief', () => {
  const members = [icon('customer', 'set-a'), icon('office', 'set-a'), icon('other', 'set-b')];
  members[0].brief = 'A'.repeat(2_500);
  const ordinary = { ...icon('folder'), originalSvg: undefined, sessionRules: rules('Keep the tab visible.') };
  const sessions = [session(), { ...session('set-b'), rules: rules('Favor diagonal composition.') }];
  assert.deepEqual(getItemSessionRules(members[0], sessions), getItemSessionRules(members[1], sessions));
  assert.notDeepEqual(getItemSessionRules(members[0], sessions), getItemSessionRules(members[2], sessions));
  const contexts = buildRuleLearningItems([...members, ordinary], sessions);
  assert.deepEqual(contexts.map(item => item.id), ['set-a', 'set-b', 'folder']);
  assert.equal(contexts[0].brief.length, 2_000);
  assert.equal(contexts[0].candidates.length, 4);
  assert.equal(contexts[2], ordinary);
  const fingerprint = ruleLearningFingerprint(contexts[0], standards);
  const updated = members.map(item => item.id === 'office' ? { ...item, brief: 'The changed office meaning.' } : item);
  const after = buildRuleLearningItems(updated, sessions);
  assert.notEqual(ruleLearningFingerprint(after[0], standards), fingerprint);
  assert.equal(ruleLearningFingerprint(after[1], standards), ruleLearningFingerprint(contexts[1], standards));
  const redirected = buildRuleLearningItems(members, sessions.map(value => value.id === 'set-a' ? { ...value, direction: 'Favor calm architectural silhouettes.' } : value));
  assert.notEqual(ruleLearningFingerprint(redirected[0], standards), fingerprint);
  assert.equal(ruleLearningFingerprint(redirected[1], standards), ruleLearningFingerprint(contexts[1], standards));
  assert.equal(redirected[0].brief.length, 2_000);
  assert.match(redirected[0].brief, /Set direction: Favor calm architectural silhouettes\./);
});
