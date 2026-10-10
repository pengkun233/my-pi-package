import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer, truncateToWidth } from "@earendil-works/pi-tui";
import { DEFAULT_STYLED_MESSAGES_CONFIG, loadStyledMessagesConfig, STYLED_CONFIG, type StyledMessagesConfig } from "./config.js";
import { createGenericCallRenderer, renderGenericResult } from "./generic-tool-renderer.js";
import {
  createCustomMessage,
  createSubagentNotification,
  decorateNativeMessage,
} from "./messages.js";
import { isSubagentNotification, isSubagentTool, wrapSubagentResultRenderer } from "./subagent.js";
import { getKnownCallRenderer, getKnownResultRenderer } from "./tool-renderers.js";

const PATCH = Symbol.for("my-pi-package.ui.renderer-patches.v1");
const RUNTIME = Symbol.for("my-pi-package.ui.renderer-runtime.v1");
const TOOL_BASELINE = Symbol.for("my-pi-package.ui.tool-baseline.v1");
const USER_MODE = Symbol.for("my-pi-package.ui.user-mode.v1");
const USER_CONFIG = Symbol.for("my-pi-package.ui.user-config.v1");
const CUSTOM_MODE = Symbol.for("my-pi-package.ui.custom-mode.v1");

interface RuntimeState {
  active: boolean;
  ui?: ExtensionUIContext;
  messages?: StyledMessagesConfig;
}

function runtime(): RuntimeState {
  const root = globalThis as any;
  return root[RUNTIME] ??= { active: false };
}

function isMarkdown(value: any): boolean {
  // pi-coding-agent may carry its own pi-tui installation, so instanceof
  // alone is not reliable across package boundaries.
  return value instanceof Markdown || value?.constructor?.name === "Markdown";
}

export function isStyledActive(): boolean { return runtime().active; }

export function setStyledActive(value: boolean, ui?: ExtensionUIContext): void {
  const state = runtime();
  state.active = value;
  state.ui = value ? ui : undefined;
  if (value) state.messages = loadStyledMessagesConfig();
}

function messageStyle(kind: keyof StyledMessagesConfig) {
  const state = runtime();
  if (!state.active) return undefined;
  const config = state.messages ?? DEFAULT_STYLED_MESSAGES_CONFIG;
  return {
    ...config[kind],
    isThemeBackgroundVisible: kind === "userMessage" ? config.userMessage.isThemeBackgroundVisible : undefined,
    theme: state.ui?.theme,
    fallbackColor: DEFAULT_STYLED_MESSAGES_CONFIG[kind].prefixColor,
  };
}

function patchAssistant(): void {
  const prototype = AssistantMessageComponent?.prototype as any;
  if (!prototype || prototype[PATCH] || typeof prototype.updateContent !== "function") return;
  const original = prototype.updateContent;
  prototype.updateContent = function personalUiAssistantUpdate(...args: unknown[]) {
    const returned = original.apply(this, args);
    if (!runtime().active) return returned;
    const children = this.contentContainer?.children;
    if (!Array.isArray(children)) return returned;
    for (const child of children) {
      if (isMarkdown(child)) {
        const kind = child.defaultTextStyle?.italic ? "thinkingMessage" : "assistantMessage";
        decorateNativeMessage(child, () => messageStyle(kind));
      } else if (child?.constructor?.name === "MouseRegion" && child.child) {
        // Pi 1.1.0 wraps both expanded Markdown and collapsed Text. Keep the
        // region and callback intact so left-click still toggles thinking.
        if (isMarkdown(child.child) || child.child.constructor?.name === "Text") {
          decorateNativeMessage(child.child, () => messageStyle("thinkingMessage"));
        }
      }
    }
    return returned;
  };
  prototype[PATCH] = true;
}

function patchUser(): void {
  const prototype = UserMessageComponent?.prototype as any;
  if (!prototype || prototype[PATCH] || typeof prototype.rebuild !== "function") return;
  const originalRebuild = prototype.rebuild;
  prototype.rebuild = function personalUiUserRebuild(...args: unknown[]) {
    const returned = originalRebuild.apply(this, args);
    const enabled = runtime().active;
    this[USER_MODE] = enabled;
    this[USER_CONFIG] = runtime().messages;
    if (!enabled) return returned;
    for (const child of this.children ?? []) {
      if (isMarkdown(child)) {
        // Pi 1.1.0: Markdown owns its padding and user background.
        decorateNativeMessage(child, () => messageStyle("userMessage"));
      } else if (child?.constructor?.name === "Box" && Array.isArray(child.children)) {
        // Pi 0.82.1: the outer Box owns padding/background. Do not zero outputPad.
        for (const markdown of child.children) {
          if (isMarkdown(markdown)) decorateNativeMessage(markdown, () => messageStyle("userMessage"));
        }
        if (messageStyle("userMessage")?.isThemeBackgroundVisible === false) child.setBgFn?.(undefined);
      }
    }
    return returned;
  };
  if (typeof prototype.render === "function") {
    const originalRender = prototype.render;
    prototype.render = function personalUiUserRender(...args: unknown[]) {
      if ((this[USER_MODE] !== runtime().active || this[USER_CONFIG] !== runtime().messages)
        && typeof this.rebuild === "function") this.rebuild();
      const lines = originalRender.apply(this, args);
      // Legacy Box without a background can exceed tiny widths with outputPad.
      return runtime().active && typeof args[0] === "number"
        ? lines.map((line: string) => truncateToWidth(line, Math.max(0, args[0] as number), "")) : lines;
    };
  }
  prototype[PATCH] = true;
}

