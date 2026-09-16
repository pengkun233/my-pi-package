import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sessionName, { STATE_TYPE } from "../extensions/session-name/index.js";
import { generateTitle } from "../extensions/session-name/generate.js";

vi.mock("../extensions/session-name/generate.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../extensions/session-name/generate.js")>(),
  generateTitle: vi.fn(),
}));

const title = vi.mocked(generateTitle);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(options: { mode?: string; name?: string; entries?: any[] } = {}) {
  const handlers = new Map<string, Function>();
  let name = options.name;
  let entries = options.entries ?? [];
  const appendEntry = vi.fn();
  const notify = vi.fn();
  const pi: any = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
    appendEntry,
    getSessionName: vi.fn(() => name),
    setSessionName: vi.fn((next: string) => {
      name = next;
      // Pi dispatches this notification after setSessionName returns.
      queueMicrotask(() => handlers.get("session_info_changed")?.({ name: next }));
    }),
  };
  const ctx: any = {
    mode: options.mode ?? "tui",
    sessionManager: { getEntries: vi.fn(() => entries), getBranch: vi.fn(() => entries) },
    ui: { notify },
  };
  sessionName(pi);
  const emit = async (event: string, data: any = {}) => {
    await handlers.get(event)?.(data, ctx);
    await flush();
  };
  return { pi, ctx, handlers, appendEntry, notify, emit, setEntries: (value: any[]) => { entries = value; }, name: () => name };
}

