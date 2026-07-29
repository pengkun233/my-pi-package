import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Box,
  Markdown,
  Text,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";

const SUBAGENT_RESULT = Symbol.for("my-pi-package.ui.subagent-result.v1");
const SUBAGENT_MARKDOWN = Symbol.for("my-pi-package.ui.subagent-markdown.v1");
const WIDGET_RUNTIME = Symbol.for("my-pi-package.ui.subagent-widget-runtime.v1");
const WIDGET_FACTORY = Symbol.for("my-pi-package.ui.subagent-widget-factory.v1");

const SUBAGENT_WIDGET_KEYS = new Set([
  "subagent-fleet-status",
  "subagent-async",
]);

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type Renderer = (...args: any[]) => Component;
type WidgetFactory = (tui: any, theme: Theme) => Component & { dispose?(): void };
type SetWidget = ExtensionUIContext["setWidget"];

interface WidgetRuntime {
  active: boolean;
  original: SetWidget;
  patched?: SetWidget;
  shells: Set<SubagentWidgetShell>;
}

function fg(theme: Theme, token: string, value: string): string {
  try { return theme.fg(token as any, value); } catch { return value; }
}

function bold(theme: Theme, value: string): string {
  try { return theme.bold(value); } catch { return value; }
}

function isMarkdown(value: any): boolean {
  return value instanceof Markdown || value?.constructor?.name === "Markdown";
}

class InsetMarkdown implements Component {
  readonly [SUBAGENT_MARKDOWN] = true;

  constructor(readonly source: Component) {}

  invalidate(): void { this.source.invalidate(); }

  render(width: number): string[] {
    const inset = width >= 12 ? 3 : 0;
    const lines = this.source.render(Math.max(1, width - inset));
    if (!inset) return lines.map((line) => truncateToWidth(line, width, ""));
    const prefix = " ".repeat(inset);
    return lines.map((line) => truncateToWidth(`${prefix}${line}`, width, ""));
  }
}

/**
 * Subagent owns the semantic renderer. Pikit only replaces Markdown leaves with
 * a width-aware gutter so fenced output follows the same rhythm as assistant
 * messages. The traversal deliberately knows nothing about pi-subagents types.
 */
function normalizeMarkdownTree(component: any, seen = new Set<unknown>()): void {
  if (!component || typeof component !== "object" || seen.has(component)) return;
  seen.add(component);
  const children = component.children;
  if (!Array.isArray(children)) return;
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (child?.[SUBAGENT_MARKDOWN]) continue;
    if (isMarkdown(child)) {
      children[index] = new InsetMarkdown(child);
      continue;
    }
    normalizeMarkdownTree(child, seen);
  }
}

class SubagentResultComponent implements Component {
  readonly [SUBAGENT_RESULT] = true;

  constructor(readonly source: Component) {
    normalizeMarkdownTree(source);
  }

  invalidate(): void {
    this.source.invalidate();
    normalizeMarkdownTree(this.source);
  }

  render(width: number): string[] {
    normalizeMarkdownTree(this.source);
    return this.source.render(width).map((line) => truncateToWidth(line, width, ""));
  }
}

export function wrapSubagentResultRenderer(renderer: Renderer): Renderer {
  return (...args: any[]) => {
    const context = args[3];
    const prior = context?.lastComponent;
    if (prior?.[SUBAGENT_RESULT] && context) {
      args[3] = { ...context, lastComponent: prior.source };
    }
    const source = renderer(...args);
    if ((source as any)?.[SUBAGENT_RESULT]) return source;
    return new SubagentResultComponent(source);
  };
}

export function isSubagentTool(name: unknown): boolean {
  return String(name) === "subagent";
}

export function isSubagentNotification(message: unknown): boolean {
  return (message as { customType?: unknown } | undefined)?.customType === "subagent-notify";
}

function widgetTitle(key: string): string {
  return key === "subagent-fleet-status" ? "Subagent" : "Async subagents";
}

class SubagentWidgetShell implements Component {
  wantsKeyRelease?: boolean;

  constructor(
    private readonly runtime: WidgetRuntime,
    private readonly key: string,
    private readonly source: Component & { dispose?(): void },
    private readonly tui: { requestRender?(): void },
    private readonly theme: Theme,
  ) {
    this.wantsKeyRelease = source.wantsKeyRelease;
  }

  requestRender(): void { this.tui.requestRender?.(); }
  invalidate(): void { this.source.invalidate(); }
  handleInput(data: string): void { this.source.handleInput?.(data); }
  dispose(): void {
    this.runtime.shells.delete(this);
    this.source.dispose?.();
  }

  render(width: number): string[] {
    // Once disabled the adapter is logically absent; the owning widget resumes
    // responsibility for Pi's normal width contract without Pikit mutation.
    if (!this.runtime.active) return this.source.render(width);
    const frame = SPINNER_FRAMES[Math.floor(Date.now() / 100) % SPINNER_FRAMES.length]!;
    const header = `${fg(this.theme, "accent", frame)} ${fg(this.theme, "toolTitle", bold(this.theme, widgetTitle(this.key)))} ${fg(this.theme, "dim", "· running")}`;
    const body: Component = {
      invalidate: () => this.source.invalidate(),
      render: (innerWidth: number) => [
        truncateToWidth(header, innerWidth, ""),
        ...this.source.render(innerWidth).map((line) => truncateToWidth(line, innerWidth, "")),
      ],
    };
    const box = new Box(1, 0, (value: string) => this.theme.bg("toolPendingBg" as any, value));
    box.addChild(body);
    if (width <= 0) return [];
    return box.render(width).map((line) => truncateToWidth(line, width, ""));
  }
}

function wrapWidgetFactory(runtime: WidgetRuntime, key: string, factory: WidgetFactory): WidgetFactory {
  if ((factory as any)[WIDGET_FACTORY]) return factory;
  const wrapped: WidgetFactory = (tui, theme) => {
    const shell = new SubagentWidgetShell(runtime, key, factory(tui, theme), tui, theme);
    runtime.shells.add(shell);
    return shell;
  };
  (wrapped as any)[WIDGET_FACTORY] = true;
  return wrapped;
}

/**
 * Pi has no widget getter or renderer middleware. This reversible method wrapper
 * targets only pi-subagents' stable widget keys and forwards the original
 * component lifecycle and keyboard behavior unchanged.
 */
export function installSubagentWidgetAdapter(ui: ExtensionUIContext): () => void {
  const target = ui as ExtensionUIContext & { [WIDGET_RUNTIME]?: WidgetRuntime };
  let state = target[WIDGET_RUNTIME];
  if (!state) {
    state = { active: false, original: ui.setWidget, shells: new Set() };
    target[WIDGET_RUNTIME] = state;
  }
  state.active = true;
  const runtime = state;
  const patched = function (this: ExtensionUIContext, key: string, content: string[] | WidgetFactory | undefined, options?: unknown): void {
    const adapted = runtime.active && SUBAGENT_WIDGET_KEYS.has(key) && typeof content === "function"
      ? wrapWidgetFactory(runtime, key, content)
      : content;
    (runtime.original as any).call(this, key, adapted, options);
  } as SetWidget;
  state.patched = patched;

  try { ui.setWidget = patched; } catch { return () => { state!.active = false; }; }
  for (const shell of state.shells) shell.requestRender();

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    runtime.active = false;
    if (ui.setWidget === patched) ui.setWidget = runtime.original;
    for (const shell of runtime.shells) shell.requestRender();
  };
}
