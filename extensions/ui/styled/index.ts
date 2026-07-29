import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer } from "@earendil-works/pi-tui";
import { STYLED_CONFIG } from "./config.js";
import { createGenericCallRenderer, renderGenericResult } from "./generic-tool-renderer.js";
import {
  createAssistantMessage,
  createCustomMessage,
  createSubagentNotification,
  createThinkingMessage,
  createUserMessage,
} from "./messages.js";
import { isSubagentNotification, isSubagentTool, wrapSubagentResultRenderer } from "./subagent.js";
import { getKnownCallRenderer, getKnownResultRenderer } from "./tool-renderers.js";

const PATCH = Symbol.for("my-pi-package.ui.renderer-patches.v1");
const RUNTIME = Symbol.for("my-pi-package.ui.renderer-runtime.v1");
const TOOL_BASELINE = Symbol.for("my-pi-package.ui.tool-baseline.v1");
const USER_MODE = Symbol.for("my-pi-package.ui.user-mode.v1");
const CUSTOM_MODE = Symbol.for("my-pi-package.ui.custom-mode.v1");

interface RuntimeState {
  active: boolean;
  ui?: ExtensionUIContext;
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
    const theme = runtime().ui?.theme;
    for (let index = 0; index < children.length; index++) {
      const child = children[index] as any;
      if (!isMarkdown(child)) continue;
      const markdown = child as any;
      if (typeof markdown.text !== "string" || !markdown.text) continue;
      children[index] = markdown.defaultTextStyle?.italic
        ? createThinkingMessage(markdown.text, this.markdownTheme, theme)
        : createAssistantMessage(markdown.text, this.markdownTheme, theme);
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
    if (!enabled) return returned;
    const box = this.children?.find((child: any) => Array.isArray(child?.children));
    if (!box?.children) return returned;
    const theme = runtime().ui?.theme;
    for (let index = 0; index < box.children.length; index++) {
      const child = box.children[index] as any;
      if (isMarkdown(child)) {
        const markdown = child as any;
        if (typeof markdown.text === "string") box.children[index] = createUserMessage(markdown.text, this.markdownTheme, theme);
      }
    }
    box.paddingX = 0;
    const currentTheme = runtime().ui?.theme;
    if (currentTheme) box.setBgFn?.((value: string) => currentTheme.bg("userMessageBg" as any, value));
    return returned;
  };
  if (typeof prototype.render === "function") {
    const originalRender = prototype.render;
    prototype.render = function personalUiUserRender(...args: unknown[]) {
      if (this[USER_MODE] !== runtime().active && typeof this.rebuild === "function") this.rebuild();
      return originalRender.apply(this, args);
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
