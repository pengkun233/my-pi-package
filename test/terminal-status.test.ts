import { describe, expect, it, vi } from "vitest";
import { LOOP_ACTIVITY_EVENT } from "../extensions/loop/events.js";
import { TerminalStatusService, withTerminalNeedsInput } from "../extensions/ui/terminal-status.js";

function harness() {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const events: any = {
    on(name: string, handler: (value: unknown) => void) {
      const handlers = listeners.get(name) ?? new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
      return () => handlers.delete(handler);
    },
    emit(name: string, value: unknown) {
      for (const handler of listeners.get(name) ?? []) handler(value);
    },
  };
  const setTitle = vi.fn();
  const ctx: any = { cwd: "/work/demo", ui: { setTitle } };
  const service = new TerminalStatusService(ctx, {
    events,
    getSessionName: () => "session",
  });
  service.install();
  return { service, events, setTitle, listeners };
}

describe("terminal status background activity", () => {
  it("shows purple while a Loop is active and keeps errors above it", () => {
    const h = harness();
    expect(h.setTitle).toHaveBeenLastCalledWith("⚪ 空闲 · pi - session - demo");

    h.events.emit(LOOP_ACTIVITY_EVENT, { active: true });
    expect(h.setTitle).toHaveBeenLastCalledWith("🟣 等待中 · pi - session - demo");

    h.service.onAgentStart();
    expect(h.setTitle).toHaveBeenLastCalledWith("🟣 等待中 · pi - session - demo");
    h.service.onAgentEnd({ messages: [{ role: "assistant", stopReason: "error" }] } as any);
    h.service.onAgentSettled();
    expect(h.setTitle).toHaveBeenLastCalledWith("🔴 错误 · pi - session - demo");

    h.service.onAgentStart();
    expect(h.setTitle).toHaveBeenLastCalledWith("🟣 等待中 · pi - session - demo");
    h.events.emit(LOOP_ACTIVITY_EVENT, { active: false });
    expect(h.setTitle).toHaveBeenLastCalledWith("🔵 工作中 · pi - session - demo");
  });

  it("tracks async and foreground subagent launches without counting status calls", () => {
    const h = harness();

    h.events.emit("subagent:async-started", { id: "async-1" });
    expect(h.setTitle).toHaveBeenLastCalledWith("🟣 等待中 · pi - session - demo");
    h.events.emit("subagent:async-complete", { runId: "async-1" });
    expect(h.setTitle).toHaveBeenLastCalledWith("⚪ 空闲 · pi - session - demo");

    h.service.onToolExecutionStart({
      type: "tool_execution_start",
      toolCallId: "launch-1",
      toolName: "subagent",
      args: { agent: "scout", task: "inspect" },
    });
    expect(h.setTitle).toHaveBeenLastCalledWith("🟣 等待中 · pi - session - demo");
    h.service.onToolExecutionEnd({
      type: "tool_execution_end",
      toolCallId: "launch-1",
      toolName: "subagent",
      result: {},
      isError: false,
    });
    expect(h.setTitle).toHaveBeenLastCalledWith("⚪ 空闲 · pi - session - demo");

    h.service.onToolExecutionStart({
      type: "tool_execution_start",
      toolCallId: "status-1",
      toolName: "subagent",
      args: { action: "status" },
    });
    expect(h.setTitle).toHaveBeenLastCalledWith("⚪ 空闲 · pi - session - demo");
  });

  it("keeps needs-input above background work and unsubscribes on dispose", async () => {
    const h = harness();
    h.events.emit(LOOP_ACTIVITY_EVENT, { active: true });

    await withTerminalNeedsInput(h.events, async () => {
      expect(h.setTitle).toHaveBeenLastCalledWith("🟠 需要输入 · pi - session - demo");
    });
    expect(h.setTitle).toHaveBeenLastCalledWith("🟣 等待中 · pi - session - demo");

    h.service.dispose();
    expect(h.setTitle).toHaveBeenLastCalledWith("pi - session - demo");
    expect([...h.listeners.values()].every((handlers) => handlers.size === 0)).toBe(true);
  });
});
