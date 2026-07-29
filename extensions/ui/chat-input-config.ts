// Adapted from adrianapan/pikit's MIT-licensed chat-input extension.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CompanionConfig {
  enabled: boolean;
  color: string;
}

export interface ChatInputConfig {
  boxedView: boolean;
  boxPadX: number;
  menuGap: number;
  extraMenuIndent: number;
  borderColor: string;
  prefix: string;
  prefixColor: string;
  companion: CompanionConfig;
  companionTopPadding: number;
}

export interface ChatInputUserConfig {
  boxedView?: boolean;
  boxPadX?: number;
  menuGap?: number;
  extraMenuIndent?: number;
  borderColor?: string;
  prefix?: string;
  prefixColor?: string;
  companion?: {
    enabled?: boolean;
    color?: string;
  };
}

export const DEFAULT_CHAT_INPUT_CONFIG: Readonly<ChatInputConfig> = Object.freeze({
  boxedView: true,
  boxPadX: 1,
  menuGap: 0,
  extraMenuIndent: 1,
  borderColor: "borderAccent",
  prefix: "❯",
  prefixColor: "accent",
  companion: Object.freeze({ enabled: true, color: "accent" }),
  companionTopPadding: 3,
});

export const CHAT_INPUT_CONFIG_PATH = join(homedir(), ".pi", "agent", "configs", "chat-input.json");

export function mergeChatInputConfig(user: ChatInputUserConfig = {}): ChatInputConfig {
  return {
    boxedView: user.boxedView ?? DEFAULT_CHAT_INPUT_CONFIG.boxedView,
    boxPadX: user.boxPadX ?? DEFAULT_CHAT_INPUT_CONFIG.boxPadX,
    menuGap: user.menuGap ?? DEFAULT_CHAT_INPUT_CONFIG.menuGap,
    extraMenuIndent: user.extraMenuIndent ?? DEFAULT_CHAT_INPUT_CONFIG.extraMenuIndent,
    borderColor: user.borderColor ?? DEFAULT_CHAT_INPUT_CONFIG.borderColor,
    prefix: user.prefix ?? DEFAULT_CHAT_INPUT_CONFIG.prefix,
    prefixColor: user.prefixColor ?? DEFAULT_CHAT_INPUT_CONFIG.prefixColor,
    companion: {
      enabled: user.companion?.enabled ?? DEFAULT_CHAT_INPUT_CONFIG.companion.enabled,
      color: user.companion?.color ?? DEFAULT_CHAT_INPUT_CONFIG.companion.color,
    },
    companionTopPadding: DEFAULT_CHAT_INPUT_CONFIG.companionTopPadding,
  };
}

export function loadChatInputConfig(path = CHAT_INPUT_CONFIG_PATH): ChatInputConfig {
  try {
    return mergeChatInputConfig(JSON.parse(readFileSync(path, "utf8")) as ChatInputUserConfig);
  } catch {
    return mergeChatInputConfig();
  }
}

export const CHAT_INPUT_CONFIG: Readonly<ChatInputConfig> = loadChatInputConfig();

export const COMPANION_PADDING = 3;
export const MIN_WIDTH_FOR_COMPANION = 40;

// Animation timing (milliseconds).
export const DIP_INTERVAL_MS = 4000;
export const RISE_INTERVAL_MS = 8000;
export const EARS_MIN_DURATION_MS = 2000;
export const EARS_MAX_DURATION_MS = 4000;
export const FULL_MIN_DURATION_MS = 3000;
export const FULL_MAX_DURATION_MS = 23000;
export const NONE_MIN_DURATION_MS = 800;
export const NONE_MAX_DURATION_MS = 2000;
export const FACE_MIN_DURATION_MS = 6000;
export const FACE_MAX_DURATION_MS = 36000;
export const EXPR_MIN_DURATION_MS = 2000;
export const EXPR_MAX_DURATION_MS = 5500;
export const STARE_MIN_DURATION_MS = 8000;
export const STARE_MAX_DURATION_MS = 13000;
export const STARE_CHANCE = 0.15;
export const BLINK_MIN_DURATION_MS = 80;
export const BLINK_MAX_DURATION_MS = 330;
export const EXPR_BLINK_CHANCE = 0.5;
export const EXPR_DOUBLE_BLINK_CHANCE = 0;
export const DOUBLE_BLINK_GAP_MIN_MS = 80;
export const DOUBLE_BLINK_GAP_MAX_MS = 160;
export const WOBBLE_RANGE = 12;
export const WOBBLE_MIN_INTERVAL_MS = 200;
export const WOBBLE_MAX_INTERVAL_MS = 600;
export const DIR_STEPS_MIN = 2;
export const DIR_STEPS_MAX = 5;
export const EDGE_BIAS_STRENGTH = 0.45;
export const EDGE_PAUSE_MIN_MS = 300;
export const EDGE_PAUSE_MAX_MS = 800;
export const FACE_DRIFT_RANGE = 3;
export const FACE_DRIFT_MIN_INTERVAL_MS = 4000;
export const FACE_DRIFT_MAX_INTERVAL_MS = 10000;
export const EARS_TO_NONE_CHANCE = 0.15;
export const EARS_TO_FULL_CHANCE = 0.425;
export const FULL_TO_EARS_CHANCE = 0.15;
export const FULL_TO_NONE_CHANCE = 0.1;
export const SLOW_TRANSITION_CHANCE = 0.2;
export const SLOW_TRANSITION_MULT_MIN = 2;
export const SLOW_TRANSITION_MULT_MAX = 3;

export const BLINK_ART: [string, string, string] = [" /\\_/\\ ", "( -.- )", " |   | "];

export const COMPANION_ARTS: [string, string, string][] = [
  [" /\\_/\\ ", "( ⌒.⌒ )", " |   | "],
  [" /\\_/\\ ", "( o.o )", " |   | "],
  [" /\\_/\\ ", "( ^.^ )", " |   | "],
  [" /\\_/\\ ", "( O.O )", " |   | "],
  [" /\\_/\\ ", "( o.- )", " |   | "],
  [" /\\_/\\ ", "( >.< )", " |   | "],
  [" /\\_/\\ ", "( o.O )", " |   | "],
  [" /\\_/\\ ", "( *.* )", " |   | "],
  [" /\\_/\\ ", "( ᴗ.ᴗ )", " |   | "],
  [" /\\_/\\ ", "( ω.ω )", " |   | "],
];
