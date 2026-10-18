/** API credentials must never be treated as a model name or saved with it. */
export function isApiKeyLike(value: unknown): boolean {
  return typeof value === "string" && /^(?:bearer\s+)?sk-/i.test(value.trim());
}

function validModel(value: unknown): string {
  if (typeof value !== "string" || isApiKeyLike(value)) return "";
  const model = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(model) ? model : "";
}

/** Restore a safe selection without ever returning an invalid fallback value. */
export function normalizeModelSelection(value: unknown, fallback = ""): string {
  return validModel(value) || validModel(fallback);
}
