import assert from "node:assert/strict";
import test from "node:test";
const { emptySessionRules, normalizeSessionRules, recordRuleFeedback }: typeof import("./session-rules") = await import(new URL("./session-rules.ts", import.meta.url).href);

const candidate = (id = "one") => ({ id, name: "Open box", svg: '<svg viewBox="0 0 24 24"><path d="M4 4H20V20H4Z"/></svg>', rationale: "An open, simple construction." });

test("session state defaults and restored data are bounded and deduplicated", () => {
  assert.deepEqual(normalizeSessionRules(null), emptySessionRules());
  const rules = Array.from({ length: 25 }, (_, index) => ({ id: `r${index}`, text: `Keep detail ${index}`, source: "manual" }));
  assert.equal(normalizeSessionRules({ rules }).rules.length, 20);
  const normalized = normalizeSessionRules({ rules: [rules[0], rules[0], { id: "duplicate-text", text: " KEEP   DETAIL 0. ", source: "learned" }, { id: "bad", text: "x".repeat(501), source: "manual" }, { id: "wrong-source", text: "Keep it clear", source: "suggested" }], feedback: Array.from({ length: 30 }, (_, index) => ({ ...candidate(`c${index}`), candidateId: `c${index}`, decision: "accepted" })), dismissedRules: ["Avoid ornament.", "AVOID ORNAMENT", "x".repeat(501)] });
  assert.equal(normalized.rules.length, 1);
  assert.equal(normalized.feedback.length, 20);
  assert.equal(normalized.feedback[0].candidateId, "c10");
  assert.deepEqual(normalized.dismissedRules, ["Avoid ornament."]);
});

test("a verdict replaces the candidate's previous decision; undo removes it and proposals become stale", () => {
  let state = recordRuleFeedback(emptySessionRules(), candidate(), "accepted");
  const first = structuredClone(state);
  state.suggestions = [{ id: "s", text: "Keep broad counters", reason: "A visible feature", evidenceIds: ["one"] }];
  state = recordRuleFeedback(state, candidate(), "rejected");
  assert.equal(state.feedback.length, 1);
  assert.equal(state.feedback[0].decision, "rejected");
  assert.deepEqual(state.suggestions, []);
  assert.equal(first.feedback[0].decision, "accepted");
  state = recordRuleFeedback(state, candidate(), "pending");
  assert.deepEqual(state.feedback, []);
});

test("restoration drops unsupported suggestions and never promotes a proposal to a rule", () => {
  const state = recordRuleFeedback(emptySessionRules(), candidate(), "accepted");
  state.rules = [{ id: "rule", text: "Keep broad counters", source: "manual" }];
  state.dismissedRules = ["Avoid detail"];
  state.suggestions = [
    { id: "valid", text: "Favor an open silhouette", reason: "The accepted option has open geometry.", evidenceIds: ["one"] },
    { id: "old", text: "Use symmetry", reason: "Old evidence", evidenceIds: ["missing"] },
    { id: "duplicate", text: "Keep broad counters.", reason: "Already approved", evidenceIds: ["one"] },
    { id: "dismissed", text: "Avoid detail.", reason: "Already dismissed", evidenceIds: ["one"] },
  ];
  const restored = normalizeSessionRules(state);
  assert.deepEqual(restored.rules, state.rules);
  assert.deepEqual(restored.suggestions.map((entry) => entry.id), ["valid"]);
});

test("each session owns independent arrays and feedback ordering keeps the latest twenty", () => {
  const untouched = emptySessionRules();
  let state = emptySessionRules();
  for (let index = 0; index < 25; index++) state = recordRuleFeedback(state, candidate(`c${index}`), "accepted");
  assert.equal(state.feedback.length, 20);
  state = recordRuleFeedback(state, candidate("c5"), "rejected");
  assert.equal(state.feedback.at(-1)?.candidateId, "c5");
  assert.equal(state.feedback.at(-1)?.decision, "rejected");
  assert.deepEqual(untouched, emptySessionRules());
});

test("edited names and appended rationale do not silently discard a valid icon verdict", () => {
  const edited = { ...candidate(), name: `${"n".repeat(80)} · Edited`, rationale: `${"r".repeat(500)} Palette updated.` };
  const state = recordRuleFeedback(emptySessionRules(), edited, "accepted");
  assert.equal(state.feedback.length, 1);
  assert.equal(state.feedback[0].name.length, 80);
  assert.equal(state.feedback[0].rationale.length, 500);
  assert.equal(state.feedback[0].svg, edited.svg);
});
