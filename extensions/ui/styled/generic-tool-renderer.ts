import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

const MAX_CHARS = 3600;
const MAX_LINES = 40;
const PLACEHOLDER = "[non-text content omitted]";

function bounded(value: string): string {
  const lines = value.split("\n");
  let output = lines.length > MAX_LINES
    ? `${lines.slice(0, MAX_LINES).join("\n")}\n[… ${lines.length - MAX_LINES} more lines]`
    : value;
  if (output.length > MAX_CHARS) output = `${output.slice(0, MAX_CHARS)}…`;
  return output;
}

function style(theme: Theme, token: string, value: string): string {
  try { return theme.fg(token as any, value); } catch { return value; }
}

function bold(theme: Theme, value: string): string {
  try { return theme.bold(value); } catch { return value; }
}

function textualArguments(args: unknown): string {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return PLACEHOLDER;
  const lines = Object.entries(args as Record<string, unknown>).map(([key, value]) =>
    `${key}: ${typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : PLACEHOLDER}`);
  return lines.join("\n") || PLACEHOLDER;
}

function textualResult(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return typeof content === "string" ? content : PLACEHOLDER;
  const parts = content.map((part: any) => part?.type === "text" && typeof part.text === "string" ? part.text : PLACEHOLDER);
  return parts.join("\n") || PLACEHOLDER;
}

export function renderGenericCall(args: unknown, theme: Theme, ctx?: any, label = "Tool") {
  const marker = ctx?.isPartial ? "·" : ctx?.isError ? "✗" : "✓";
  const token = ctx?.isError ? "error" : ctx?.isPartial ? "muted" : "success";
  const body = bounded(textualArguments(args)).split("\n").map((line) => `\n   ${style(theme, "muted", line)}`).join("");
  return new Text(`${style(theme, token, marker)} ${style(theme, "toolTitle", bold(theme, label))}${body}`, 0, 0);
}

export function renderGenericResult(result: unknown, options: any, theme: Theme, ctx?: any) {
  const content = bounded(textualResult(result));
  const failed = !!ctx?.isError;
  let output = `${style(theme, "separator", "└─")} ${style(theme, failed ? "error" : "success", failed ? "Error" : "Done")}`;
  if (!options?.expanded) return new Text(`${output}${style(theme, "dim", " • expand to view")}`, 0, 0);
  output += content.split("\n").map((line) => `\n   ${style(theme, "toolOutput", line)}`).join("");
  return new Text(output, 0, 0);
}

export function createGenericCallRenderer(label: string) {
  return (args: unknown, theme: Theme, ctx?: any) => renderGenericCall(args, theme, ctx, label);
}
