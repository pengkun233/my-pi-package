import { describe, expect, it, vi } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import btw, { SideOverlay } from "../extensions/btw/index.js";
import { BTW_SYSTEM, mainSnapshot, SideThread } from "../extensions/btw/thread.js";

const model: any = { provider: "test", id: "main-model" };
const usage: any = { input: 10, output: 5, cacheRead: 3, cacheWrite: 0, totalTokens: 18, cost: { total: 0.01 } };
function answer(text = "side answer") {
  return { role: "assistant", content: [{ type: "text", text }, { type: "toolCall", id: "bad", name: "bash", arguments: {} }], stopReason: "stop", usage, model: "main-model", provider: "test", timestamp: Date.now() } as any;
}
function registry(response = answer()) {
  const streamSimple = vi.fn((_model, _context, _opts) => ({
    async *[Symbol.asyncIterator]() { yield { type: "text_delta", delta: "side answer" }; },
    result: async () => response,
  }));
  return { streamSimple, registry: { getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "secret" })), getProvider: () => ({ streamSimple }) } };
}
const entries: any = [{ id: "u", parentId: null, type: "message", timestamp: new Date().toISOString(), message: { role: "user", content: "main question", timestamp: Date.now() } },
  { id: "a", parentId: "u", type: "message", timestamp: new Date().toISOString(), message: { ...answer("main completed answer"), content: [{ type: "text", text: "main completed answer" }, { type: "thinking", thinking: "private reasoning" }] } }];

