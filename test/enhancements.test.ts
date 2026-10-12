import { describe, expect, it, vi } from "vitest";
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import completion, { COMPLETION_ENTRY, completionText } from "../extensions/completion/index.js";
import copyBlock, { assistantResponses } from "../extensions/copy-block/index.js";
import { markdownBlocks } from "../extensions/copy-block/markdown.js";
import { ChatInput } from "../extensions/ui/chat-input.js";
import { DEFAULT_CHAT_INPUT_CONFIG } from "../extensions/ui/chat-input-config.js";
import usageExtension from "../extensions/openai-usage.js";

const identity = (text: string) => text;
function harness(extension: Function) {
  const events = new Map<string, Function>();
  const commands = new Map<string, any>();
  const renderers = new Map<string, Function>();
  const pi = { on: (event: string, handler: Function) => events.set(event, handler),
    registerCommand: (name: string, value: any) => commands.set(name, value),
    registerEntryRenderer: (name: string, value: Function) => renderers.set(name, value), appendEntry: vi.fn() };
  extension(pi);
  return { pi, events, commands, renderers };
}

describe("completion metadata", () => {
  it("waits for settled, records monotonic duration and renders independent replayable data", () => {
    const { events, pi, renderers } = harness(completion);
    events.get("agent_start")!();
    events.get("message_end")!({ message: { role: "assistant", stopReason: "error" } });
    expect(pi.appendEntry).not.toHaveBeenCalled();
    events.get("agent_start")!(); // continuation/retry
    events.get("message_end")!({ message: { role: "assistant", stopReason: "stop" } });
    events.get("agent_settled")!(); events.get("agent_settled")!();
    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    const data = pi.appendEntry.mock.calls[0][1];
    expect(data.status).toBe("finished"); expect(data.durationMs).toBeGreaterThanOrEqual(0);
    const entry: any = { type: "custom", customType: COMPLETION_ENTRY, data };
    expect(sessionEntryToContextMessages(entry)).toEqual([]);
    const view = renderers.get(COMPLETION_ENTRY)!(entry, {}, { fg: (_: string, value: string) => value });
    expect(view.render(80)[0]).toMatch(/^ +finished · \d\d:\d\d:\d\d ·/);
    expect(visibleWidth(view.render(8)[0])).toBeLessThanOrEqual(8);
  });
  it.each([["aborted", "stopped"], ["error", "error"]])("records %s as %s", (reason, status) => {
    const { events, pi } = harness(completion);
    events.get("agent_start")!(); events.get("message_end")!({ message: { role: "assistant", stopReason: reason } }); events.get("agent_settled")!();
    expect(pi.appendEntry.mock.calls[0][1].status).toBe(status);
  });
  it("reports aborts during tools/retry using final outcome or the older host signal", () => {
    const { events, pi } = harness(completion);
    const controller = new AbortController();
    events.get("agent_start")!({}, { signal: controller.signal });
    events.get("message_end")!({ message: { role: "assistant", stopReason: "toolUse" } });
    controller.abort(); events.get("agent_settled")!();
    expect(pi.appendEntry.mock.calls[0][1].status).toBe("stopped");
    events.get("agent_start")!({}, {});
    events.get("message_end")!({ message: { role: "assistant", stopReason: "stop" } });
    events.get("agent_settled")!({ aborted: true });
    expect(pi.appendEntry.mock.calls[1][1].status).toBe("stopped");
    events.get("agent_start")!({}, { signal: controller.signal });
    events.get("message_end")!({ message: { role: "assistant", stopReason: "stop" } });
    events.get("agent_settled")!({ aborted: false });
    expect(pi.appendEntry.mock.calls[2][1].status).toBe("finished");
  });
  it("formats the requested compact elapsed time", () => {
    expect(completionText({ status: "finished", endedAt: new Date(2026, 0, 1, 12, 34, 56).toISOString(), durationMs: 84000 })).toBe("finished · 12:34:56 · 1m24s");
  });
});

