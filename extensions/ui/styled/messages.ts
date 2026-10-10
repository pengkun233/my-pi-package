import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { Box, Markdown, sliceByColumn, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_STYLED_MESSAGES_CONFIG, type MessageStyle } from "./config.js";

function fg(theme: Theme | undefined, token: string, text: string): string {
  try { return theme ? theme.fg(token as any, text) : text; } catch { return text; }
}

interface NativeMessageStyle extends MessageStyle {
  theme?: Theme;
  fallbackColor: string;
  isThemeBackgroundVisible?: boolean;
}

const DECORATED = Symbol.for("my-pi-package.ui.message-decoration.v1");

/** Decorate the instance, never replace it: options, transform, padding and mouse handlers remain native. */
export function decorateNativeMessage(component: any, resolveStyle: () => NativeMessageStyle | undefined): void {
  if (component[DECORATED] || typeof component.render !== "function") return;
  const originalRender = component.render;
  const nativeTextStyle = component.defaultTextStyle;
  const withoutBackground = nativeTextStyle ? { ...nativeTextStyle, bgColor: undefined } : undefined;
  component.render = function styledNativeMessageRender(width: number): string[] {
    if (width <= 0) return [];
    const style = resolveStyle();
    const textStyle = style?.isThemeBackgroundVisible === false ? withoutBackground : nativeTextStyle;
    if (this.defaultTextStyle !== textStyle) {
      this.defaultTextStyle = textStyle;
      this.invalidate?.();
    }
    // Empty prefix is exactly native layout, not a phantom symbol gutter.
    if (!style?.prefix) return originalRender.call(this, width);
    const gutter = visibleWidth(style.prefix) + 1;
    const inset = Math.max(0, this.paddingX ?? 0);
    const nativeWidth = Math.max(1, width - gutter);
    const lines: string[] = originalRender.call(this, nativeWidth);
    let placed = false;
    let coloredPrefix: string;
    try { coloredPrefix = style.theme ? style.theme.fg(style.prefixColor as any, style.prefix) : style.prefix; }
    catch { coloredPrefix = fg(style.theme, style.fallbackColor, style.prefix); }
    return lines.map((line) => {
      // Terminal image protocol lines must not be sliced or prefixed.
      if (line.includes("\x1b_G") || line.includes("\x1b]1337;File=")) return line;
      const useful = stripVTControlCharacters(line).trim().length > 0;
      const marker = !placed && useful ? `${coloredPrefix} ` : " ".repeat(gutter);
      if (useful) placed = true;
      const left = sliceByColumn(line, 0, inset);
      const body = sliceByColumn(line, inset, Math.max(0, visibleWidth(line) - inset));
      const bg = this.defaultTextStyle?.bgColor;
      return truncateToWidth(`${left}${bg ? bg(marker) : marker}${body}`, width, "");
    });
  };
  component[DECORATED] = true;
}

function prefixedMarkdown(text: string, markdownTheme: any, style: MessageStyle, theme?: Theme, bodyToken?: string, italic = false) {
  const markdown = new Markdown(text, 1, 0, markdownTheme, bodyToken ? {
    color: (value: string) => fg(theme, bodyToken, value), italic,
  } : undefined);
  decorateNativeMessage(markdown, () => ({ ...style, fallbackColor: style.prefixColor, theme }));
  return markdown;
}

export function createAssistantMessage(text: string, markdownTheme: any, theme?: Theme) {
  return prefixedMarkdown(text, markdownTheme, DEFAULT_STYLED_MESSAGES_CONFIG.assistantMessage, theme);
}

export function createThinkingMessage(text: string, markdownTheme: any, theme?: Theme) {
  return prefixedMarkdown(text, markdownTheme, DEFAULT_STYLED_MESSAGES_CONFIG.thinkingMessage, theme, "dim", true);
}

export function createUserMessage(text: string, markdownTheme: any, theme?: Theme) {
  return prefixedMarkdown(text, markdownTheme, DEFAULT_STYLED_MESSAGES_CONFIG.userMessage, theme, "text");
}

interface SubagentNotificationView {
  status: "completed" | "failed" | "paused";
  label: string;
  body: string;
  summary: string;
  durationMs?: number;
}

function notificationText(message: any): string {
  return typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n")
      : "";
}

function firstUsefulNotificationLine(body: string): string {
  return body.split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/^\d+\.\s+/.test(line) && !/^(Session|Session file|Parallel handoff):/i.test(line))
    ?? "(no output)";
}

