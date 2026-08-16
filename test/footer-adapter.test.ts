import { describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FooterService } from "../extensions/ui/footer/index.js";

describe("footer adapter", () => {
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
    expect(renderedWithCache[1]).not.toContain("↑400");
    expect(renderedWithCache[3]).toContain("↑400 ↓10 CH61.7% | $0.911");
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
