import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import herdrStatus from "../extensions/herdr-status/index.js";
import { STATE_ENTRY } from "../extensions/herdr-status/state.js";

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function harness(mode = "tui", entries: unknown[] = []) {
  const hooks = new Map<string, Function>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  let shortcut: (() => Promise<void>) | undefined;
  const exec = vi.fn(async (_command: string, _args: string[]) => ({ code: 0 }));
  const appendEntry = vi.fn();
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
  const ctx = { mode, sessionManager: { getEntries: () => entries }, ui: { notify: vi.fn() } };
  const emit = async (name: string, data: unknown = {}) => {
    await hooks.get(name)?.(data, ctx);
    await flush();
  };
  const event = async (name: string, data: unknown) => {
    for (const fn of listeners.get(name) ?? []) fn(data);
    await flush();
  };
  herdrStatus(pi);
  return { exec, appendEntry, hooks, listeners, emit, event,
    shortcut: async () => { await shortcut?.(); await flush(); },
    last: () => exec.mock.calls.at(-1)?.[1] ?? [],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("HERDR_ENV", "1");
  vi.stubEnv("HERDR_PANE_ID", "w1:p8");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Herdr sidebar extension", () => {
  it("starts asleep, marks user input working, ignores completion and cycles manually", async () => {
    const h = harness();
    expect(h.exec).not.toHaveBeenCalled();
    await h.emit("session_start");
    expect(h.last()).toContain("pi_task_mark=💤");
    await h.emit("input", { source: "interactive", text: "hello" });
    expect(h.last()).toContain("pi_task_mark=🚀");
    await h.emit("agent_end"); await h.emit("agent_settled");
    expect(h.last()).toContain("pi_task_mark=🚀");
    await h.shortcut(); expect(h.last()).toContain("pi_task_mark=💤");
    await h.shortcut(); expect(h.last()).toContain("pi_task_mark=📖");
    await h.emit("input", { source: "extension", text: "agent completed" });
    expect(h.last()).toContain("pi_task_mark=📖");
    await h.shortcut(); expect(h.last()).toContain("pi_task_mark=💤");
    await h.emit("input", { source: "rpc", text: "continue" });
    expect(h.last()).toContain("pi_task_mark=🚀");
    expect(h.appendEntry).toHaveBeenLastCalledWith(STATE_ENTRY, { mark: "working" });
    await h.emit("session_shutdown");
  });

  it("counts actual foreground/background lifetimes, deduplicates, handles failure and resume", async () => {
    const h = harness(); await h.emit("session_start");
    await h.event("subagents:started", { id: "a" });
    await h.event("subagents:started", { id: "a" });
    expect(h.last()).toContain("pi_subagents=🤖 1 subagent running");
    await h.emit("tool_execution_end", { toolName: "Agent", result: { details: { status: "background" } } });
    expect(h.last()).toContain("pi_subagents=🤖 1 subagent running");
    await h.event("subagents:started", { id: "b" });
    expect(h.last()).toContain("pi_subagents=🤖 2 subagents running");
    await h.shortcut(); expect(h.last()).toContain("pi_task_mark=📖");
    expect(h.last()).toContain("pi_subagents=🤖 2 subagents running");
    for (const bad of [null, {}, { id: "" }, { id: 1 }]) await h.event("subagents:started", bad);
    await h.event("subagents:failed", { id: "a", status: "aborted" });
    expect(h.last()).toContain("pi_subagents=🤖 1 subagent running");
    await h.event("subagents:completed", { id: "b" });
    await h.event("subagents:completed", { id: "b" });
    expect(h.last()).toEqual(expect.arrayContaining(["--clear-token", "pi_subagents"]));
    await h.event("subagents:started", { id: "a" });
    expect(h.last()).toContain("pi_subagents=🤖 1 subagent running");
    await h.emit("session_shutdown");
    expect([...h.listeners.values()].every((set) => set.size === 0)).toBe(true);
    const calls = h.exec.mock.calls.length;
    await h.event("subagents:started", { id: "c" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.exec).toHaveBeenCalledTimes(calls);
  });

  it("restores a session bookmark and refreshes metadata without appending history", async () => {
    const h = harness("tui", [{ type: "custom", customType: STATE_ENTRY, data: { mark: "review" } }]);
    await h.emit("session_start");
    expect(h.last()).toContain("pi_task_mark=📖");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.exec).toHaveBeenCalledTimes(2);
    expect(h.appendEntry).not.toHaveBeenCalled();
    await h.emit("session_shutdown");
    await h.emit("session_shutdown");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["rpc", "print", "json"])("does nothing in inherited %s child sessions", async (mode) => {
    const h = harness(mode); await h.emit("session_start");
    await h.emit("input", { source: "rpc" }); await h.shortcut();
    await h.event("subagents:started", { id: "child" });
    await h.emit("session_shutdown");
    expect(h.exec).not.toHaveBeenCalled(); expect(h.appendEntry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not register outside Herdr", () => {
    vi.stubEnv("HERDR_ENV", "0");
    const h = harness(); expect(h.hooks.size).toBe(0);
    expect(h.exec).not.toHaveBeenCalled();
  });
});
