import test from "node:test";
import assert from "node:assert/strict";
import { getAIEnvironment } from "./ai-env.ts";

test("public AI environment never exposes an owner-funded API key", () => {
  const original = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "synthetic-owner-key-must-not-be-used";
    const environment = getAIEnvironment();
    assert.equal(Object.hasOwn(environment, "apiKey"), false);
    assert.equal(JSON.stringify(environment).includes(process.env.OPENAI_API_KEY), false);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});
