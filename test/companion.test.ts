import { describe, expect, it, vi } from "vitest";
import { ChatInput, createEditorFeature } from "../extensions/ui/chat-input.js";
import { DEFAULT_CHAT_INPUT_CONFIG, type ChatInputConfig } from "../extensions/ui/chat-input-config.js";
import { CompanionAnimator } from "../extensions/ui/chat-input-utils.js";

const identity = (text: string) => text;
const styles = {
  normal: { border: identity, accent: identity },
  bash: { border: identity, accent: identity },
};

function config(enabled: boolean): ChatInputConfig {
  return {
    ...DEFAULT_CHAT_INPUT_CONFIG,
    companion: { ...DEFAULT_CHAT_INPUT_CONFIG.companion, enabled },
  };
}

function editor(enabled: boolean): ChatInput {
  return new ChatInput(
    { requestRender: vi.fn() } as any,
    {} as any,
    {} as any,
    styles,
    config(enabled),
  );
}

describe("companion animation", () => {
  it("moves through observable face, ears, and face states", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const animator = new CompanionAnimator();
    animator.tick(1_000);
    expect(animator.getState().lines).toHaveLength(2);

    random.mockReturnValue(0.01);
    animator.tick(100_000);
    animator.tick(100_100);
    animator.tick(100_200);
    expect(animator.getState().lines).toHaveLength(1);

    random.mockReturnValue(0.99);
    animator.tick(200_000);
    random.mockReturnValue(0.8);
    animator.tick(200_100);
    expect(animator.getState().lines).toHaveLength(2);
    random.mockRestore();
  });

  it("starts animation only when enabled and clears its timer on dispose", () => {
    vi.useFakeTimers();
    const interval = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");

    const disabled = editor(false);
    expect(interval).not.toHaveBeenCalled();
    disabled.dispose();

    const enabled = editor(true);
    expect(interval).toHaveBeenCalledTimes(1);
    enabled.dispose();
    expect(clear).toHaveBeenCalledTimes(1);

    interval.mockRestore();
    clear.mockRestore();
    vi.useRealTimers();
  });

  it("disposes every editor instance created by the feature factory", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearInterval");
    const feature = createEditorFeature(
      { ui: { theme: { fg: (_token: string, text: string) => text } } } as any,
      config(true),
    );

    feature.factory({ requestRender: vi.fn() } as any, {} as any, {} as any);
    feature.factory({ requestRender: vi.fn() } as any, {} as any, {} as any);
    feature.dispose();
    feature.dispose();

    expect(clear).toHaveBeenCalledTimes(2);
    clear.mockRestore();
    vi.useRealTimers();
  });
});
