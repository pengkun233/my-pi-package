import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatBeijingFooterTime,
  formatBeijingTime,
  parseLoopDefinition,
  setupLoop,
} from "../extensions/loop/index.js";
import { TERMINAL_BACKGROUND_ACTIVITY_EVENT } from "../extensions/ui/terminal-status-events.js";

afterEach(() => {
  vi.useRealTimers();
});

function harness() {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const notify = vi.fn();
  const setStatus = vi.fn();
  const sendUserMessage = vi.fn();
  const emit = vi.fn();
  let idle = true;
  const pi: any = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: (name: string, options: any) => commands.set(name, options),
    sendUserMessage,
    events: { emit, on: vi.fn() },
  };
  const ctx: any = {
    hasUI: true,
    mode: "tui",
    isIdle: () => idle,
    ui: { notify, setStatus },
  };
  setupLoop(pi);
  return {
    handlers,
    commands,
    ctx,
    notify,
    setStatus,
    sendUserMessage,
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
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sendUserMessage).toHaveBeenCalledWith("check deploy");
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

  it("skips a busy tick and discards the timer on session shutdown", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.handlers.get("session_start")!({ reason: "startup" }, h.ctx);
    h.setIdle(false);
    await h.commands.get("loop").handler("1m check deploy", h.ctx);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sendUserMessage).not.toHaveBeenCalled();

    h.setIdle(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sendUserMessage).toHaveBeenCalledTimes(1);

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
