import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildFooterContent,
  buildFooterStatusRows,
  renderSegment,
  renderSegments,
  sanitizeStatusText,
} from "../extensions/ui/footer/layout.js";
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

  it("uses one fixed row followed by a status row", () => {
    expect(DEFAULT_FOOTER_CONFIG).toEqual({
      row1Left: ["pi", "separator", "model", "separator", "thinking"],
      row1Right: ["tokens", "separator", "cost", "separator", "context"],
      row2Left: ["path", "separator", "session"],
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

  it("renders generic statuses after path and session, wrapping whole statuses", () => {
    const rows = buildFooterStatusRows({
      ...context,
      sessionName: "s",
    }, DEFAULT_FOOTER_CONFIG.row2Left, ["MCP ready", "Memory 4", "Plan 2/5"], 32);
    expect(rows.map((line) => stripAnsi(line).trim())).toEqual([
      "work | Session: s | MCP ready",
      "Memory 4 | Plan 2/5",
    ]);
  });

  it("sanitizes layout-breaking controls while preserving ANSI styling", () => {
    const status = "\x1b[33mReady\n\t now\u0007\x1b[0m";
    expect(sanitizeStatusText(status)).toBe("\x1b[33mReady now\x1b[0m");
    const rows = buildFooterStatusRows(context, [], [status], 12);
    expect(rows.join("")).toContain("\x1b[33m");
    expect(rows.every((line) => visibleWidth(line) <= 12)).toBe(true);
  });

  it("wraps a status that is wider than an entire row without truncating it", () => {
    const rows = buildFooterStatusRows(context, [], ["abcdefghijklmnopqrstuvwxyz"], 12);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((line) => stripAnsi(line).trim()).join("")).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(rows.every((line) => visibleWidth(line) <= 12)).toBe(true);
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
      const statusRows = buildFooterStatusRows(crowded, DEFAULT_FOOTER_CONFIG.row2Left, ["plugin one", "plugin two"], width);
      expect(visibleWidth(row1)).toBeLessThanOrEqual(width);
      expect(statusRows.every((row) => visibleWidth(row) <= width)).toBe(true);
    }
  });
});
