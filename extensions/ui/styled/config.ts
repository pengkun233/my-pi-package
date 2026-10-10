import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Tool layout is intentionally separate from machine-local message overrides.
export const STYLED_CONFIG = {
  horizontalPadding: 1,
  verticalPadding: 0,
  showBackground: true,
} as const;

export interface MessageStyle {
  prefix: string;
  prefixColor: string;
}

export interface StyledMessagesConfig {
  assistantMessage: MessageStyle;
  thinkingMessage: MessageStyle;
  userMessage: MessageStyle & { isThemeBackgroundVisible: boolean };
}

export const DEFAULT_STYLED_MESSAGES_CONFIG = Object.freeze({
  assistantMessage: Object.freeze({ prefix: "●", prefixColor: "text" }),
  thinkingMessage: Object.freeze({ prefix: "✽", prefixColor: "accent" }),
  userMessage: Object.freeze({ prefix: "❯", prefixColor: "accent", isThemeBackgroundVisible: true }),
});

export const STYLED_MESSAGES_CONFIG_PATH = join(
  process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
  "configs", "styled-outputs.json",
);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function messageStyle(value: unknown, fallback: MessageStyle): MessageStyle {
  const fields = object(value);
  // Reject terminal controls and unbounded prefixes. Whitespace-only means off.
  const prefix = typeof fields.prefix === "string" && fields.prefix.length <= 64
    && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(fields.prefix)
    ? fields.prefix.trim() : fallback.prefix;
  // Semantic theme tokens, not ANSI strings. Unknown tokens fall back at render time.
  const prefixColor = typeof fields.prefixColor === "string" && /^[a-zA-Z][a-zA-Z0-9]*$/.test(fields.prefixColor)
    ? fields.prefixColor : fallback.prefixColor;
  return { prefix, prefixColor };
}

export function mergeStyledMessagesConfig(value: unknown = {}): StyledMessagesConfig {
  const fields = object(value);
  const user = object(fields.userMessage);
  return {
    assistantMessage: messageStyle(fields.assistantMessage, DEFAULT_STYLED_MESSAGES_CONFIG.assistantMessage),
    thinkingMessage: messageStyle(fields.thinkingMessage, DEFAULT_STYLED_MESSAGES_CONFIG.thinkingMessage),
    userMessage: {
      ...messageStyle(user, DEFAULT_STYLED_MESSAGES_CONFIG.userMessage),
      isThemeBackgroundVisible: typeof user.isThemeBackgroundVisible === "boolean"
        ? user.isThemeBackgroundVisible : DEFAULT_STYLED_MESSAGES_CONFIG.userMessage.isThemeBackgroundVisible,
    },
  };
}

export function loadStyledMessagesConfig(path = STYLED_MESSAGES_CONFIG_PATH): StyledMessagesConfig {
  try { return mergeStyledMessagesConfig(JSON.parse(readFileSync(path, "utf8"))); }
  catch { return mergeStyledMessagesConfig(); }
}
