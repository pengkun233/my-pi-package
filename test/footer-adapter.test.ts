import { describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FooterService } from "../extensions/ui/footer/index.js";
import * as footerConfig from "../extensions/ui/footer/config.js";
import { buildFooterContent, buildFooterStatusRows } from "../extensions/ui/footer/layout.js";

describe("footer adapter", () => {
  it("switches the same component at 39/40/79/80 columns without leaking wide-only data", () => {
    const configSpy = vi.spyOn(footerConfig, "loadFooterConfig").mockReturnValue(footerConfig.DEFAULT_FOOTER_CONFIG);
    let factory: any;
    let contextUsage: any = { tokens: 32_100, contextWindow: 128_000, percent: 25.1 };
    const theme = { fg: (_token: string, text: string) => text } as any;
    const statuses = new Map([
      ["memory", "Memory 4"],
      ["mcp", "MCP ready"],
      ["long", "an extension status that is deliberately long enough to wrap onto additional rows"],
    ]);
    const ctx: any = {
      cwd: "/definitely/not/a/repository",
      model: { provider: "provider-id", id: "original-id", name: "Model Name", contextWindow: 128_000 },
      modelRegistry: { getProviderDisplayName: () => "Provider Display" },
      thinkingLevel: "high",
      ui: { setFooter: (value: unknown) => { factory = value; } },
      sessionManager: {
        getBranch: () => [{ type: "message", message: { role: "assistant", usage: {
          input: 100, output: 2, cost: { total: 1.234 },
        } } }],
        getSessionName: () => "Secret Session",
      },
      getContextUsage: () => contextUsage,
    };
    const service = new FooterService(ctx, () => true);
    service.install();
    const component = factory({ requestRender: vi.fn() }, theme, {
      getGitBranch: () => "test-branch",
      getExtensionStatuses: () => statuses,
      onBranchChange: () => vi.fn(),
    });
    const expectedWide = (width: number) => {
      const config = footerConfig.loadFooterConfig();
      const layout: any = {
        theme, model: ctx.model, providerDisplayName: "Provider Display", cwd: ctx.cwd,
        thinkingLevel: "high", inputTokens: 100, outputTokens: 2, cost: 1.234,
        contextTokens: 32_100, contextWindow: 128_000, contextPercent: 25.1,
        terminalWidth: width, contextBar: config.contextBar, sessionName: "Secret Session",
      };
      return [buildFooterContent(layout, config.row1Left, config.row1Right, width), "─".repeat(width),
        ...buildFooterStatusRows(layout, config.row2Left,
          [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text),
          width, config.row2Right)];
    };
    try {
      for (const width of [80, 79, 40, 39, 1, 2, 12, 80, 120, 39]) {
        const rows = component.render(width);
        expect(rows.every((line: string) => visibleWidth(line) <= width)).toBe(true);
        if (width >= 80) {
          expect(rows).toEqual(expectedWide(width));
          expect(rows.join("\n")).toContain("Provider Display / Model Name");
          expect(rows.join("\n")).toContain("↑100 ↓2 | $1.234");
          expect(rows.join("\n")).toContain("Session: Secret Session");
          expect(rows.join("\n")).toContain("Memory 4");
        } else {
          expect(rows).toHaveLength(1);
          expect(rows[0]).not.toMatch(/[\r\n]|─|π|Provider|repository|Session|Secret|MCP|Memory|extension|↑|↓|\$/);
          if (width >= 39) expect(rows[0]).toBe(`Model Name ${width < 40 ? "H" : "HIGH"} ctx 32.1k 25.1%`);
        }
      }
      expect(component.render(0)).toEqual([]);
      contextUsage = undefined;
      expect(component.render(40)).toEqual(["Model Name HIGH ctx ?"]);
      contextUsage = { tokens: null, contextWindow: 128_000, percent: null };
      expect(component.render(39)).toEqual(["Model Name H ctx ?"]);
      // Machine-local wide-row and context-bar overrides cannot expose extra fields on narrow screens.
      configSpy.mockReturnValue({
        ...footerConfig.DEFAULT_FOOTER_CONFIG,
        row1Left: ["path", "session", "tokens", "cost"],
        contextBar: { ...footerConfig.DEFAULT_CONTEXT_BAR_CONFIG, responsive: false, showPercent: false },
      });
      expect(component.render(79)).toEqual(["Model Name HIGH ctx ?"]);
    } finally {
      component.dispose();
      service.dispose();
      configSpy.mockRestore();
    }
  });

  it("keeps cumulative tokens but uses the latest assistant response for cache hit rate", () => {
    let factory: any;
    const branch: any[] = [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 10, output: 7, cacheRead: 90, cacheWrite: 0, cost: { total: 0.4 } },
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 115, output: 3, cacheRead: 185, cacheWrite: 0, cost: { total: 0.511 } },
        },
      },
    ];
    const ctx: any = {
      cwd: "/definitely/not/a/repository",
      model: undefined,
      thinkingLevel: undefined,
      ui: { setFooter: (value: unknown) => { factory = value; } },
      sessionManager: { getBranch: () => branch, getSessionName: () => undefined },
      getContextUsage: () => undefined,
    };
    const service = new FooterService(ctx, () => true);
    service.install();
    const component = factory(
      { requestRender: vi.fn() },
      { fg: (_token: string, text: string) => text },
      {
        getGitBranch: () => null,
        getExtensionStatuses: () => new Map(),
        onBranchChange: () => vi.fn(),
      },
    );

    const renderedWithCache = component.render(120);
    const withCache = renderedWithCache.join("\n");
    expect(renderedWithCache[0]).not.toContain("↑400");
    expect(renderedWithCache[2]).toContain("↑400 ↓10 CH61.7% | $0.911");
    expect(withCache).not.toMatch(/\b[RW]\d/);

    branch.push({
      type: "message",
      message: {
        role: "assistant",
        usage: { input: 100, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      },
    });
    expect(component.render(120).join("\n")).toContain("↑500 ↓12 CH0.0%");

    branch.splice(0, branch.length, {
      type: "message",
      message: {
        role: "assistant",
        usage: { input: 100, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      },
    });
    const withoutCache = component.render(120).join("\n");
    expect(withoutCache).toContain("↑100 ↓2");
    expect(withoutCache).not.toContain("CH");

    component.dispose();
    service.dispose();
  });

  it("installs only through setFooter and disposes branch/git observation", () => {
    let factory: any;
    const setFooter = vi.fn((value) => { factory = value; });
    const ctx: any = {
      cwd: "/definitely/not/a/repository",
      model: undefined,
      thinkingLevel: undefined,
      ui: { setFooter },
      sessionManager: { getBranch: () => [], getSessionName: () => "work" },
      getContextUsage: () => ({ tokens: 32_100, contextWindow: 128_000, percent: 25.1 }),
    };
    const service = new FooterService(ctx, () => true);
    service.install();
    expect(setFooter).toHaveBeenCalledOnce();
    expect(factory).toBeTypeOf("function");

    const unsubscribe = vi.fn();
    const statuses = new Map([
      ["mcp", "MCP: 3 servers enabled (2 connected)"],
      ["memory", "memory: 4"],
      ["plannotator", "\x1b[33m📋 2/5\x1b[0m"],
    ]);
    const component = factory(
      { requestRender: vi.fn() },
      { fg: (_token: string, text: string) => text },
      {
        getGitBranch: () => null,
        getExtensionStatuses: () => statuses,
        onBranchChange: () => unsubscribe,
      },
    );
    const stripAnsi = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const rendered = component.render(80);
    const renderedText = stripAnsi(rendered.join("\n"));
    expect(rendered.every((line: string) => visibleWidth(line) <= 80)).toBe(true);
    expect(renderedText).toContain("repository | Session: work | MCP: 3 servers enabled (2 connected)");
    expect(renderedText).toContain("memory: 4");
    expect(renderedText).toContain("📋 2/5");
    expect(renderedText).toContain("32.1k / 128k · 25.1%");
    expect(renderedText.indexOf("MCP:")).toBeLessThan(renderedText.indexOf("memory:"));
    expect(renderedText.indexOf("memory:")).toBeLessThan(renderedText.indexOf("📋"));
    component.dispose();
    service.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
