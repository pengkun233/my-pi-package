import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatBeijingFooterTime,
  formatBeijingTime,
  parseLoopDefinition,
  setupLoop,
} from "../extensions/loop/index.js";
import { TERMINAL_BACKGROUND_ACTIVITY_EVENT } from "../extensions/ui/terminal-status-events.js";
import type { PatrolResult } from "../extensions/loop/patrol.js";

vi.mock("../extensions/loop/patrol.js", () => ({
  runPatrol: vi.fn(),
  loadPatrolConfig: (overrides: object) => ({
    patrolModel: "openai-codex/gpt-5.6-luna",
    patrolThinking: "medium",
    ...overrides,
  }),
}));

afterEach(() => {
  vi.useRealTimers();
});

function harness() {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const notify = vi.fn();
  const setStatus = vi.fn();
  const sendUserMessage = vi.fn();
  const sendMessage = vi.fn();
  const patrol = vi.fn(async (_options: any): Promise<PatrolResult> => ({ outcome: "continue", summary: "Still running" }));
  const emit = vi.fn();
  let idle = true;
  const pi: any = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: (name: string, options: any) => commands.set(name, options),
    registerTool: (options: any) => tools.set(options.name, options),
    sendUserMessage,
    sendMessage,
    events: { emit, on: vi.fn() },
  };
  const ctx: any = {
    hasUI: true,
    mode: "tui",
    cwd: "/project",
    isIdle: () => idle,
    ui: { notify, setStatus },
  };
  setupLoop(pi, patrol);
  return {
    handlers,
    commands,
    tools,
    ctx,
    notify,
    setStatus,
    sendUserMessage,
    sendMessage,
    patrol,
    emit,
    setIdle(value: boolean) { idle = value; },
  };
}

describe("Loop definition", () => {
  it("accepts minute, hour, and day intervals within the supported range", () => {
    expect(parseLoopDefinition("5m check deploy")).toEqual({
      ok: true,
      value: { intervalMs: 300_000, intervalLabel: "5m", prompt: "check deploy" },
    });
    expect(parseLoopDefinition("2H review logs")).toMatchObject({
      ok: true,
      value: { intervalMs: 7_200_000, intervalLabel: "2h" },
    });
    expect(parseLoopDefinition("7d summarize")).toMatchObject({ ok: true });
  });

  it("rejects unsafe or unsupported definitions", () => {
    expect(parseLoopDefinition("30s check")).toMatchObject({ ok: false });
    expect(parseLoopDefinition("8d check")).toMatchObject({ ok: false });
    expect(parseLoopDefinition("5m /loop stop")).toMatchObject({ ok: false });
    expect(parseLoopDefinition("5m")).toMatchObject({ ok: false });
  });

  it("formats displayed times in Beijing time", () => {
    expect(formatBeijingTime(Date.parse("2026-08-04T20:30:00Z")))
      .toBe("2026-08-05 04:30 UTC+8");
    expect(formatBeijingFooterTime(
      Date.parse("2026-08-04T04:30:00Z"),
      Date.parse("2026-08-04T04:00:00Z"),
    )).toBe("12:30");
    expect(formatBeijingFooterTime(
      Date.parse("2026-08-04T16:30:00Z"),
      Date.parse("2026-08-04T15:30:00Z"),
    )).toBe("08-05 00:30");
  });
});