describe("isolated side conversation", () => {
  it("snapshots the completed branch and excludes reasoning", () => {
    const snapshot = mainSnapshot(entries, "a");
    expect(snapshot).toContain("main completed answer"); expect(snapshot).not.toContain("private reasoning");
    expect(mainSnapshot(entries, "u")).not.toContain("main completed answer");
  });
  it("includes finalized shell/custom/summary data but not excluded shell executions or UI entries", () => {
    const extra: any[] = [
      { id: "shell", parentId: "a", type: "message", message: { role: "bashExecution", command: "pwd", output: "/project", exitCode: 0, timestamp: Date.now() } },
      { id: "excluded", parentId: "shell", type: "message", message: { role: "bashExecution", command: "private", output: "excluded output", excludeFromContext: true, timestamp: Date.now() } },
      { id: "summary", parentId: "excluded", type: "branch_summary", summary: "retained summary", fromId: "a", timestamp: new Date().toISOString() },
      { id: "ui", parentId: "summary", type: "custom", customType: "task-completion", data: { text: "ui-only metadata" } },
    ];
    const snapshot = mainSnapshot([...entries, ...extra], "ui");
    expect(snapshot).toContain("/project"); expect(snapshot).toContain("retained summary");
    expect(snapshot).not.toContain("excluded output"); expect(snapshot).not.toContain("ui-only metadata");
  });
  it("prefers the modern authenticated registry facade without manually resolving credentials", async () => {
    const { streamSimple } = registry();
    const thread = new SideThread("snapshot", model);
    const getApiKeyAndHeaders = vi.fn();
    await thread.ask("q", { modelRegistry: { streamSimple, getApiKeyAndHeaders } } as any, () => {}, () => {});
    expect(getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(streamSimple.mock.calls[0][1].tools).toEqual([]);
    expect(thread.status).toBe("finished");
  });
  it("uses the current model, brief isolated system, no tools, and retains only side followups", async () => {
    const { streamSimple, registry: modelRegistry } = registry();
    const thread = new SideThread("MAIN SNAPSHOT", model);
    const notify = vi.fn(); const usageCallback = vi.fn();
    await thread.ask("question", { modelRegistry } as any, notify, usageCallback);
    await thread.ask("followup", { modelRegistry } as any, notify, usageCallback);
    const [selected, context] = streamSimple.mock.calls[1];
    expect(selected).toBe(model); expect(context.systemPrompt).toBe(BTW_SYSTEM); expect(context.tools).toEqual([]);
    expect(context.messages[0].content).toContain("MAIN SNAPSHOT"); expect(context.messages).toHaveLength(4);
    expect(thread.messages).toHaveLength(4);
    expect(thread.messages[1].content).toEqual([{ type: "text", text: "side answer" }]);
    expect(thread.usage.requests).toBe(2); expect(thread.usage.totalTokens).toBe(36); expect(usageCallback).toHaveBeenCalledTimes(2);
  });
  it("cancels its own request, rejects stale results and records supplied cancellation usage", async () => {
    let complete!: (result: any) => void;
    const pending = new Promise((resolve) => { complete = resolve; });
    let options: any;
    const ctx: any = { abort: vi.fn(), modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true }), getProvider: () => ({ streamSimple: (_m: any, _c: any, opts: any) => {
        options = opts;
        return { async *[Symbol.asyncIterator]() { await pending; }, result: () => pending };
      } }),
    } };
    const thread = new SideThread("snapshot", model), totals = vi.fn();
    const request = thread.ask("question", ctx, () => {}, totals);
    await Promise.resolve(); thread.cancel();
    expect(options.signal.aborted).toBe(true); expect(ctx.abort).not.toHaveBeenCalled();
    complete(answer("late")); await request;
    expect(thread.messages).toHaveLength(1); expect(thread.partial).toBe(""); expect(thread.status).toBe("stopped");
    expect(totals).toHaveBeenCalledTimes(1);
  });
  it("surfaces provider failures without pretending execution", async () => {
    const thread = new SideThread("snapshot", model);
    await thread.ask("q", { modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false, error: "sign in" }) } } as any, () => {}, () => {});
    expect(thread.status).toBe("error"); expect(thread.partial).toBe("sign in"); expect(thread.busy).toBe(false);
  });
  it("closes independently from cancellation, reopens, creates new snapshots and clears on session change", async () => {
    initTheme("dark", false);
    const handlers = new Map<string, Function>(), commands = new Map<string, any>();
    btw({ on: (name: string, handler: Function) => handlers.set(name, handler), registerCommand: (name: string, value: any) => commands.set(name, value) } as any);
    const { registry: modelRegistry, streamSimple } = registry();
    let view!: SideOverlay;
    const ctx: any = { mode: "tui", model, modelRegistry, sessionManager: { getEntries: () => entries, getLeafId: () => "a" }, ui: {
      notify: vi.fn(), setStatus: vi.fn(), custom: vi.fn((factory) => new Promise<void>((resolve) => {
        view = factory({ requestRender: vi.fn(), terminal: { rows: 40 } }, { fg: (_: string, text: string) => text }, {}, resolve);
      })),
    } };
    const request = commands.get("btw").handler("first question", ctx);
    await Promise.resolve(); await Promise.resolve();
    const rendered = view.render(40); expect(rendered.every((line) => visibleWidth(line) <= 40)).toBe(true);
    view.handleInput("\x1b"); await request; // close, not cancel
    await Promise.resolve(); await Promise.resolve();
    const count = streamSimple.mock.calls.length;
    const reopen = commands.get("btw").handler("", ctx); view.handleInput("\x1b"); await reopen;
    expect(streamSimple.mock.calls.length).toBe(count);
    const replace = commands.get("btw").handler("new question", ctx); await Promise.resolve();
    view.handleInput("\x0b"); expect(view.render(80)[0]).toContain("stopped");
    view.handleInput("\x1b"); await replace;
    const paste = "旁问草稿\n" + "  pasted line\n".repeat(15);
    const draftView = commands.get("btw").handler("", ctx);
    view.handleInput(`\x1b[200~${paste}\x1b[201~`); view.handleInput("\x1b"); await draftView;
    const draftReopen = commands.get("btw").handler("", ctx);
    expect((view as any).editor.getExpandedText()).toBe(paste);
    handlers.get("session_tree")!({}, ctx); await draftReopen;
    const treeReopen = commands.get("btw").handler("", ctx);
    expect((view as any).editor.getExpandedText()).toBe(paste);
    view.handleInput("\x0e"); expect((view as any).editor.getExpandedText()).toBe("");
    expect(view.render(80)[0]).toContain("ready");
    view.handleInput("\x1b"); await treeReopen;
    handlers.get("session_start")!({}, ctx);
    await commands.get("btw").handler("", ctx); expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("没有旁问线程"), "info");
  });
});
