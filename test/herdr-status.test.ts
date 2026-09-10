import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import herdrStatus from "../extensions/herdr-status/index.js";
import { reportMetadata } from "../extensions/herdr-status/socket.js";

vi.mock("../extensions/herdr-status/socket.js", () => ({ reportMetadata: vi.fn(async () => {}) }));
const send = vi.mocked(reportMetadata);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function harness(mode = "tui") {
  const hooks = new Map<string, Function>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  let shortcut: (() => Promise<void>) | undefined;
  const exec = vi.fn();
  const appendEntry = vi.fn();
  const getEntries = vi.fn(() => { throw new Error("must not restore history"); });
  const pi: any = {
    on: (name: string, fn: Function) => hooks.set(name, fn),
    registerShortcut: (key: string, options: any) => {
      expect(key).toBe("alt+m");
      shortcut = options.handler;
    },
    exec, appendEntry,
    events: {
      on: (name: string, fn: (data: unknown) => void) => {
        const set = listeners.get(name) ?? new Set();
        set.add(fn); listeners.set(name, set);
        return () => set.delete(fn);
      },
    },
  };
  const ctx = { mode, sessionManager: { getEntries }, ui: { notify: vi.fn() } };
  const emit = async (name: string, data: unknown = {}) => {
    await hooks.get(name)?.(data, ctx);
    await flush();
  };
  const event = async (name: string, data: unknown) => {
    for (const fn of listeners.get(name) ?? []) fn(data);
    await flush();
  };
  herdrStatus(pi);
  return { exec, appendEntry, getEntries, hooks, listeners, emit, event,
    shortcut: async () => { await shortcut?.(); await flush(); },
    last: () => send.mock.calls.at(-1)?.[0].tokens,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("HERDR_ENV", "1");
  vi.stubEnv("HERDR_PANE_ID", "w1:p8");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Herdr sidebar extension", () => {
  it("starts asleep, marks user input working, ignores completion and cycles manually", async () => {
    const h = harness();
    expect(send).not.toHaveBeenCalled();
    await h.emit("session_start");
    expect(h.last()?.pi_task_mark).toBe("💤");
    await h.emit("input", { source: "interactive", text: "hello" });
    expect(h.last()?.pi_task_mark).toBe("🚀");
    await h.emit("agent_end"); await h.emit("agent_settled");
    expect(send).toHaveBeenCalledTimes(2);
    await h.shortcut(); expect(h.last()?.pi_task_mark).toBe("📖");
    await h.emit("input", { source: "extension", text: "agent completed" });
    expect(send).toHaveBeenCalledTimes(3);
    await h.shortcut(); expect(h.last()?.pi_task_mark).toBe("💤");
    await h.shortcut(); expect(h.last()?.pi_task_mark).toBe("📖");
    await h.emit("input", { source: "rpc", text: "continue" });
    expect(h.last()?.pi_task_mark).toBe("🚀");
    const calls = send.mock.calls.length;
    await h.emit("input", { source: "interactive", text: "again" });
    expect(send).toHaveBeenCalledTimes(calls);
    expect(h.appendEntry).not.toHaveBeenCalled();
    expect(h.exec).not.toHaveBeenCalled();
    await h.emit("session_shutdown");
  });

  it("counts actual lifetimes, deduplicates, and unregisters listeners on shutdown", async () => {
    const h = harness(); await h.emit("session_start");
    await h.event("subagents:started", { id: "a" });
    await h.event("subagents:started", { id: "a" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(h.last()?.pi_subagents).toBe("🤖 1 subagent running");
    await h.emit("tool_execution_end", { toolName: "Agent" });
    expect(send).toHaveBeenCalledTimes(2);
    await h.event("subagents:started", { id: "b" });
    await h.shortcut(); expect(h.last()?.pi_task_mark).toBe("📖");
    expect(h.last()?.pi_subagents).toBe("🤖 2 subagents running");
    for (const bad of [null, {}, { id: "" }, { id: 1 }]) await h.event("subagents:started", bad);
    expect(send).toHaveBeenCalledTimes(4);
    await h.event("subagents:failed", { id: "a", status: "aborted" });
    expect(h.last()?.pi_subagents).toBe("🤖 1 subagent running");
    await h.event("subagents:completed", { id: "b" });
    await h.event("subagents:completed", { id: "b" });
    expect(h.last()?.pi_subagents).toBeNull();
    await h.event("subagents:started", { id: "a" });
    expect(h.last()?.pi_subagents).toBe("🤖 1 subagent running");
    await h.emit("session_shutdown");
    expect(h.last()).toEqual({ pi_task_mark: null, pi_subagents: null });
    expect([...h.listeners.values()].every((set) => set.size === 0)).toBe(true);
    const calls = send.mock.calls.length;
    await h.event("subagents:started", { id: "c" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(calls);
  });

  it("has no heartbeat or history and resets mark and count on reinitialization", async () => {
    const h = harness();
    await h.emit("session_start");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await h.shortcut();
    await h.event("subagents:started", { id: "old" });
    await h.emit("session_shutdown");
    await h.emit("session_shutdown");
    await h.emit("session_start", { reason: "reload" });
    expect(h.last()).toEqual({ pi_task_mark: "💤", pi_subagents: null });
    const calls = send.mock.calls.length;
    await h.event("subagents:completed", { id: "old" });
    expect(send).toHaveBeenCalledTimes(calls);
    expect(h.appendEntry).not.toHaveBeenCalled();
    expect(h.getEntries).not.toHaveBeenCalled();
    await h.emit("session_shutdown");
  });

  it.each(["rpc", "print", "json"])("does nothing in inherited %s child sessions", async (mode) => {
    const h = harness(mode); await h.emit("session_start");
    await h.emit("input", { source: "rpc" }); await h.shortcut();
    await h.event("subagents:started", { id: "child" });
    await h.emit("session_shutdown");
    expect(send).not.toHaveBeenCalled(); expect(h.appendEntry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["environment", "pane"])("does not register without Herdr %s", (missing) => {
    vi.stubEnv(missing === "pane" ? "HERDR_PANE_ID" : "HERDR_ENV", "");
    const h = harness(); expect(h.hooks.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
