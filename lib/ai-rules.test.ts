import assert from "node:assert/strict";
import test from "node:test";
const { AIError, buildGenerationRequest, buildRuleSuggestionRequest, parseGenerationInput, parseRuleSuggestionInput, parseRuleSuggestionOutput, suggestSessionRules }: typeof import("./ai") = await import(new URL("./ai.ts", import.meta.url).href);

const standards = { style: "line", strokeWidth: 1.5, gridSize: 24, corner: "round", primaryColor: "#171717", secondaryColor: "#a3a3a3", padding: 2 };
const svg = '<svg viewBox="0 0 24 24" fill="none" stroke="#171717"><path d="M4 4H20V20H4Z"/></svg>';
const feedback = [{ candidateId: "a", name: "Open box", svg, rationale: "One broad counter", decision: "accepted" }, { candidateId: "b", name: "Detailed box", svg: svg.replace("M4 4H20V20H4Z", "M4 4H20V20H4Z M8 8H16 M8 12H16"), rationale: "Extra interior dividers", decision: "rejected" }];
const input = (overrides: Record<string, unknown> = {}) => parseRuleSuggestionInput({ brief: "A box for saved documents", standards, feedback, rules: ["Use a recognizable box silhouette."], dismissedRules: ["Prefer rotational symmetry."], ...overrides });
const suggestion = { text: "Prefer one broad open counter over multiple interior dividers.", reason: "The accepted box has one open interior; the rejected option adds dividers.", evidenceIds: ["a", "b"] };
const provider = (data: unknown) => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(data) }] }] });

test("approved rules propagate to creation, refinement and redesign without unapproved state", () => {
  for (const mode of ["create", "refine", "redesign", "normalize"]) {
    const parsed = parseGenerationInput({ brief: "A saved documents box", mode, standards, count: 4, references: mode === "create" ? [] : [svg], rules: ["Keep one broad counter."], suggestions: ["Unapproved invention"], dismissedRules: ["Dismissed invention"] });
    const request = buildGenerationRequest(parsed, "test-model");
    assert.deepEqual(JSON.parse(request.input as string).approvedSessionRules, ["Keep one broad counter."]);
    assert.match(request.instructions, /Follow approvedSessionRules/);
    assert.ok(!JSON.stringify(request).includes("Unapproved invention"));
    assert.ok(!JSON.stringify(request).includes("Dismissed invention"));
  }
  const parsed = parseGenerationInput({ brief: "A saved documents box", mode: "create", standards, count: 4 });
  assert.deepEqual(parsed.rules, []);
});

test("rules and feedback input reject malformed, excessive, duplicate or unsafe entries", () => {
  for (const overrides of [
    { rules: "rule" }, { rules: Array(21).fill("Keep it simple") }, { rules: [""] }, { rules: ["x".repeat(501)] }, { rules: ["!!!"] },
    { dismissedRules: Array(51).fill("Avoid detail") }, { feedback: [] }, { feedback: Array(21).fill(feedback[0]) },
    { feedback: [feedback[0], feedback[0]] }, { feedback: [{ ...feedback[0], decision: "pending" }] },
    { feedback: [{ ...feedback[0], svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>' }] },
    { feedback: [{ ...feedback[0], candidateId: "x".repeat(161) }] }, { apiKey: "a-valid-looking-key\nInjected: header" },
  ]) assert.throws(() => input(overrides), AIError);
  assert.deepEqual(input({ rules: ["Keep it simple", "KEEP IT SIMPLE."] }).rules, ["KEEP IT SIMPLE."]);
});

test("the suggestion prompt asks for cautious evidence, session scope and explicit approval", () => {
  const request = buildRuleSuggestionRequest(input(), "test-model");
  assert.match(request.instructions, /A rejection alone does not explain why/);
  assert.match(request.instructions, /A single accepted icon supports only a tentative/);
  assert.match(request.instructions, /Scope every proposal to this session/);
  assert.match(request.instructions, /cannot approve, apply, replace or delete/);
  assert.match(request.instructions, /Dismissed rules must not be suggested again/);
  assert.equal(request.store, false);
  assert.equal(request.text.format.schema.properties.suggestions.maxItems, 3);
});

test("provider output requires real evidence IDs and excludes approved, dismissed and duplicate rules", () => {
  assert.deepEqual(parseRuleSuggestionOutput({ suggestions: [] }, input()), { suggestions: [] });
  const result = parseRuleSuggestionOutput({ suggestions: [suggestion, { ...suggestion, text: "USE A RECOGNIZABLE BOX SILHOUETTE!" }, { ...suggestion, text: "Prefer rotational symmetry" }] }, input());
  assert.deepEqual(result.suggestions, [suggestion]);
  assert.equal(parseRuleSuggestionOutput({ suggestions: [suggestion, suggestion] }, input()).suggestions.length, 1);
  for (const suggestions of [[{ ...suggestion, evidenceIds: ["invented"] }], [{ ...suggestion, evidenceIds: [] }], [{ ...suggestion, text: "x".repeat(501) }], Array(4).fill(suggestion)]) {
    assert.throws(() => parseRuleSuggestionOutput({ suggestions }, input()), (error: unknown) => error instanceof AIError && error.status === 502 && error.code === "invalid_rule_suggestion");
  }
});

test("mocked rule analysis uses bounded structured Responses without exposing keys or applying rules", async () => {
  const parsed = input({ apiKey: "sk-ephemeral-test-key-123", model: "test-model" });
  const before = structuredClone(parsed);
  let calls = 0;
  const result = await suggestSessionRules(parsed, { apiKey: "sk-server-secret", fetcher: (async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer sk-ephemeral-test-key-123");
    assert.ok(!String(init?.body).includes("sk-"));
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(JSON.parse(body.input).feedback.map((entry: { decision: string }) => entry.decision), ["accepted", "rejected"]);
    return provider({ suggestions: [suggestion] });
  }) as typeof fetch });
  assert.equal(calls, 1);
  assert.deepEqual(result, { suggestions: [suggestion] });
  assert.deepEqual(parsed, before);
});

test("rule analysis can return no proposal, skip a full rule set, and handle credentials and cancellation safely", async () => {
  assert.deepEqual(await suggestSessionRules(input(), { apiKey: "sk-test", fetcher: (async () => provider({ suggestions: [] })) as typeof fetch }), { suggestions: [] });
  assert.deepEqual(await suggestSessionRules(input({ rules: Array.from({ length: 20 }, (_, index) => `Rule ${index}`) }), { fetcher: (() => { throw Error("Must not call"); }) as typeof fetch }), { suggestions: [] });
  await assert.rejects(suggestSessionRules(input()), (error: unknown) => error instanceof AIError && error.code === "api_key_required");
  await assert.rejects(suggestSessionRules(input(), { apiKey: "sk-private", fetcher: (async () => new Response("sk-private", { status: 401 })) as typeof fetch }), (error: unknown) => error instanceof AIError && error.code === "invalid_api_key" && !error.message.includes("sk-private"));
  const fetcher = (async (_url, init) => new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })) as typeof fetch;
  await assert.rejects(suggestSessionRules(input(), { apiKey: "sk-test", fetcher, timeoutMs: 5 }), (error: unknown) => error instanceof AIError && error.code === "timeout");
  const controller = new AbortController();
  const pending = suggestSessionRules(input(), { apiKey: "sk-test", fetcher, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof AIError && error.code === "cancelled");
});
