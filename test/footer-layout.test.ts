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
const rgbTheme = (colors: Record<string, string>) => ({
  fg: (token: string, text: string) => {
    const hex = colors[token];
    if (!hex) return text;
    const [r, g, b] = hex.match(/[0-9a-f]{2}/gi)!.map((channel) => Number.parseInt(channel, 16));
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
  },
}) as any;
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
      row1Right: ["context"],
      row2Left: ["path", "separator", "session"],
      row2Right: ["tokens", "separator", "cost"],
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

  it("preserves usage placement from legacy machine-local configurations", () => {
    const config = normalizeConfig({
      row1Right: ["tokens", "separator", "cost", "separator", "context"],
    });
    expect(config.row1Right).toEqual(["tokens", "separator", "cost", "separator", "context"]);
    expect(config.row2Right).toEqual([]);
  });

  it("normalizes context bar configuration to safe bounds", () => {
    const config = normalizeConfig({ contextBar: { barWidth: 200, gradientMidPoint: -1, mode: "text", responsive: false } });
    expect(config.contextBar).toMatchObject({ barWidth: 32, gradientMidPoint: 0, mode: "text", responsive: false });
  });

  it("derives the default context bar from active theme tokens", () => {
    expect(DEFAULT_CONTEXT_BAR_CONFIG).toMatchObject({
      unfilledColor: "borderMuted",
      gradientStart: "borderAccent",
      gradientMid: "accent",
      gradientEnd: "dim",
    });
    const base = {
      ...context,
      contextPercent: 50,
      terminalWidth: 120,
    };
    const dracula = renderSegment("context", {
      ...base,
      theme: rgbTheme({ borderAccent: "#bd93f9", accent: "#bd93f9", dim: "#6272a4", borderMuted: "#44475a", muted: "#9ca3c4" }),
    });
    const ayu = renderSegment("context", {
      ...base,
      theme: rgbTheme({ borderAccent: "#e6b450", accent: "#e6b450", dim: "#515868", borderMuted: "#253340", muted: "#707a8c" }),
    });
    expect(dracula).toContain("\x1b[38;2;189;147;249m");
    expect(ayu).toContain("\x1b[38;2;230;180;80m");
    expect(dracula).not.toBe(ayu);
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

  it("anchors token and cost usage at the far right of the second row", () => {
    const rows = buildFooterStatusRows({
      ...context,
      inputTokens: 187_000,
      outputTokens: 4_200,
      cacheHitRate: 71.7,
      cost: 0.911,
    }, DEFAULT_FOOTER_CONFIG.row2Left, ["MCP ready"], 80, DEFAULT_FOOTER_CONFIG.row2Right);
    const firstRow = stripAnsi(rows[0]!);
    expect(firstRow.trimEnd()).toMatch(/↑187K ↓4\.2K CH71\.7% \| \$0\.911$/);
    expect(firstRow.indexOf("↑187K")).toBe(80 - 1 - "↑187K ↓4.2K CH71.7% | $0.911".length);
  });

  it("keeps the right-side usage summary fixed while statuses wrap", () => {
    const rows = buildFooterStatusRows({
      ...context,
      inputTokens: 187_000,
      outputTokens: 4_200,
      cacheHitRate: 71.7,
      cost: 0.911,
    }, DEFAULT_FOOTER_CONFIG.row2Left, ["MCP status that must wrap below the fixed summary"], 52, DEFAULT_FOOTER_CONFIG.row2Right);
    expect(stripAnsi(rows[0]!)).toContain("↑187K ↓4.2K CH71.7% | $0.911");
    expect(stripAnsi(rows.slice(1).join(" "))).toContain("MCP status");
    expect(rows.every((line) => visibleWidth(line) <= 52)).toBe(true);
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
      const statusRows = buildFooterStatusRows(
        crowded,
        DEFAULT_FOOTER_CONFIG.row2Left,
        ["plugin one", "plugin two"],
        width,
        DEFAULT_FOOTER_CONFIG.row2Right,
      );
      expect(visibleWidth(row1)).toBeLessThanOrEqual(width);
      expect(statusRows.every((row) => visibleWidth(row) <= width)).toBe(true);
    }
  });
});
