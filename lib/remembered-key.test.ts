import test from "node:test";
import assert from "node:assert/strict";
import { canRememberKey, forgottenKeyCookie, getConnectionStatus, openRememberedKey, readRememberedKey, rememberedKeyCookie, REMEMBERED_KEY_MAX_AGE, resolveApiKey, sealRememberedKey } from "./remembered-key.ts";

const environment = { encryptionSecret: Buffer.alloc(32, 9).toString("base64") };
const apiKey = "sk-test-remembered-credential-that-is-not-real";
const now = Date.now();
function request({ origin = "https://iconify.example", user = "", cookie = "" } = {}) {
  return new Request(`${origin}/api/connection`, {
    headers: { ...(user ? { "oai-authenticated-user-id": user } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
}

test("a remembered key is encrypted with a fresh nonce on every save and readable only by the server", async () => {
  const req = request();
  const first = await sealRememberedKey(req, apiKey, environment, now);
  const second = await sealRememberedKey(req, apiKey, environment, now);
  assert.notEqual(first, second);
  assert.equal(first.includes(apiKey), false);
  assert.equal(first.includes(Buffer.from(apiKey).toString("base64")), false);
  assert.equal(await openRememberedKey(req, first, environment, now), apiKey);
  assert.equal(await openRememberedKey(req, second, environment, now), apiKey);
});

test("remembered keys are bound to the origin and server secret", async () => {
  const sealed = await sealRememberedKey(request(), apiKey, environment, now);
  for (const origin of ["https://other.example", "https://iconify.example:444", "http://iconify.example"]) {
    assert.equal(await openRememberedKey(request({ origin }), sealed, environment, now), undefined);
  }
  assert.equal(await openRememberedKey(request(), sealed, { encryptionSecret: Buffer.alloc(32, 8).toString("base64") }, now), undefined);
});

test("identity headers cannot select or retrieve another browser's key", async () => {
  const first = await sealRememberedKey(request({ user: "spoofed-user-one" }), apiKey, environment, now);
  const otherKey = "sk-test-another-browser-credential-not-real";
  const second = await sealRememberedKey(request({ user: "spoofed-user-two" }), otherKey, environment, now);
  for (const user of ["", "spoofed-user-one", "spoofed-user-two", "arbitrary-identity"]) {
    assert.equal(await readRememberedKey(request({ user }), environment, now), undefined);
    assert.equal(await readRememberedKey(request({ user, cookie: `__Host-iconify-openai=${first}` }), environment, now), apiKey);
    assert.equal(await readRememberedKey(request({ user, cookie: `__Host-iconify-openai=${second}` }), environment, now), otherKey);
  }
  const forgedOrigin = new Request("https://other.example/api/connection", {
    headers: { host: "iconify.example", "x-forwarded-host": "iconify.example", "oai-authenticated-user-id": "spoofed-user-one" },
  });
  assert.equal(await openRememberedKey(forgedOrigin, first, environment, now), undefined);
});

test("tampering, malformed envelopes, oversized content, and invalid versions never expose a key", async () => {
  const sealed = await sealRememberedKey(request(), apiKey, environment, now);
  const [version, iv, ciphertext] = sealed.split(".");
  const flip = (value: string) => `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
  for (const invalid of ["", apiKey, `v2.${iv}.${ciphertext}`, `${version}.${flip(iv)}.${ciphertext}`, `${version}.${iv}.${flip(ciphertext)}`, `${sealed}.extra`, "v1.invalid.$$$", `v1.${iv}.${"A".repeat(3000)}`]) {
    assert.equal(await openRememberedKey(request(), invalid, environment, now), undefined);
  }
});

test("saved keys expire after 30 days even when the browser sends an old cookie", async () => {
  const sealed = await sealRememberedKey(request(), apiKey, environment, now);
  const expiry = now + REMEMBERED_KEY_MAX_AGE * 1000;
  assert.equal(await openRememberedKey(request(), sealed, environment, expiry - 1), apiKey);
  assert.equal(await openRememberedKey(request(), sealed, environment, expiry), undefined);
  assert.equal(await openRememberedKey(request(), sealed, environment, now - 60_001), undefined);
});

test("secure anonymous persistence requires a valid 256-bit secret and HTTPS", async () => {
  assert.equal(canRememberKey(request(), environment), true);
  for (const encryptionSecret of [undefined, "", "short", Buffer.alloc(16).toString("base64"), Buffer.alloc(64).toString("base64"), "!".repeat(44)]) {
    assert.equal(canRememberKey(request(), { encryptionSecret }), false);
    await assert.rejects(sealRememberedKey(request(), apiKey, { encryptionSecret }, now), /unavailable/);
  }
  assert.equal(canRememberKey(request({ origin: "http://iconify.example" }), environment), false);
  assert.equal(canRememberKey(request({ user: "" }), environment), true);
  assert.equal(canRememberKey(request({ origin: "https://localhost", user: "" }), environment), true);
  await assert.rejects(sealRememberedKey(request(), "short", environment, now), /unavailable/);
});

test("development fallback is explicitly enabled and limited to loopback hosts", async () => {
  const development = { ...environment, allowLocalDevelopment: true };
  for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"]) {
    const req = request({ origin, user: "" });
    assert.equal(canRememberKey(req, environment), false);
    assert.equal(canRememberKey(req, development), true);
    const sealed = await sealRememberedKey(req, apiKey, development, now);
    assert.equal(await openRememberedKey(req, sealed, development, now), apiKey);
    assert.match(rememberedKeyCookie(req, sealed, development), /^iconify-openai-dev=/);
    assert.match(forgottenKeyCookie(req, development), /^iconify-openai-dev=;/);
  }
  for (const origin of ["http://192.168.1.2:5173", "http://localhost.example"]) {
    assert.equal(canRememberKey(request({ origin, user: "" }), development), false);
  }
});

test("production cookie is host-only, HttpOnly, Secure, strict same-site, expiring, and removable", async () => {
  const req = request();
  const sealed = await sealRememberedKey(req, apiKey, environment, now);
  const cookie = rememberedKeyCookie(req, sealed, environment);
  assert.match(cookie, /^__Host-iconify-openai=v1\./);
  for (const flag of ["Path=/", `Max-Age=${REMEMBERED_KEY_MAX_AGE}`, "HttpOnly", "SameSite=Strict", "Secure"]) assert.ok(cookie.includes(flag));
  assert.equal(cookie.includes("Domain="), false);
  assert.equal(cookie.includes(apiKey), false);
  assert.equal(await readRememberedKey(request({ cookie: cookie.split(";")[0] }), environment, now), apiKey);
  assert.equal(await readRememberedKey(request({ cookie: `unrelated=one; ${cookie.split(";")[0]}; ignored=two` }), environment, now), apiKey);
  assert.equal(await readRememberedKey(request({ cookie: `${cookie.split(";")[0]}; ${cookie.split(";")[0]}` }), environment, now), undefined);
  const deletion = forgottenKeyCookie(req, environment);
  assert.match(deletion, /^__Host-iconify-openai=;/);
  for (const flag of ["Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict", "Secure"]) assert.ok(deletion.includes(flag));
  assert.equal(await readRememberedKey(request({ cookie: deletion.split(";")[0] }), environment, now), undefined);
});

test("only explicit or remembered visitor keys are used", () => {
  assert.equal(resolveApiKey("explicit", "remembered"), "explicit");
  assert.equal(resolveApiKey(undefined, "remembered"), "remembered");
  assert.equal(resolveApiKey(undefined, undefined), undefined);
  const extraArgument = resolveApiKey as (...args: (string | undefined)[]) => string | undefined;
  assert.equal(extraArgument(undefined, undefined, "injected-server-key"), undefined);
});

test("status reports capability and connection without returning stored keys, ciphertext, or encryption secrets", async () => {
  const sealed = await sealRememberedKey(request(), apiKey, environment);
  const configured = { ...environment, defaultModel: "gpt-test", apiKey: "server-credential-never-returned" };
  const status = await getConnectionStatus(request({ cookie: `__Host-iconify-openai=${sealed}` }), configured);
  assert.deepEqual(status, { configured: true, serverConfigured: false, keySaved: true, rememberAvailable: true, provider: "openai", defaultModel: "gpt-test" });
  const response = JSON.stringify(status);
  for (const secret of [apiKey, sealed, configured.apiKey, environment.encryptionSecret]) assert.equal(response.includes(secret), false);
  const savedOnly = await getConnectionStatus(request({ cookie: `__Host-iconify-openai=${sealed}` }), { ...environment, defaultModel: "gpt-test" });
  assert.equal(savedOnly.configured, true);
  assert.equal(savedOnly.serverConfigured, false);
  const copied = await getConnectionStatus(request({ origin: "https://other.example", user: "user-two", cookie: `__Host-iconify-openai=${sealed}` }), { ...environment, defaultModel: "gpt-test" });
  assert.equal(copied.configured, false);
  assert.equal(copied.keySaved, false);
  const absent = await getConnectionStatus(request(), configured);
  assert.equal(absent.configured, false);
  assert.equal(absent.rememberAvailable, true);
  assert.equal(absent.serverConfigured, false);
  assert.equal((await getConnectionStatus(request(), { defaultModel: "gpt-test" })).rememberAvailable, false);
});
