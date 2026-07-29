import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpinnerService } from "../extensions/ui/spinner.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function context(hasUI = true) {
  const calls: Array<[string, unknown?]> = [];
  const ctx: any = {
    hasUI,
    ui: {
      theme: { fg: (_token: string, text: string) => text },
      setHiddenThinkingLabel: (value?: string) => calls.push(["label", value]),
      setWorkingVisible: (value: boolean) => calls.push(["visible", value]),
      setWorkingIndicator: (value?: unknown) => calls.push(["indicator", value]),
      setWorkingMessage: (value?: string) => calls.push(["message", value]),
    },
  };
  return { ctx, calls };
}

describe("spinner lifecycle", () => {
  it("tracks estimated text and disposes every timer/default override", () => {
    const { ctx, calls } = context();
    const spinner = new SpinnerService(ctx, () => true);
    spinner.install();
    spinner.onTurnStart();
    spinner.onMessageUpdate({ assistantMessageEvent: { type: "text_delta", delta: "x".repeat(40) } });
    expect(calls.some(([name, value]) => name === "message" && String(value).includes("≈10 tokens"))).toBe(true);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    spinner.onTurnEnd();
    expect(vi.getTimerCount()).toBe(0);
    expect(calls).toContainEqual(["message", undefined]);
    expect(calls).toContainEqual(["indicator", undefined]);
    expect(calls).toContainEqual(["label", undefined]);
    spinner.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing without UI", () => {
    const { ctx, calls } = context(false);
    const spinner = new SpinnerService(ctx, () => true);
    spinner.install();
    spinner.onTurnStart();
    expect(calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
