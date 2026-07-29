import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CHAT_INPUT_CONFIG, type ChatInputConfig } from "../extensions/ui/chat-input-config.js";
import {
  renderChatInputLines,
  selectInputStyle,
  type BoxColors,
} from "../extensions/ui/chat-input-utils.js";

const identity = (text: string) => text;
const colors: BoxColors = { border: identity, accent: identity };

function config(overrides: Partial<ChatInputConfig> = {}): ChatInputConfig {
  return {
    ...DEFAULT_CHAT_INPUT_CONFIG,
    ...overrides,
    companion: {
      ...DEFAULT_CHAT_INPUT_CONFIG.companion,
      ...overrides.companion,
    },
  };
}

describe("chat input rendering", () => {
  it("renders the upstream boxed layout and places completion rows directly below it", () => {
    const lines = renderChatInputLines(
      ["──────────────", "hello", "──────────────", "command item"],
      20,
      "❯",
      colors,
      config(),
    );

    expect(lines).toEqual([
      "┌──────────────────┐",
      "│ ❯ hello          │",
      "└──────────────────┘",
      " command item       ",
    ]);
  });

  it("renders unboxed horizontal rules, configured spacing, and a Unicode prefix", () => {
    const lines = renderChatInputLines(
      ["─────────────────", "你好", "─────────────────", "/plan"],
      20,
      "猫",
      colors,
      config({ boxedView: false, boxPadX: 2, menuGap: 1, extraMenuIndent: 3 }),
    );

    expect(lines[0]).toBe("────────────────────");
    expect(lines[1]).toContain("  猫  你好");
    expect(lines.some((line) => line.includes("│"))).toBe(false);
    expect(lines.at(-2)).toBe("");
    expect(lines.at(-1)).toBe("   /plan            ");
    expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
  });

  it("preserves both scroll indicators and falls back to stock rendering when narrow", () => {
    const stock = ["── ↑ 2 more", "hello", "── ↓ 3 more"];
    const rendered = renderChatInputLines(stock, 20, "❯", colors, config());

    expect(rendered[0]).toBe("┌── ↑ 2 more ──────┐");
    expect(rendered.at(-1)).toBe("└── ↓ 3 more ──────┘");
    expect(renderChatInputLines(stock, 8, "❯", colors, config())).toBe(stock);
  });

  it("selects only normal and bash input appearances", () => {
    const styles = {
      normal: { border: (text: string) => `normal:${text}`, accent: identity },
      bash: { border: (text: string) => `bash:${text}`, accent: identity },
    };
    const cfg = config({ prefix: "N" });

    expect(selectInputStyle(cfg, styles, true)).toEqual({ colors: styles.bash, prefix: "N" });
    expect(selectInputStyle(cfg, styles, false)).toEqual({ colors: styles.normal, prefix: "N" });
  });
});
