import assert from "node:assert/strict";
import test from "node:test";

const { isApiKeyLike, normalizeModelSelection }: typeof import("./model-selection") = await import(new URL("./model-selection.ts", import.meta.url).href);
const { AIError, isValidModel, parseConnectionInput, parseGenerationInput, parseRuleSuggestionInput, verifyAIConnection, generateIcons }: typeof import("./ai") = await import(new URL("./ai.ts", import.meta.url).href);
const standards = { style: "line", strokeWidth: 1.5, gridSize: 24, corner: "round", primaryColor: "#171717", secondaryColor: "#a3a3a3", padding: 2 };
const input = { brief: "A saved documents box", standards, count: 4, mode: "create" };

test("model selection restores valid models and discards credentials or malformed names", () => {
  for (const model of ["gpt-6.1-sol", "gpt-6-astra", "ft:gpt-6-luna:example:custom", "x".repeat(100)]) {
    assert.equal(isApiKeyLike(model), false);
    assert.equal(normalizeModelSelection(` ${model} `), model);
    assert.equal(isValidModel(model), true);
  }
  for (const value of [null, {}, "", "  ", "https://example.com", "model name", "x".repeat(101), "sk-proj-not-a-real-key", " SK-PROJ-placeholder ", "Bearer sk-test-placeholder"]) {
    assert.equal(normalizeModelSelection(value), "");
    assert.equal(normalizeModelSelection(value, "gpt-6.1-sol"), "gpt-6.1-sol");
    assert.equal(normalizeModelSelection(value, "sk-proj-invalid-fallback"), "");
  }
  assert.equal(isValidModel("sk-proj-not-a-real-key"), false);
});

test("all AI input boundaries reject a key in the model field without repeating it", () => {
  for (const secret of ["sk-test-placeholder", `sk-proj-${"x".repeat(150)}`, " Bearer sk-svcacct-placeholder "]) {
    assert.equal(isApiKeyLike(secret), true);
    for (const parse of [
      () => parseConnectionInput({ model: secret }),
      () => parseGenerationInput({ ...input, model: secret }),
      () => parseRuleSuggestionInput({ ...input, model: secret, feedback: [] }),
    ]) {
      assert.throws(parse, (error: unknown) => error instanceof AIError && error.code === "api_key_in_model" && error.status === 400 && !error.message.includes(secret.trim()) && !error.message.includes("sk-"));
    }
  }
});

test("accidental key selections never reach provider URLs or request bodies", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; throw new Error("Provider must not be contacted"); }) as typeof fetch;
  await assert.rejects(verifyAIConnection({ apiKey: "sk-ephemeral-test-key", model: "sk-proj-not-a-model" }, { fetcher }), (error: unknown) => error instanceof AIError && error.code === "api_key_in_model");
  await assert.rejects(generateIcons(parseGenerationInput(input), { apiKey: "sk-ephemeral-test-key", defaultModel: "sk-proj-not-a-model", fetcher }), (error: unknown) => error instanceof AIError && error.code === "invalid_model_configuration" && !error.message.includes("sk-"));
  assert.equal(calls, 0);
});