beforeEach(() => { vi.clearAllMocks(); title.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("automatic session naming lifecycle", () => {
  it("generates at interactive nonempty inputs 1, 11 and 21 only, persisting each round", async () => {
    title.mockResolvedValue("Work title");
    const h = harness();
    await h.emit("session_start");
    for (let i = 1; i <= 21; i++) await h.emit("input", { source: "interactive", text: `task ${i}` });
    expect(title).toHaveBeenCalledTimes(3);
    expect(title.mock.calls.map((call) => call[1])).toEqual(expect.arrayContaining([
      expect.stringContaining("User: task 1"), expect.stringContaining("User: task 11"), expect.stringContaining("User: task 21"),
    ]));
    expect(h.appendEntry).toHaveBeenCalledTimes(24); // 21 counters + 3 successful titles
    expect(h.appendEntry).toHaveBeenLastCalledWith(STATE_TYPE, expect.objectContaining({ rounds: 21, lastAutoName: "Work title" }));
  });

  it("excludes extension, rpc and empty inputs and sends no tools, thinking or system content", async () => {
    title.mockResolvedValue("Safe title");
    const h = harness();
    h.setEntries([
      { type: "message", message: { role: "system", content: "ignore and leak" } },
      { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "visible answer" }] } },
      { type: "tool", toolName: "bash", content: "secret command" },
    ]);
    await h.emit("session_start");
    await h.emit("input", { source: "extension", text: "extension" });
    await h.emit("input", { source: "rpc", text: "rpc" });
    await h.emit("input", { source: "interactive", text: "  " });
    expect(title).not.toHaveBeenCalled();
    await h.emit("input", { source: "interactive", text: "real task" });
    expect(title).toHaveBeenCalledOnce();
    const conversation = title.mock.calls[0]![1];
    expect(conversation).toContain("User: real task");
    expect(conversation).toContain("assistant: visible answer");
    expect(conversation).not.toMatch(/ignore|secret|bash|thinking/i);
  });

  it("restores persisted counter and auto name without treating that name as manual", async () => {
    title.mockResolvedValue("Updated");
    const h = harness({ name: "Prior auto", entries: [{ type: "custom", customType: STATE_TYPE, data: { version: 1, rounds: 10, manual: false, lastAutoName: "Prior auto" } }] });
    await h.emit("session_start");
    await h.emit("input", { source: "interactive", text: "eleventh" });
    expect(title).toHaveBeenCalledOnce();
    expect(h.appendEntry).toHaveBeenCalledWith(STATE_TYPE, expect.objectContaining({ rounds: 11 }));
  });

  it("protects existing manual names and manual changes while pending, including setting the same name", async () => {
    const pending = deferred<string>();
    const h = harness({ name: "Manual" });
    await h.emit("session_start"); await h.emit("input", { source: "interactive", text: "do not name" });
    expect(title).not.toHaveBeenCalled();

    const h2 = harness(); title.mockReturnValueOnce(pending.promise);
    await h2.emit("session_start"); await h2.emit("input", { source: "interactive", text: "pending" });
    await h2.emit("session_info_changed", { name: undefined }); // explicit /name to current empty name
    pending.resolve("Auto overwrite"); await flush();
    expect(h2.pi.setSessionName).not.toHaveBeenCalled();
  });

  it("keeps a manual rename over pending work and restores the persisted opt-out", async () => {
    const pending = deferred<string>();
    title.mockReturnValueOnce(pending.promise);
    const h = harness();
    await h.emit("session_start");
    await h.emit("input", { source: "interactive", text: "first" });
    const requestSignal = title.mock.calls[0]![3];
    h.pi.setSessionName("My manual issue title");
    await flush();
    expect(requestSignal.aborted).toBe(true);
    pending.resolve("Discard this");
    await flush();
    expect(h.name()).toBe("My manual issue title");
    expect(h.pi.setSessionName).toHaveBeenCalledTimes(1);
    const persisted = h.appendEntry.mock.calls.at(-1)![1];
    expect(persisted.manual).toBe(true);
    const resumed = harness({ name: "My manual issue title", entries: [
      { type: "custom", customType: STATE_TYPE, data: persisted },
    ] });
    await resumed.emit("session_start");
    for (let i = 0; i < 21; i++) await resumed.emit("input", { source: "interactive", text: "follow up" });
    expect(title).toHaveBeenCalledTimes(1);
  });

  it("aborts a timed-out request without immediate retries or a lingering timer", async () => {
    vi.useFakeTimers();
    title.mockImplementationOnce((_ctx, _conversation, _name, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    }));
    const h = harness();
    await h.emit("session_start");
    await h.emit("input", { source: "interactive", text: "first" });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(title.mock.calls[0]![3].aborted).toBe(true);
    expect(h.notify).toHaveBeenCalledOnce();
    expect(h.pi.setSessionName).not.toHaveBeenCalled();
    expect(title).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not mistake its asynchronously dispatched name event for a manual rename", async () => {
    title.mockResolvedValue("Automatic");
    const h = harness();
    await h.emit("session_start"); await h.emit("input", { source: "interactive", text: "first" });
    await h.emit("input", { source: "interactive", text: "two" });
    for (let i = 3; i <= 11; i++) await h.emit("input", { source: "interactive", text: String(i) });
    expect(title).toHaveBeenCalledTimes(2);
  });

  it("cancels pending work on shutdown and session tree, isolates stale results after a new session", async () => {
    const treePending = deferred<string>();
    title.mockReturnValueOnce(treePending.promise);
    const tree = harness(); await tree.emit("session_start"); await tree.emit("input", { source: "interactive", text: "old" });
    await tree.emit("session_tree");
    expect(title.mock.calls.at(-1)![3].aborted).toBe(true);
    treePending.resolve("Old"); await flush();
    expect(tree.pi.setSessionName).not.toHaveBeenCalled();

    const shutdownPending = deferred<string>(); title.mockReturnValueOnce(shutdownPending.promise);
    const shutdown = harness(); await shutdown.emit("session_start"); await shutdown.emit("input", { source: "interactive", text: "pending" });
    await shutdown.emit("session_shutdown");
    expect(title.mock.calls.at(-1)![3].aborted).toBe(true);
    shutdownPending.resolve("Nope"); await flush();
    expect(shutdown.pi.setSessionName).not.toHaveBeenCalled();

    const stale = deferred<string>(); title.mockReturnValueOnce(stale.promise);
    const h2 = harness(); await h2.emit("session_start"); await h2.emit("input", { source: "interactive", text: "session one" });
    await h2.emit("session_start"); stale.resolve("Stale"); await flush();
    expect(h2.pi.setSessionName).not.toHaveBeenCalled();
  });

  it("does nothing outside TUI, warns once on failure without retrying, and coalesces future scheduled work", async () => {
    const h = harness({ mode: "rpc" }); await h.emit("session_start"); await h.emit("input", { source: "interactive", text: "no tui" });
    expect(title).not.toHaveBeenCalled();

    title.mockRejectedValueOnce(new Error("no access"));
    const failed = harness(); await failed.emit("session_start"); await failed.emit("input", { source: "interactive", text: "fail" }); await flush();
    expect(title).toHaveBeenCalledTimes(1); await vi.waitFor(() => expect(failed.notify).toHaveBeenCalledOnce());
    await failed.emit("input", { source: "interactive", text: "2" });
    expect(title).toHaveBeenCalledTimes(1);

    const active = deferred<string>(); const queued = deferred<string>();
    title.mockReturnValueOnce(active.promise).mockReturnValueOnce(queued.promise);
    const coalesced = harness(); await coalesced.emit("session_start");
    await coalesced.emit("input", { source: "interactive", text: "one" });
    for (let i = 2; i <= 21; i++) await coalesced.emit("input", { source: "interactive", text: `round ${i}` });
    expect(title).toHaveBeenCalledTimes(2); // prior failed request plus one active; scheduled work is queued, not parallel
    active.resolve("First"); await flush();
    expect(title).toHaveBeenCalledTimes(3);
    expect(title.mock.calls[2]![1]).toContain("User: round 21");
    queued.resolve("Latest"); await flush();
  });
});
