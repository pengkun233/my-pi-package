import { describe, expect, it, vi } from "vitest";
import { UiController } from "../extensions/ui/controller.js";
import type { UiInstaller } from "../extensions/ui/types.js";

function harness(hasUI = true, timedFeature = false) {
  const priorEditor = vi.fn() as any;
  const calls: Array<[string, unknown?]> = [];
  const ui: any = {
    theme: { name: "native", fg: (_t: string, s: string) => s, bg: (_t: string, s: string) => s },
    notify: (message: string, type: string) => calls.push([`notify:${type}`, message]),
    getEditorComponent: () => priorEditor,
    setEditorComponent: (value: any) => calls.push(["editor", value]),
    getTheme: vi.fn(),
    setTheme: vi.fn(),
    setFooter: (value: any) => calls.push(["footer", value]),
    setHeader: (value: any) => calls.push(["header", value]),
    setWorkingMessage: (value?: string) => calls.push(["working", value]),
    setWorkingVisible: (value: boolean) => calls.push(["visible", value]),
    setWorkingIndicator: (value?: unknown) => calls.push(["indicator", value]),
    setHiddenThinkingLabel: (value?: string) => calls.push(["label", value]),
  };
  let installs = 0;
  let disposes = 0;
  const installer: UiInstaller = {
    install: (_ctx, active) => {
      installs += 1;
      expect(active()).toBe(true);
      const timer = timedFeature ? setInterval(() => {}, 100) : undefined;
      return { dispose: () => { if (timer !== undefined) clearInterval(timer); disposes += 1; } };
    },
    setStyledActive: (value) => calls.push(["styled", value]),
  };
  const ctx: any = { hasUI, mode: hasUI ? "tui" : "print", ui, cwd: "/tmp" };
  return {
    controller: new UiController(installer), ctx, calls, priorEditor, ui,
    get installs() { return installs; },
    get disposes() { return disposes; },
  };
}

describe("always-on UI controller", () => {
  it("installs on session start without reading state or switching themes", () => {
    const h = harness();

    expect(h.controller.sessionStart(h.ctx)).toEqual({ ok: true, message: "UI installed." });

    expect(h.controller.isActive()).toBe(true);
    expect(h.installs).toBe(1);
    expect(h.ui.getTheme).not.toHaveBeenCalled();
    expect(h.ui.setTheme).not.toHaveBeenCalled();
  });

  it("restarts idempotently and cleans every owned surface on shutdown or reload", () => {
    const h = harness();
    h.controller.sessionStart(h.ctx);
    h.controller.sessionStart(h.ctx);
    expect(h.installs).toBe(2);
    expect(h.disposes).toBe(1);

    h.controller.sessionShutdown();

    expect(h.disposes).toBe(2);
    expect(h.controller.isActive()).toBe(false);
    expect(h.calls).toContainEqual(["editor", h.priorEditor]);
    expect(h.calls).toContainEqual(["footer", undefined]);
    expect(h.calls).toContainEqual(["header", undefined]);
    expect(h.calls).toContainEqual(["visible", true]);
    expect(h.calls).toContainEqual(["styled", false]);
    expect(h.ui.setTheme).not.toHaveBeenCalled();
  });

  it("does not install TUI components in non-interactive modes", () => {
    const h = harness(false);
    expect(h.controller.sessionStart(h.ctx).ok).toBe(true);
    expect(h.installs).toBe(0);
    expect(h.controller.isActive()).toBe(false);
  });

  it("disposes animation resources during shutdown", () => {
    vi.useFakeTimers();
    const h = harness(true, true);
    h.controller.sessionStart(h.ctx);
    expect(vi.getTimerCount()).toBe(1);
    h.controller.sessionShutdown();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
