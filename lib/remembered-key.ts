/** Server-only credential sealing. Never import this module into a client component. */
export const REMEMBERED_KEY_MAX_AGE = 30 * 24 * 60 * 60;
const COOKIE_NAME = "__Host-iconify-openai";
const LOCAL_COOKIE_NAME = "iconify-openai-dev";
const VERSION = "v1";
const encoder = new TextEncoder();

export type RememberedKeyEnvironment = {
  encryptionSecret?: string;
  allowLocalDevelopment?: boolean;
};

type Binding = { origin: string; local: boolean };

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function bindingFor(request: Request, environment: RememberedKeyEnvironment): Binding | undefined {
  const url = new URL(request.url);
  const local = environment.allowLocalDevelopment === true && isLoopback(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return undefined;
  // This public prototype has no user accounts. The encrypted host-only cookie
  // is the browser's bearer credential; untrusted identity headers are ignored.
  return { origin: url.origin, local };
}

function decodeSecret(value: string | undefined): Uint8Array<ArrayBuffer> | undefined {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return undefined;
  try {
    const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
    return bytes.length === 32 && btoa(String.fromCharCode(...bytes)) === value ? bytes : undefined;
  } catch { return undefined; }
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid sealed credential.");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
  if (toBase64Url(bytes) !== value) throw new Error("Invalid sealed credential.");
  return bytes;
}

function additionalData(binding: Binding): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(["iconify-anonymous-remembered-key", VERSION, binding.origin]));
}

function validApiKey(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{20,512}$/.test(value);
}

export function canRememberKey(request: Request, environment: RememberedKeyEnvironment): boolean {
  return Boolean(decodeSecret(environment.encryptionSecret) && bindingFor(request, environment));
}

/** Fresh random IVs ensure saving the same key twice produces different ciphertext. */
export async function sealRememberedKey(request: Request, apiKey: string, environment: RememberedKeyEnvironment, now = Date.now()): Promise<string> {
  const secret = decodeSecret(environment.encryptionSecret);
  const binding = bindingFor(request, environment);
  if (!secret || !binding || !validApiKey(apiKey) || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("Secure key storage is unavailable.");
  }
  const key = await crypto.subtle.importKey("raw", secret, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = encoder.encode(JSON.stringify({ key: apiKey, issuedAt: now, expiresAt: now + REMEMBERED_KEY_MAX_AGE * 1000 }));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(binding) }, key, payload);
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

/** Invalid, expired, rotated, or cross-origin cookies never fall back to unsealed content. */
export async function openRememberedKey(request: Request, sealed: string, environment: RememberedKeyEnvironment, now = Date.now()): Promise<string | undefined> {
  try {
    const secret = decodeSecret(environment.encryptionSecret);
    const binding = bindingFor(request, environment);
    if (!secret || !binding || typeof sealed !== "string" || sealed.length > 2048 || !Number.isSafeInteger(now) || now < 0) return undefined;
    const [version, encodedIv, ciphertext, extra] = sealed.split(".");
    if (version !== VERSION || !encodedIv || !ciphertext || extra !== undefined) return undefined;
    const iv = fromBase64Url(encodedIv);
    const encrypted = fromBase64Url(ciphertext);
    if (iv.length !== 12 || encrypted.length < 16 || encrypted.length > 1024) return undefined;
    const key = await crypto.subtle.importKey("raw", secret, { name: "AES-GCM" }, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: additionalData(binding) }, key, encrypted);
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    const { key: apiKey, issuedAt, expiresAt } = payload as Record<string, unknown>;
    if (!validApiKey(apiKey) || typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || issuedAt < 0 || issuedAt > now + 60_000 ||
        typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt !== issuedAt + REMEMBERED_KEY_MAX_AGE * 1000 || expiresAt <= now) return undefined;
    return apiKey;
  } catch {
    // Authentication errors must not reveal cookie contents or cryptographic details.
    return undefined;
  }
}

function cookieName(request: Request, environment: RememberedKeyEnvironment): string {
  const url = new URL(request.url);
  return environment.allowLocalDevelopment === true && isLoopback(url.hostname) && url.protocol === "http:" ? LOCAL_COOKIE_NAME : COOKIE_NAME;
}

export async function readRememberedKey(request: Request, environment: RememberedKeyEnvironment, now = Date.now()): Promise<string | undefined> {
  const name = cookieName(request, environment);
  const matches = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  // Duplicate cookie names are ambiguous and are rejected instead of choosing one.
  if (matches.length !== 1) return undefined;
  return openRememberedKey(request, matches[0].slice(name.length + 1), environment, now);
}

export function rememberedKeyCookie(request: Request, sealed: string, environment: RememberedKeyEnvironment): string {
  if (!canRememberKey(request, environment) || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(sealed) || sealed.length > 2048) {
    throw new Error("Secure key storage is unavailable.");
  }
  const name = cookieName(request, environment);
  return `${name}=${sealed}; Path=/; Max-Age=${REMEMBERED_KEY_MAX_AGE}; HttpOnly; SameSite=Strict${name === COOKIE_NAME ? "; Secure" : ""}`;
}

export function forgottenKeyCookie(request: Request, environment: RememberedKeyEnvironment): string {
  const name = cookieName(request, environment);
  return `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict${name === COOKIE_NAME ? "; Secure" : ""}`;
}

export function resolveApiKey(explicit: string | undefined, remembered: string | undefined): string | undefined {
  return explicit || remembered || undefined;
}

export async function getConnectionStatus(request: Request, environment: RememberedKeyEnvironment & { defaultModel: string }) {
  const keySaved = Boolean(await readRememberedKey(request, environment));
  return {
    configured: keySaved,
    serverConfigured: false,
    keySaved,
    rememberAvailable: canRememberKey(request, environment),
    provider: "openai" as const,
    defaultModel: environment.defaultModel,
  };
}
