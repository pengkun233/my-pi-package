import { describe, expect, it, vi } from "vitest";
import { setupUi } from "../extensions/ui/index.js";

describe("UI extension entry", () => {
  it("registers one always-on lifecycle and only the ack command", () => {
    const events: string[] = [];
    const commands: string[] = [];
    const pi: any = {
      on: (event: string) => events.push(event),
      registerCommand: (name: string) => commands.push(name),
      registerTool: vi.fn(),
      registerMessageRenderer: vi.fn(),
      registerShortcut: vi.fn(),
      registerFlag: vi.fn(),
      getSessionName: vi.fn(),
      events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
    };

    setupUi(pi);

    expect(commands).toEqual(["ack"]);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerMessageRenderer).not.toHaveBeenCalled();
    expect(pi.registerShortcut).not.toHaveBeenCalled();
    expect(pi.registerFlag).not.toHaveBeenCalled();
    expect(events.filter((event) => event === "session_start")).toHaveLength(1);
    expect(events.filter((event) => event === "session_shutdown")).toHaveLength(1);
    expect(events).not.toContain("before_agent_start");
    expect(events).not.toContain("tool_call");
  });
});
