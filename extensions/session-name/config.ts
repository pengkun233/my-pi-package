import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export interface NamingConfig {
  provider: string;
  model: string;
  reasoning: ModelThinkingLevel;
}

export const DEFAULT_NAMING_CONFIG: NamingConfig = {
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  reasoning: "low",
};

/** Read on each generation so edits take effect without reloading the extension. */
export async function loadNamingConfig(path = join(getAgentDir(), "session-name.json")): Promise<NamingConfig> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_NAMING_CONFIG };
    throw new Error("Cannot read session-name.json");
  }
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("Invalid JSON in session-name.json"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("session-name.json must be an object");
  }
  const config = { ...DEFAULT_NAMING_CONFIG };
  for (const [key, field] of Object.entries(value)) {
    if (key === "provider" || key === "model") {
      if (typeof field !== "string" || !field.trim()) throw new Error(`Invalid ${key} in session-name.json`);
      config[key] = field.trim();
    } else if (key === "reasoning") {
      if (typeof field !== "string" || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(field)) {
        throw new Error("Invalid reasoning in session-name.json");
      }
      config.reasoning = field as ModelThinkingLevel;
    } else {
      throw new Error("Unknown setting in session-name.json");
    }
  }
  return config;
}