describe("Loop extension", () => {
  it("fires after the interval, exposes status, and stops cleanly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T04:00:00Z"));
    const h = harness();
    h.handlers.get("session_start")!({ reason: "startup" }, h.ctx);

    await h.commands.get("loop").handler("1m check deploy", h.ctx);

    expect(h.setStatus).toHaveBeenLastCalledWith(
      "loop",
      "↻ 1m · 12:01",
    );
    expect(h.notify).toHaveBeenCalledWith(
      "Loop started: every 1m. Next run: 2026-08-04 12:01 UTC+8",
      "info",
    );
    expect(h.emit).toHaveBeenCalledWith(TERMINAL_BACKGROUND_ACTIVITY_EVENT, {
      source: "loop",
      active: true,
    });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(h.patrol).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.patrol).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "check deploy", cwd: "/project",
      patrolModel: "openai-codex/gpt-5.6-luna", patrolThinking: "medium",
    }));
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.setStatus).toHaveBeenLastCalledWith(
      "loop",
      "↻ 1m · 12:02",
    );
    expect(vi.getTimerCount()).toBe(1);

    await h.commands.get("loop").handler("status", h.ctx);
    expect(h.notify).toHaveBeenCalledWith(expect.stringContaining("Prompt: check deploy"), "info");
    expect(h.notify).toHaveBeenCalledWith(expect.stringContaining("Next run: 2026-08-04 12:02 UTC+8"), "info");

    await h.commands.get("loop").handler("stop", h.ctx);
    expect(h.setStatus).toHaveBeenLastCalledWith("loop", undefined);
    expect(h.emit).toHaveBeenLastCalledWith(TERMINAL_BACKGROUND_ACTIVITY_EVENT, {
      source: "loop",
      active: false,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts, inspects, and stops through model-callable tools", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T04:00:00Z"));
    const h = harness();
    h.handlers.get("session_start")!({ reason: "startup" }, h.ctx);
    const prompt = "Check the deploy log at /tmp/deploy.log. Finish when it succeeds.";

    const started = await h.tools.get("loop_start").execute(
      "start",
      { intervalMinutes: 60, prompt, maxRuns: 3, timeoutMinutes: 180,
        patrolModel: "openai/another-model", patrolThinking: "low", probeCommand: "git status --short" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(started.details).toMatchObject({
      active: true,
      intervalLabel: "1h",
      prompt,
      runs: 0,
      maxRuns: 3,
    });
    expect(h.tools.get("loop_start").executionMode).toBe("sequential");
    expect(h.tools.get("loop_status").executionMode).toBe("sequential");
    expect(h.tools.get("loop_stop").executionMode).toBe("sequential");

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(h.patrol).toHaveBeenCalledWith(expect.objectContaining({
      prompt, patrolModel: "openai/another-model", patrolThinking: "low", probeCommand: "git status --short",
    }));

    const status = await h.tools.get("loop_status").execute(
      "status",
      {},
      undefined,
      undefined,
      h.ctx,
    );
    expect(status.details).toMatchObject({ active: true, runs: 1, maxRuns: 3 });
    expect(status.content[0].text).toContain("Runs: 1 / 3");

    const stopped = await h.tools.get("loop_stop").execute(
      "stop",
      { reason: "deploy succeeded" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(stopped.details).toEqual({
      active: false,
      stopped: true,
      reason: "deploy succeeded",
    });
    expect(h.notify).toHaveBeenLastCalledWith("Loop stopped: deploy succeeded", "info");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks while the main model is busy and notifies at maxRuns", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.handlers.get("session_start")!({ reason: "startup" }, h.ctx);
    h.setIdle(false);
    await h.tools.get("loop_start").execute(
      "start",
      { intervalMinutes: 1, prompt: "check deploy", maxRuns: 2 },
      undefined,
      undefined,
      h.ctx,
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.patrol).toHaveBeenCalledTimes(1);
    expect(h.sendMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.patrol).toHaveBeenCalledTimes(2);
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(h.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ customType: "loop-result", display: true,
        content: expect.stringContaining("Check limit reached (2 checks); completion was not confirmed.") }),
      { triggerTurn: true, deliverAs: "followUp" },
    );
    expect(h.setStatus).toHaveBeenLastCalledWith("loop", undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors a timeout before the first scheduled check", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.handlers.get("session_start")!({ reason: "startup" }, h.ctx);
    await h.tools.get("loop_start").execute(
      "start",
      { intervalMinutes: 5, prompt: "check deploy", timeoutMinutes: 2 },
      undefined,
      undefined,
      h.ctx,
    );

    await vi.advanceTimersByTimeAsync(119_999);
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(h.patrol).not.toHaveBeenCalled();
    expect(h.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ content: expect.stringContaining("Time limit reached; completion was not confirmed.") }),
      { triggerTurn: true, deliverAs: "followUp" },
    );
    expect(vi.getTimerCount()).toBe(0);

    const status = await h.tools.get("loop_status").execute(
      "status",
      {},
      undefined,
      undefined,
      h.ctx,
    );
    expect(status.details).toEqual({ active: false });
  });

  it("runs busy ticks silently and discards the timer on session shutdown", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.handlers.get("session_start")!({ reason: "startup" }, h.ctx);
    h.setIdle(false);
    await h.commands.get("loop").handler("1m check deploy", h.ctx);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sendUserMessage).not.toHaveBeenCalled();

    expect(h.patrol).toHaveBeenCalledTimes(1);
    h.setIdle(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.patrol).toHaveBeenCalledTimes(2);
    expect(h.sendMessage).not.toHaveBeenCalled();

    h.handlers.get("session_shutdown")!({ reason: "reload" }, h.ctx);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.setStatus).toHaveBeenLastCalledWith("loop", undefined);
    expect(h.emit).toHaveBeenLastCalledWith(TERMINAL_BACKGROUND_ACTIVITY_EVENT, {
      source: "loop",
      active: false,
    });
  });

  it("cleans the previous session before adopting a replacement context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T04:00:00Z"));
    const h = harness();
    h.handlers.get("session_start")!({ reason: "startup" }, h.ctx);
    await h.commands.get("loop").handler("1m first", h.ctx);

    const replacementSetStatus = vi.fn();
    const replacementCtx = {
      ...h.ctx,
      ui: { ...h.ctx.ui, setStatus: replacementSetStatus },
    };
    h.handlers.get("session_start")!({ reason: "resume" }, replacementCtx);

    expect(vi.getTimerCount()).toBe(0);
    expect(h.setStatus).toHaveBeenLastCalledWith("loop", undefined);
    expect(h.emit).toHaveBeenLastCalledWith(TERMINAL_BACKGROUND_ACTIVITY_EVENT, {
      source: "loop",
      active: false,
    });

    await h.commands.get("loop").handler("2m second", replacementCtx);
    expect(replacementSetStatus).toHaveBeenLastCalledWith(
      "loop",
      "↻ 2m · 12:02",
    );
    h.handlers.get("session_shutdown")!({ reason: "quit" }, replacementCtx);
  });

  it.each(["complete", "alert"] as const)("notifies the main conversation once for %s", async (outcome) => {
    vi.useFakeTimers();
    const h = harness();
    h.patrol.mockResolvedValue({ outcome, summary: "Deploy finished", evidence: "deploy.log: success" });
    h.handlers.get("session_start")!({}, h.ctx);
    // A completion on the last allowed check wins over the count limit.
    await h.tools.get("loop_start").execute("start", { intervalMinutes: 1, prompt: "check deploy", maxRuns: 1 }, undefined, undefined, h.ctx);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(h.patrol).toHaveBeenCalledTimes(1);
    expect(h.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ content: expect.stringContaining(`${outcome === "complete" ? "Completed" : "Needs attention"}: Deploy finished\ndeploy.log: success`) }),
      { triggerTurn: true, deliverAs: "followUp" },
    );
    expect(h.sendMessage.mock.calls[0][0].content).not.toContain("Check limit reached");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops and notifies on a patrol error without retrying", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.patrol.mockRejectedValue(new Error("Provider unavailable"));
    h.handlers.get("session_start")!({}, h.ctx);
    await h.commands.get("loop").handler("1m check deploy", h.ctx);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(h.patrol).toHaveBeenCalledTimes(1);
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.sendMessage.mock.calls[0][0].content).toContain("Monitoring stopped: Provider unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap a slow check and schedules from its completion", async () => {
    vi.useFakeTimers();
    const h = harness();
    let complete!: (result: PatrolResult) => void;
    h.patrol.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    h.handlers.get("session_start")!({}, h.ctx);
    await h.commands.get("loop").handler("1m check deploy", h.ctx);
    await vi.advanceTimersByTimeAsync(150_000);
    expect(h.patrol).toHaveBeenCalledTimes(1);
    complete({ outcome: "continue", summary: "Running" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(h.patrol).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.patrol).toHaveBeenCalledTimes(2);
    h.handlers.get("session_shutdown")!({}, h.ctx);
  });

  it.each(["stop", "shutdown"])("cancels an in-flight check on %s and ignores its late result", async (action) => {
    vi.useFakeTimers();
    const h = harness();
    let complete!: (result: PatrolResult) => void;
    h.patrol.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    h.handlers.get("session_start")!({}, h.ctx);
    await h.commands.get("loop").handler("1m old task", h.ctx);
    await vi.advanceTimersByTimeAsync(60_000);
    const signal = h.patrol.mock.calls[0][0].signal as AbortSignal;
    if (action === "stop") await h.commands.get("loop").handler("stop", h.ctx);
    else h.handlers.get("session_shutdown")!({}, h.ctx);
    expect(signal.aborted).toBe(true);
    if (action === "stop") await h.commands.get("loop").handler("1m new task", h.ctx);
    complete({ outcome: "complete", summary: "Old task completed" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sendMessage).not.toHaveBeenCalled();
    h.handlers.get("session_shutdown")!({}, h.ctx);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, 2])("cancels a stuck check at its deadline (loop timeout: %s)", async (timeoutMinutes) => {
    vi.useFakeTimers();
    const h = harness();
    h.patrol.mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    h.handlers.get("session_start")!({}, h.ctx);
    await h.tools.get("loop_start").execute("start", { intervalMinutes: 1, prompt: "check deploy", timeoutMinutes }, undefined, undefined, h.ctx);
    await vi.advanceTimersByTimeAsync(timeoutMinutes === undefined ? 180_000 : 120_000);
    expect(h.patrol).toHaveBeenCalledTimes(1);
    expect(h.patrol.mock.calls[0][0].signal.aborted).toBe(true);
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.sendMessage.mock.calls[0][0].content).toContain(timeoutMinutes === undefined ? "Loop check timed out" : "Loop time limit reached");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects replacement and non-TUI use", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.handlers.get("session_start")!({ reason: "startup" }, h.ctx);
    await h.commands.get("loop").handler("1m first", h.ctx);
    await h.commands.get("loop").handler("2m second", h.ctx);
    expect(h.notify).toHaveBeenLastCalledWith(expect.stringContaining("already active"), "warning");

    h.handlers.get("session_shutdown")!({ reason: "quit" }, h.ctx);
    const printCtx = { ...h.ctx, hasUI: false, mode: "print" };
    h.handlers.get("session_start")!({ reason: "startup" }, printCtx);
    await h.commands.get("loop").handler("1m hidden", printCtx);
    expect(h.notify).toHaveBeenLastCalledWith(expect.stringContaining("interactive TUI"), "warning");
  });
});
