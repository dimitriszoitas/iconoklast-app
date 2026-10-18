import { DEFAULT_AI_MODEL, isValidModel } from "./ai.ts";

/** Server configuration for the public, bring-your-own-key deployment. */
export function getAIEnvironment(): { defaultModel: string; encryptionSecret?: string; allowLocalDevelopment: boolean } {
  const configuredModel = process.env.OPENAI_MODEL || "";
  return {
    // Deliberately never read OPENAI_API_KEY: visitors must use their own key.
    defaultModel: isValidModel(configuredModel) ? configuredModel : DEFAULT_AI_MODEL,
    encryptionSecret: process.env.ICONIFY_KEY_ENCRYPTION_SECRET || undefined,
    allowLocalDevelopment: process.env.NODE_ENV === "development",
  };
}
