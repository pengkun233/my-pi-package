import { describe, expect, it, vi } from "vitest";
import { Key } from "@earendil-works/pi-tui";
import chatModeExtension from "../extensions/chat-mode.js";

function createHarness(options?: { mode?: "tui" | "rpc" | "json" | "print"; activeTools?: string[] }) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const shortcuts = new Map<string, any>();
  let activeTools = [...(options?.activeTools ?? ["read", "bash", "edit", "write", "memory"])];
  let idle = true;

  const ui = {
    theme: { fg: (token: string, text: string) => `${token}:${text}` },
    setStatus: vi.fn(),
    notify: vi.fn(),
  };
  const ctx: any = {
    mode: options?.mode ?? "tui",
    ui,
    isIdle: () => idle,
  };
  const allToolNames = ["read", "bash", "edit", "write", "memory"];
  const pi: any = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerShortcut: (key: string, shortcut: any) => shortcuts.set(key, shortcut),
    getActiveTools: () => [...activeTools],
    getAllTools: () => allToolNames.map((name) => ({ name })),
    setActiveTools: vi.fn((names: string[]) => {
      activeTools = [...names];
    }),
  };

  chatModeExtension(pi);

  return {
    pi,
    ctx,
    ui,
    handlers,
    commands,
    shortcuts,
    activeTools: () => activeTools,
    setActiveTools: (names: string[]) => { activeTools = [...names]; },
    setIdle: (value: boolean) => { idle = value; },
  };
}

describe("Chat mode", () => {
  it("starts disabled in TUI mode", () => {
    const harness = createHarness();

    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    expect(harness.activeTools()).toEqual(["read", "bash", "edit", "write", "memory"]);
    expect(harness.ui.setStatus).toHaveBeenLastCalledWith("chat-mode", undefined);
    expect(harness.ui.notify).not.toHaveBeenCalled();
    expect(harness.handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, harness.ctx)).toBeUndefined();
    expect(harness.handlers.get("tool_call")!({ toolName: "edit" }, harness.ctx)).toBeUndefined();
  });

  it("toggles with both the command and shortcut while restoring only previously active write tools", async () => {
    const harness = createHarness({ activeTools: ["read", "edit", "memory"] });
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    expect([...harness.commands.keys()]).toEqual(["chat"]);
    expect(harness.shortcuts.has(Key.ctrlAlt("c"))).toBe(true);

    await harness.commands.get("chat").handler("", harness.ctx);
    expect(harness.activeTools()).toEqual(["read", "memory"]);
    expect(harness.ui.setStatus).toHaveBeenLastCalledWith("chat-mode", "warning:💬 chat");

    const prompt = harness.handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, harness.ctx);
    expect(prompt.systemPrompt).toContain("BASE\n\n## Chat Mode");
    expect(prompt.systemPrompt).toContain("do not apply them");
    expect(prompt.systemPrompt).toContain("Do not take actions with side effects");
    expect(prompt.systemPrompt).toContain("/chat or Ctrl+Alt+C");
    expect(harness.handlers.get("tool_call")!({ toolName: "edit" }, harness.ctx)).toEqual({
      block: true,
      reason: expect.stringContaining("Chat mode blocks edit and write"),
    });
    expect(harness.handlers.get("tool_call")!({ toolName: "bash" }, harness.ctx)).toBeUndefined();

    await harness.shortcuts.get(Key.ctrlAlt("c")).handler(harness.ctx);
    expect(harness.activeTools()).toEqual(["read", "memory", "edit"]);
    expect(harness.activeTools()).not.toContain("write");
    expect(harness.ui.setStatus).toHaveBeenLastCalledWith("chat-mode", undefined);
    expect(harness.handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, harness.ctx)).toBeUndefined();
  });

  it("refuses to switch modes while the agent is busy", async () => {
    const harness = createHarness();
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    harness.setIdle(false);

    await harness.commands.get("chat").handler("", harness.ctx);

    expect(harness.activeTools()).toEqual(["read", "bash", "edit", "write", "memory"]);
    expect(harness.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("press Esc"), "warning");
  });

  it("defaults to off outside TUI mode but can still be enabled explicitly", async () => {
    const harness = createHarness({ mode: "json" });
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);

    expect(harness.activeTools()).toEqual(["read", "bash", "edit", "write", "memory"]);
    expect(harness.handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, harness.ctx)).toBeUndefined();
    expect(harness.ui.setStatus).toHaveBeenLastCalledWith("chat-mode", undefined);

    await harness.commands.get("chat").handler("", harness.ctx);
    expect(harness.activeTools()).toEqual(["read", "bash", "memory"]);
    expect(harness.handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, harness.ctx).systemPrompt)
      .toContain("## Chat Mode");
  });

  it("re-applies restrictions without later restoring write tools that were initially inactive", async () => {
    const harness = createHarness({ activeTools: ["read", "bash", "edit", "memory"] });
    harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
    await harness.commands.get("chat").handler("", harness.ctx);
    harness.setActiveTools(["read", "bash", "write", "memory"]);

    harness.handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, harness.ctx);
    expect(harness.activeTools()).toEqual(["read", "bash", "memory"]);

    harness.handlers.get("session_shutdown")!({ reason: "reload" }, harness.ctx);
    expect(harness.activeTools()).toEqual(["read", "bash", "memory", "edit"]);
    expect(harness.activeTools()).not.toContain("write");
    expect(harness.ui.setStatus).toHaveBeenLastCalledWith("chat-mode", undefined);
  });
});
