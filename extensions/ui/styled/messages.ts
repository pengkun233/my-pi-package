import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text, truncateToWidth } from "@earendil-works/pi-tui";

function fg(theme: Theme | undefined, token: string, text: string): string {
  try { return theme ? theme.fg(token as any, text) : text; } catch { return text; }
}

function prefixedMarkdown(
  text: string,
  markdownTheme: any,
  prefix: string,
  prefixToken: string,
  theme: Theme | undefined,
  bodyToken?: string,
  italic = false,
) {
  const markdown = new Markdown(text, 0, 0, markdownTheme, bodyToken ? {
    color: (value: string) => fg(theme, bodyToken, value),
    italic,
  } : undefined);
  return {
    invalidate() { markdown.invalidate(); },
    render(width: number): string[] {
      if (width <= 0) return [];
      const coloredPrefix = fg(theme, prefixToken, prefix);
      if (width <= 3) return [truncateToWidth(` ${coloredPrefix}`, width, "")];
      const lines = markdown.render(Math.max(1, width - 3));
      let placed = false;
      return lines.map((line) => {
        const rendered = !placed && line.trim()
          ? ` ${coloredPrefix} ${line}`
          : `   ${line}`;
        if (!placed && line.trim()) placed = true;
        return truncateToWidth(rendered, width, "");
      });
    },
  };
}

export function createAssistantMessage(text: string, markdownTheme: any, theme?: Theme) {
  return prefixedMarkdown(text, markdownTheme, "●", "text", theme);
}

export function createThinkingMessage(text: string, markdownTheme: any, theme?: Theme) {
  return prefixedMarkdown(text, markdownTheme, "✽", "accent", theme, "dim", true);
}

export function createUserMessage(text: string, markdownTheme: any, theme?: Theme) {
  return prefixedMarkdown(text, markdownTheme, "❯", "accent", theme, "text");
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