function parseSubagentNotification(message: any): SubagentNotificationView {
  const content = notificationText(message);
  const lines = content.split("\n");
  const first = lines[0]?.trim() ?? "";
  const details = message?.details as {
    agent?: unknown;
    status?: unknown;
    resultPreview?: unknown;
    durationMs?: unknown;
  } | undefined;
  const grouped = first.match(/^Background tasks completed \((\d+)\):/i);
  const single = first.match(/^(?:Background task|Detached foreground task) (completed|failed|paused): \*\*(.+?)\*\*/i);
  const status = details?.status === "failed" || details?.status === "paused" || details?.status === "completed"
    ? details.status
    : single?.[1] === "failed" || single?.[1] === "paused"
      ? single[1]
      : "completed";
  const label = grouped
    ? `parallel (${grouped[1]})`
    : typeof details?.agent === "string" && details.agent.trim()
      ? details.agent.trim()
      : single?.[2] ?? "subagent";
  const body = lines.slice(1).join("\n").trim() || (typeof details?.resultPreview === "string" ? details.resultPreview.trim() : "");
  const summarySource = typeof details?.resultPreview === "string" && details.resultPreview.trim()
    ? details.resultPreview
    : body;
  return {
    status,
    label,
    body: body || "(no output)",
    summary: firstUsefulNotificationLine(summarySource),
    durationMs: typeof details?.durationMs === "number" ? details.durationMs : undefined,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function createSubagentNotification(message: any, markdownTheme: any, theme?: Theme) {
  const view = parseSubagentNotification(message);
  const markdown = new Markdown(view.body, 0, 0, markdownTheme);
  const box = new Box(1, 0, (value: string) => {
    const token = view.status === "failed" ? "toolErrorBg" : view.status === "paused" ? "toolPendingBg" : "toolSuccessBg";
    try { return theme ? theme.bg(token as any, value) : value; } catch { return value; }
  });
  let expanded = false;

  const rebuild = () => {
    box.clear();
    const glyph = view.status === "failed" ? "✗" : view.status === "paused" ? "■" : "✓";
    const glyphToken = view.status === "failed" ? "error" : view.status === "paused" ? "warning" : "success";
    const title = theme ? theme.bold("Subagent") : "Subagent";
    box.addChild(new Text(`${fg(theme, glyphToken, glyph)} ${fg(theme, "toolTitle", title)} ${fg(theme, "dim", view.label)}`, 0, 0));
    const status = view.status === "completed" ? "Completed" : view.status === "failed" ? "Failed" : "Paused";
    const duration = view.durationMs === undefined ? "" : ` ${fg(theme, "dim", `· ${formatDuration(view.durationMs)}`)}`;
    box.addChild(new Text(`${fg(theme, "separator", "└─")} ${fg(theme, glyphToken, status)}${duration}`, 0, 0));
    if (!expanded) {
      box.addChild(new Text(`   ${fg(theme, "dim", view.summary)} ${fg(theme, "dim", "· expand to view")}`, 0, 0));
      return;
    }
    box.addChild({
      invalidate: () => markdown.invalidate(),
      render(width: number): string[] {
        const inset = width >= 12 ? 3 : 0;
        return markdown.render(Math.max(1, width - inset))
          .map((line) => truncateToWidth(`${" ".repeat(inset)}${line}`, width, ""));
      },
    });
  };

  rebuild();
  return {
    setExpanded(value: boolean) { if (expanded !== value) { expanded = value; markdown.invalidate(); rebuild(); } },
    invalidate() { markdown.invalidate(); box.invalidate(); rebuild(); },
    render(width: number): string[] {
      if (width <= 0) return [];
      return box.render(width).map((line) => truncateToWidth(line, width, ""));
    },
  };
}

export function createCustomMessage(message: any, markdownTheme: any, theme?: Theme) {
  const content = typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n")
      : "";
  const markdown = new Markdown(content, 0, 0, markdownTheme);
  let expanded = false;
  return {
    setExpanded(value: boolean) { expanded = value; markdown.invalidate(); },
    invalidate() { markdown.invalidate(); },
    render(width: number): string[] {
      if (width <= 0) return [];
      const fit = (line: string) => truncateToWidth(line, width, "");
      const name = typeof message?.details?.title === "string" ? message.details.title : String(message?.customType ?? "custom");
      const title = theme ? fg(theme, "toolTitle", theme.bold("Custom message")) : "Custom message";
      const header = `${fg(theme, "accent", "✓")} ${title} ${fg(theme, "dim", name)}`;
      const status = `${fg(theme, "separator", "└─")} ${fg(theme, "success", "Done")}`;
      if (!expanded) return ["", fit(header), fit(`${status}${fg(theme, "dim", " • expand to view")}`)];
      const inset = width >= 4 ? 3 : 0;
      const lines = markdown.render(Math.max(1, width - inset))
        .map((line) => fit(`${" ".repeat(inset)}${fg(theme, "dim", line)}`));
      return ["", fit(header), fit(status), ...lines];
    },
  };
}
