import { describe, expect, it, vi } from "vitest";
import { setupUi } from "../extensions/ui/index.js";

describe("entry lifecycle integration", () => {
  it("installs automatically, preserves the active theme, and cleans up on reload", () => {
    const handlers = new Map<string, Function>();
    const commands = new Map<string, any>();
    const pi: any = {
      on: (name: string, handler: Function) => handlers.set(name, handler),
      registerCommand: (name: string, options: any) => commands.set(name, options),
      getSessionName: () => undefined,
      events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
    };
    const editor = vi.fn() as any;
    const activeTheme = {
      name: "dark",
      fg: (_token: string, text: string) => text,
      bg: (_token: string, text: string) => text,
    };
    const ui: any = {
      theme: activeTheme,
      notify: vi.fn(),
      getEditorComponent: () => editor,
      setEditorComponent: vi.fn(),
      getTheme: vi.fn(),
      setTheme: vi.fn(),
      setFooter: vi.fn(),
      setHeader: vi.fn(),
      setWorkingMessage: vi.fn(),
      setWorkingVisible: vi.fn(),
      setWorkingIndicator: vi.fn(),
      setHiddenThinkingLabel: vi.fn(),
      setTitle: vi.fn(),
    };
    const ctx: any = {
      hasUI: true,
      mode: "tui",
      ui,
      cwd: "/tmp",
      isIdle: () => true,
      model: undefined,
      thinkingLevel: "off",
      sessionManager: { getBranch: () => [], getSessionName: () => undefined },
      getContextUsage: () => undefined,
    };

    setupUi(pi);
    handlers.get("session_start")!({}, ctx);

    expect(commands.has("ack")).toBe(true);
    expect(ui.setHeader).toHaveBeenCalledWith(expect.any(Function));
    expect(ui.setFooter).toHaveBeenCalledWith(expect.any(Function));
    expect(ui.setEditorComponent).toHaveBeenCalledWith(expect.any(Function));
    expect(ui.getTheme).not.toHaveBeenCalled();
    expect(ui.setTheme).not.toHaveBeenCalled();

    handlers.get("session_shutdown")!({ reason: "reload" }, ctx);
    expect(ui.setEditorComponent).toHaveBeenLastCalledWith(editor);
    expect(ui.setFooter).toHaveBeenLastCalledWith(undefined);
    expect(ui.setHeader).toHaveBeenLastCalledWith(undefined);
    expect(ui.setTheme).not.toHaveBeenCalled();
  });
});