function patchCustom(): void {
  const prototype = CustomMessageComponent?.prototype as any;
  if (!prototype || prototype[PATCH] || typeof prototype.rebuild !== "function") return;
  const originalRebuild = prototype.rebuild;
  prototype.rebuild = function personalUiCustomRebuild(...args: unknown[]) {
    if (this.customRenderer && !isSubagentNotification(this.message)) {
      return originalRebuild.apply(this, args);
    }
    if (!runtime().active) {
      if (this[CUSTOM_MODE]) {
        this.clear?.();
        this.addChild?.(new Spacer(1));
      }
      this[CUSTOM_MODE] = false;
      return originalRebuild.apply(this, args);
    }
    this[CUSTOM_MODE] = true;
    const component = isSubagentNotification(this.message)
      ? createSubagentNotification(this.message, this.markdownTheme, runtime().ui?.theme)
      : createCustomMessage(this.message, this.markdownTheme, runtime().ui?.theme);
    component.setExpanded(!!this._expanded);
    this.clear?.();
    this.addChild?.(component);
    return undefined;
  };
  if (typeof prototype.render === "function") {
    const originalRender = prototype.render;
    prototype.render = function personalUiCustomRender(...args: unknown[]) {
      if (this.customRenderer && !isSubagentNotification(this.message)) {
        return originalRender.apply(this, args);
      }
      if (this[CUSTOM_MODE] !== runtime().active && typeof this.rebuild === "function") this.rebuild();
      return originalRender.apply(this, args);
    };
  }
  prototype[PATCH] = true;
}

function patchTools(): void {
  const prototype = ToolExecutionComponent?.prototype as any;
  if (!prototype || prototype[PATCH]) return;

  if (typeof prototype.updateDisplay === "function") {
    const original = prototype.updateDisplay;
    prototype.updateDisplay = function personalUiToolDisplay(...args: unknown[]) {
      const beforeBg = this.contentBox?.bgFn;
      const returned = original.apply(this, args);
      const box = this.contentBox;
      if (!box) return returned;
      if (runtime().active) {
        this[TOOL_BASELINE] ??= { paddingX: box.paddingX, paddingY: box.paddingY, bgFn: beforeBg };
        box.paddingX = STYLED_CONFIG.horizontalPadding;
        box.paddingY = STYLED_CONFIG.verticalPadding;
        if (STYLED_CONFIG.showBackground && runtime().ui) {
          const theme = runtime().ui!.theme;
          const token = this.isPartial ? "toolPendingBg" : this.result?.isError ? "toolErrorBg" : "toolSuccessBg";
          box.setBgFn?.((value: string) => theme.bg(token as any, value));
        }
      } else if (this[TOOL_BASELINE]) {
        // The original update above rebuilt the status background with the current
        // runtime theme. Restore only padding so a stale captured bg function can
        // never overwrite it after reload/theme changes.
        box.paddingX = this[TOOL_BASELINE].paddingX;
        box.paddingY = this[TOOL_BASELINE].paddingY;
        if (box.bgFn === beforeBg) box.setBgFn?.(this[TOOL_BASELINE].bgFn);
        delete this[TOOL_BASELINE];
      }
      return returned;
    };
  }

  if (typeof prototype.getCallRenderer === "function") {
    const original = prototype.getCallRenderer;
    prototype.getCallRenderer = function personalUiCallRenderer(...args: unknown[]) {
      const existing = original.apply(this, args);
      if (!runtime().active) return existing;
      return getKnownCallRenderer(this.toolName) ?? existing ?? createGenericCallRenderer(String(this.toolDefinition?.label ?? this.toolName ?? "Tool"));
    };
  }

  if (typeof prototype.getResultRenderer === "function") {
    const original = prototype.getResultRenderer;
    prototype.getResultRenderer = function personalUiResultRenderer(...args: unknown[]) {
      const existing = original.apply(this, args);
      if (!runtime().active) return existing;
      if (isSubagentTool(this.toolName) && existing) return wrapSubagentResultRenderer(existing);
      return getKnownResultRenderer(this.toolName) ?? existing ?? renderGenericResult;
    };
  }
  prototype[PATCH] = true;
}

export function installStyledPatches(): void {
  // Every internal is optional: unsupported Pi versions retain stock rendering.
  try { patchAssistant(); } catch {}
  try { patchUser(); } catch {}
  try { patchCustom(); } catch {}
  try { patchTools(); } catch {}
}
