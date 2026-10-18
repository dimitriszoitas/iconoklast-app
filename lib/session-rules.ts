import type { Candidate } from "./icon-types.ts";

export const MAX_SESSION_RULES = 20;
export const MAX_RULE_LENGTH = 500;
export const MAX_RULE_FEEDBACK = 20;
export const MAX_RULE_SUGGESTIONS = 3;
export const MAX_DISMISSED_RULES = 50;

export type SessionRule = { id: string; text: string; source: "manual" | "learned" };
export type RuleSuggestion = { id: string; text: string; reason: string; evidenceIds: string[] };
export type RuleFeedback = { candidateId: string; name: string; svg: string; rationale: string; decision: "accepted" | "rejected" };
export type SessionRules = { rules: SessionRule[]; feedback: RuleFeedback[]; suggestions: RuleSuggestion[]; dismissedRules: string[] };

export function emptySessionRules(): SessionRules {
  return { rules: [], feedback: [], suggestions: [], dismissedRules: [] };
}

/** Whitespace and punctuation differences must not resurface the same proposal. */
export function ruleTextKey(text: string): string {
  return text.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > max) return undefined;
  return value.trim();
}

function feedbackEntry(value: unknown): RuleFeedback | undefined {
  if (!record(value)) return undefined;
  const candidateId = boundedText(value.candidateId, 160);
  const name = boundedText(value.name, 80);
  const svg = boundedText(value.svg, 32_768);
  const rationale = typeof value.rationale === "string" && value.rationale.length <= 500 ? value.rationale.trim() : "";
  if (!candidateId || !name || !svg || (value.decision !== "accepted" && value.decision !== "rejected")) return undefined;
  // SVGs stay opaque here. The server validates the full SVG grammar before any
  // model call; these strings are never rendered by the rules UI.
  return { candidateId, name, svg, rationale, decision: value.decision };
}

/** Restore only bounded, well-formed data from an older or modified workspace. */
export function normalizeSessionRules(input: unknown): SessionRules {
  if (!record(input)) return emptySessionRules();
  const result = emptySessionRules();
  const ruleIds = new Set<string>();
  const ruleTexts = new Set<string>();
  for (const value of Array.isArray(input.rules) ? input.rules.slice(0, 200) : []) {
    if (!record(value)) continue;
    const id = boundedText(value.id, 160);
    const text = boundedText(value.text, MAX_RULE_LENGTH);
    if (!id || !text || !ruleTextKey(text) || (value.source !== "manual" && value.source !== "learned") || ruleIds.has(id) || ruleTexts.has(ruleTextKey(text))) continue;
    result.rules.push({ id, text, source: value.source });
    ruleIds.add(id);
    ruleTexts.add(ruleTextKey(text));
    if (result.rules.length === MAX_SESSION_RULES) break;
  }
  const feedback = new Map<string, RuleFeedback>();
  for (const value of Array.isArray(input.feedback) ? input.feedback.slice(-200) : []) {
    const entry = feedbackEntry(value);
    if (!entry) continue;
    feedback.delete(entry.candidateId);
    feedback.set(entry.candidateId, entry);
  }
  result.feedback = [...feedback.values()].slice(-MAX_RULE_FEEDBACK);
  const dismissed = new Set<string>();
  for (const value of Array.isArray(input.dismissedRules) ? input.dismissedRules.slice(-200) : []) {
    const text = boundedText(value, MAX_RULE_LENGTH);
    if (!text || !ruleTextKey(text) || dismissed.has(ruleTextKey(text))) continue;
    result.dismissedRules.push(text);
    dismissed.add(ruleTextKey(text));
  }
  result.dismissedRules = result.dismissedRules.slice(-MAX_DISMISSED_RULES);
  const evidence = new Set(result.feedback.map((entry) => entry.candidateId));
  const suggestionIds = new Set<string>();
  for (const value of Array.isArray(input.suggestions) ? input.suggestions.slice(0, 30) : []) {
    if (!record(value)) continue;
    const id = boundedText(value.id, 160);
    const text = boundedText(value.text, MAX_RULE_LENGTH);
    const reason = boundedText(value.reason, 500);
    const evidenceIds = [...new Set(Array.isArray(value.evidenceIds) ? value.evidenceIds.filter((id): id is string => typeof id === "string" && evidence.has(id)) : [])];
    if (!id || !text || !reason || !evidenceIds.length || suggestionIds.has(id) || !ruleTextKey(text) || ruleTexts.has(ruleTextKey(text)) || dismissed.has(ruleTextKey(text))) continue;
    result.suggestions.push({ id, text, reason, evidenceIds });
    suggestionIds.add(id);
    ruleTexts.add(ruleTextKey(text));
    if (result.suggestions.length === MAX_RULE_SUGGESTIONS) break;
  }
  return result;
}

/** Keep the current verdict, not an accumulating vote count for one candidate. */
export function recordRuleFeedback(state: SessionRules, candidate: Pick<Candidate, "id" | "name" | "svg" | "rationale">, decision: "accepted" | "rejected" | "pending"): SessionRules {
  const normalized = normalizeSessionRules(state);
  const feedback = normalized.feedback.filter((entry) => entry.candidateId !== candidate.id);
  // Editing adds a suffix to names and recoloring appends notes. These are
  // descriptive labels, so bound them without silently losing the verdict.
  // Never truncate SVG geometry to force it into the analysis budget.
  const entry = decision === "pending" ? undefined : feedbackEntry({ candidateId: candidate.id, name: candidate.name.slice(0, 80), svg: candidate.svg, rationale: candidate.rationale.slice(0, 500), decision });
  if (entry) feedback.push(entry);
  return { ...normalized, feedback: feedback.slice(-MAX_RULE_FEEDBACK), suggestions: [] };
}
