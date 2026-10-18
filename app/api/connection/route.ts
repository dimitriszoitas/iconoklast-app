import { AIError, aiErrorResponse, assertSameOrigin, parseConnectionInput, readBoundedJson, verifyAIConnection } from "@/lib/ai";
import { getAIEnvironment } from "@/lib/ai-env";
import { canRememberKey, forgottenKeyCookie, readRememberedKey, rememberedKeyCookie, resolveApiKey, sealRememberedKey } from "@/lib/remembered-key";

export const runtime = "nodejs";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      throw new AIError("Send the request as JSON.", 415, "unsupported_content_type");
    }
    const body = await readBoundedJson(request, 1024);
    const input = parseConnectionInput(body);
    const remember = (body as Record<string, unknown>).remember;
    if (remember !== undefined && typeof remember !== "boolean") throw new AIError("Choose whether to remember the API key.");
    const environment = getAIEnvironment();
    const previousKey = await readRememberedKey(request, environment);
    const userKey = input.apiKey || previousKey;
    if (remember === true && !canRememberKey(request, environment)) {
      throw new AIError("Secure key storage is not available for this connection. You can still use your key for this tab.", 503, "remember_unavailable");
    }
    if (remember === true && !userKey) throw new AIError("Enter your own API key to remember it on this device.", 428, "api_key_required");
    if (remember === false && previousKey && !input.apiKey) {
      throw new AIError("Enter your API key to use it for this tab, or choose Forget saved key.", 428, "api_key_required");
    }
    const result = await verifyAIConnection(input, {
      apiKey: resolveApiKey(input.apiKey, previousKey),
      defaultModel: environment.defaultModel,
      signal: request.signal,
    });
    const headers = new Headers(responseHeaders);
    let keySaved = Boolean(previousKey);
    if (remember === true) {
      const sealed = await sealRememberedKey(request, userKey!, environment);
      headers.set("Set-Cookie", rememberedKeyCookie(request, sealed, environment));
      keySaved = true;
    } else if (remember === false) {
      headers.set("Set-Cookie", forgottenKeyCookie(request, environment));
      keySaved = false;
    }
    return Response.json({ ...result, keySaved }, { headers });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    return Response.json({ forgotten: true }, {
      headers: { ...responseHeaders, "Set-Cookie": forgottenKeyCookie(request, getAIEnvironment()) },
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
