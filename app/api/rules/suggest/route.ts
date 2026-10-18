import { AIError, MAX_REQUEST_BYTES, aiErrorResponse, assertSameOrigin, parseRuleSuggestionInput, readBoundedJson, suggestSessionRules } from "@/lib/ai";
import { getAIEnvironment } from "@/lib/ai-env";
import { readRememberedKey, resolveApiKey } from "@/lib/remembered-key";

export const runtime = "nodejs";
export const maxDuration = 60;

// This analysis is debounced in the client and bounded again per worker.
let inFlight = 0;
const MAX_IN_FLIGHT = 2;

export async function POST(request: Request): Promise<Response> {
  let acquired = false;
  try {
    assertSameOrigin(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new AIError("Send the request as JSON.", 415, "unsupported_content_type");
    const input = parseRuleSuggestionInput(await readBoundedJson(request, MAX_REQUEST_BYTES));
    if (inFlight >= MAX_IN_FLIGHT) throw new AIError("Rule suggestions are busy. Try again in a moment.", 429, "busy");
    inFlight++;
    acquired = true;
    const environment = getAIEnvironment();
    const apiKey = resolveApiKey(input.apiKey, await readRememberedKey(request, environment));
    const result = await suggestSessionRules(input, { apiKey, defaultModel: environment.defaultModel, signal: request.signal });
    return Response.json(result, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return aiErrorResponse(error);
  } finally {
    if (acquired) inFlight--;
  }
}