describe("raw copy blocks", () => {
  it("preserves CRLF and indentation, omits code fences, ignores headings inside fences", () => {
    const source = "# Title\r\n\r\n```ts\r\n  # not heading\r\n    foo();\r\n```\r\n> quote\r\n> next\r\n## Child\r\nx\r\n# Next\r\ny";
    const blocks = markdownBlocks(source);
    const payload = (kind: string) => blocks.filter((block) => block.kind === kind).map((block) => source.slice(block.start, block.end));
    expect(payload("whole")).toEqual([source]);
    expect(payload("code")).toEqual(["  # not heading\r\n    foo();\r\n"]);
    expect(payload("quote")).toEqual(["> quote\r\n> next\r\n"]);
    expect(payload("section")).toHaveLength(3);
    expect(payload("section")[0]).toBe(source.slice(0, source.indexOf("# Next")));
  });
  it("handles tilde fences, nested-length fences, unclosed code and setext headings", () => {
    const source = "Title\n=====\n~~~~js\n```\n x\n~~~~~\nTail\n----\n```\n  unclosed";
    const blocks = markdownBlocks(source);
    expect(blocks.filter((block) => block.kind === "code").map((block) => source.slice(block.start, block.end))).toEqual(["```\n x\n", "  unclosed"]);
    expect(blocks.filter((block) => block.kind === "section")).toHaveLength(2);
  });
  it("only selects text on the supplied branch; no thinking or failed responses", () => {
    expect(assistantResponses([
      { type: "message", message: { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "raw" }] } },
      { type: "message", message: { role: "assistant", stopReason: "aborted", content: [{ type: "text", text: "partial" }] } },
    ] as any)).toEqual(["raw"]);
  });
  it("cancelling the native picker never writes the draft or calls /copy", async () => {
    const { commands } = harness(copyBlock);
    const ctx: any = { hasUI: true, sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] } }] }, ui: { select: vi.fn(async () => undefined), setEditorText: vi.fn() } };
    await commands.get("copy-block").handler("", ctx);
    expect(commands.has("copy")).toBe(false); expect(ctx.ui.setEditorText).not.toHaveBeenCalled();
  });
});

describe("draft restoration in the existing ChatInput", () => {
  function editor(bindings = {}) {
    const tui: any = { requestRender: vi.fn() };
    const theme: any = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
    const kb = new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.clear": { defaultKeys: "ctrl+c" } }, bindings);
    const editor = new ChatInput(tui, theme, kb as any, { normal: { border: identity, accent: identity }, bash: { border: identity, accent: identity } }, { ...DEFAULT_CHAT_INPUT_CONFIG, companion: { ...DEFAULT_CHAT_INPUT_CONFIG.companion, enabled: false } });
    const clear = vi.fn(() => editor.setText(""));
    editor.onAction("app.clear", clear);
    return { editor, clear };
  }
  it("restores Chinese multiline/bash text and expanded large paste exactly once", () => {
    const { editor: input, clear } = editor();
    const draft = "!你好\n" + "  pasted line\n".repeat(15);
    input.handleInput(`\x1b[200~${draft}\x1b[201~`);
    expect(input.getText()).toContain("paste #");
    input.handleInput("\x03"); input.handleInput("\x1b[A");
    expect(input.getExpandedText()).toBe(draft);
    input.handleInput("\x1b[A"); expect(input.getExpandedText()).toBe(draft);
    input.handleInput("\x03"); input.handleInput("\x03"); expect(clear).toHaveBeenCalledTimes(3);
    input.dispose();
  });
  it("respects configured clear and preserves nonempty base cursor behavior", () => {
    const { editor: input, clear } = editor({ "app.clear": "ctrl+k" });
    input.setText("first\nsecond"); input.handleInput("\x1b[A");
    expect(input.getText()).toBe("first\nsecond");
    input.handleInput("\x0b"); expect(clear).toHaveBeenCalledTimes(1);
    input.handleInput("new"); input.handleInput("\x1b[A"); expect(input.getText()).toBe("new");
    input.dispose();
  });
  it("preserves Up shortcut priority and invalidates a saved draft on host replacement", () => {
    const { editor: input } = editor(); input.setText("draft"); input.handleInput("\x03");
    const shortcut = vi.fn(() => true); input.onExtensionShortcut = shortcut; input.handleInput("\x1b[A");
    expect(shortcut).toHaveBeenCalledTimes(1); expect(input.getText()).toBe("");
    input.onExtensionShortcut = undefined; input.handleInput("\x1b[A"); expect(input.getText()).toBe("draft");
    input.handleInput("\x03"); input.setText(""); input.handleInput("\x1b[A");
    expect(input.getText()).toBe(""); input.dispose();
  });
  it("does not capture a clear intercepted by a higher-priority extension shortcut", () => {
    const { editor: input, clear } = editor(); input.setText("draft");
    input.onExtensionShortcut = () => true; input.handleInput("\x03");
    expect(clear).not.toHaveBeenCalled(); expect(input.getText()).toBe("draft");
    input.onExtensionShortcut = () => { input.setText(""); return true; };
    input.handleInput("\x03"); input.onExtensionShortcut = undefined; input.handleInput("\x1b[A");
    expect(input.getText()).toBe(""); input.dispose();
  });
});

it("renames the subscription command with no old alias", () => {
  const { commands } = harness(usageExtension);
  expect([...commands.keys()]).toEqual(["codex-plan-usage"]);
  expect(commands.get("codex-plan-usage").description).toContain("/codex-plan-usage json");
});
