// Adapted from adrianapan/pikit's MIT-licensed chat-input extension.
import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { UiContext } from "./types.js";
import {
  CHAT_INPUT_CONFIG,
  COMPANION_PADDING,
  MIN_WIDTH_FOR_COMPANION,
  type ChatInputConfig,
} from "./chat-input-config.js";
import {
  applyColor,
  canRenderChatInput,
  chatInputContentWidth,
  CompanionAnimator,
  renderChatInputLines,
  selectInputStyle,
  type InputStyles,
} from "./chat-input-utils.js";

export class ChatInput extends CustomEditor {
  private readonly animator = new CompanionAnimator();
  private companionTimer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly styles: InputStyles,
    private readonly config: Readonly<ChatInputConfig> = CHAT_INPUT_CONFIG,
    private readonly companionColor: (text: string) => string = (text) => text,
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
    if (config.companion.enabled) {
      this.companionTimer = setInterval(() => {
        if (this.disposed) return;
        this.animator.tick(Date.now());
        this.tui.requestRender();
      }, 100);
    }
  }

  private isBashMode(): boolean {
    return this.getText().trimStart().startsWith("!");
  }

  private buildCompanionLines(width: number): string[] {
    if (!this.config.companion.enabled || width < MIN_WIDTH_FOR_COMPANION) return [];
    const state = this.animator.getState();
    const artWidth = Math.max(...state.lines.map((line) => visibleWidth(line)), 0);
    const rawPadding = width - COMPANION_PADDING - artWidth + state.extraPad;
    const padding = Math.max(0, Math.min(rawPadding, width - artWidth));
    const lines = state.lines.map((line) => " ".repeat(padding) + this.companionColor(line));
    while (lines.length < this.config.companionTopPadding) lines.unshift("");
    return lines;
  }

  render(width: number): string[] {
    const selected = selectInputStyle(this.config, this.styles, this.isBashMode());
    const padMultiplier = this.config.boxedView ? 3 : 1;
    const contentWidth = chatInputContentWidth(width, selected.prefix, this.config);
    if (width < 5 + this.config.boxPadX * padMultiplier || contentWidth < 1) return super.render(width);
    const stock = super.render(contentWidth);
    if (!canRenderChatInput(stock, width, selected.prefix, this.config)) return super.render(width);

    return renderChatInputLines(
      stock,
      width,
      selected.prefix,
      selected.colors,
      this.config,
      this.buildCompanionLines(width),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.companionTimer !== undefined) clearInterval(this.companionTimer);
    this.companionTimer = undefined;
  }
}

function color(ctx: UiContext, token: string): (text: string) => string {
  return (text) => applyColor(ctx.ui.theme, token, text);
}

export interface EditorFeature {
  factory(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager): ChatInput;
  dispose(): void;
}

export function createEditorFeature(
  ctx: UiContext,
  config: Readonly<ChatInputConfig> = CHAT_INPUT_CONFIG,
): EditorFeature {
  const editors = new Set<ChatInput>();
  let disposed = false;
  return {
    factory(tui, theme, keybindings) {
      const styles: InputStyles = {
        normal: { border: color(ctx, config.borderColor), accent: color(ctx, config.prefixColor) },
        bash: { border: color(ctx, "bashMode"), accent: color(ctx, "bashMode") },
      };
      const editor = new ChatInput(
        tui,
        theme,
        keybindings,
        styles,
        config,
        color(ctx, config.companion.color),
      );
      if (disposed) editor.dispose();
      else editors.add(editor);
      return editor;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const editor of editors) editor.dispose();
      editors.clear();
    },
  };
}

export function createEditorFactory(ctx: UiContext) {
  return createEditorFeature(ctx).factory;
}
