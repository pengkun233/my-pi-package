import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildFooterContent, renderSegment, renderSegments } from "../extensions/ui/footer/layout.js";
import { DEFAULT_CONTEXT_BAR_CONFIG, DEFAULT_FOOTER_CONFIG, normalizeConfig, normalizeSegments } from "../extensions/ui/footer/config.js";

const theme = { fg: (_token: string, text: string) => text } as any;
const stripAnsi = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const context = { theme, cwd: "/tmp/work", inputTokens: 0, outputTokens: 0, cost: 0 } as any;

describe("footer layout", () => {
  it("removes legacy mode segments and dangling separators", () => {
    expect(normalizeSegments(["thinking", "separator", "chat", "separator", "plan", "separator", "caveman"]))
      .toEqual(["thinking"]);
    expect(renderSegments(["model", "separator", "git"], context).join(" ")).not.toContain("|");
  });

  it("removes leading, trailing and consecutive visible separators", () => {
    expect(renderSegments(["separator", "pi", "separator", "separator", "path", "separator"], context))
      .toEqual(["π", "|", "work"]);
  });

  it("uses the requested two-row layout", () => {
    expect(DEFAULT_FOOTER_CONFIG).toEqual({
      row1Left: ["pi", "separator", "model", "separator", "thinking"],
      row1Right: ["mcp", "separator", "memory"],
      row2Left: ["path", "separator", "session"],
      row2Right: ["tokens", "separator", "cost", "separator", "context"],
      contextBar: DEFAULT_CONTEXT_BAR_CONFIG,
    });
  });

  it("drops chat and plan from machine-local configurations", () => {
    const config = normalizeConfig({
      row1Left: ["chat", "separator", "plan", "separator", "model"],
      row1Right: [],
      row2Left: ["path"],
      row2Right: [],
    });
    expect(config.row1Left).toEqual(["model"]);
  });

  it("normalizes context bar configuration to safe bounds", () => {
    const config = normalizeConfig({ contextBar: { barWidth: 200, gradientMidPoint: -1, mode: "text", responsive: false } });
    expect(config.contextBar).toMatchObject({ barWidth: 32, gradientMidPoint: 0, mode: "text", responsive: false });
  });

  it("renders uppercase thinking levels with level-specific theme colors", () => {
    const calls: string[] = [];
    const colored = {
      ...context,
      theme: { fg: (token: string, text: string) => { calls.push(token); return text; } },
      thinkingLevel: "high",
    } as any;
    expect(renderSegment("thinking", colored)).toBe("HIGH");
    expect(calls).toEqual(["thinkingHigh"]);
  });

  it("renders only cache hit rate alongside input and output tokens", () => {
    expect(renderSegment("tokens", {
      ...context,
      inputTokens: 123_456,
      outputTokens: 6_789,
      cacheHitRate: 61.666,
    })).toBe("↑123.5K ↓6.8K CH61.7%");
    expect(renderSegment("tokens", {
      ...context,
      inputTokens: 123_456,
      outputTokens: 6_789,
    })).toBe("↑123.5K ↓6.8K");
  });

  it("renders session, MCP and memory status", () => {
    const output = renderSegments(["session", "separator", "mcp", "separator", "memory"], {
      ...context,
      sessionName: "footer-layout",
      mcpConnected: 2,
      mcpConfigured: 3,
      memoryTopics: 4,
    }).join(" ");
    expect(output).toBe("Session: footer-layout | MCP: 2/3 | Memory: 4");
  });

  it("shows a context bar with current usage, limit and percentage", () => {
    const output = renderSegments(["context"], {
      ...context,
      contextTokens: 123_456,
      contextWindow: 200_000,
      contextPercent: 61.7,
      terminalWidth: 120,
    }).join(" ");
    expect(stripAnsi(output)).toBe(`${"▋".repeat(18)} 123.5k / 200k · 61.7%`);
  });

  it("uses a compact percentage label on narrow terminals", () => {
    const output = renderSegment("context", {
      ...context,
      contextTokens: 123_456,
      contextWindow: 200_000,
      contextPercent: 61.7,
      terminalWidth: 50,
    });
    expect(stripAnsi(output ?? "")).toBe("61.7% ctx");
  });

  it("never exceeds terminal width", () => {
    const crowded = {
      ...context,
      model: { id: "very-long-model-name", name: "very-long-model-name" },
      thinkingLevel: "xhigh",
      sessionName: "a-long-session-name",
      mcpConnected: 2,
      mcpConfigured: 3,
      memoryTopics: 4,
      inputTokens: 12_345,
      outputTokens: 6_789,
      cacheHitRate: 61.7,
      cost: 1.234,
      contextTokens: 123_456,
      contextWindow: 200_000,
      contextPercent: 61.7,
    } as any;
    for (const width of [0, 1, 2, 8, 20, 40, 80]) {
      crowded.terminalWidth = width;
      const row1 = buildFooterContent(crowded, DEFAULT_FOOTER_CONFIG.row1Left, DEFAULT_FOOTER_CONFIG.row1Right, width);
      const row2 = buildFooterContent(crowded, DEFAULT_FOOTER_CONFIG.row2Left, DEFAULT_FOOTER_CONFIG.row2Right, width);
      expect(visibleWidth(row1)).toBeLessThanOrEqual(width);
      expect(visibleWidth(row2)).toBeLessThanOrEqual(width);
    }
  });
});
