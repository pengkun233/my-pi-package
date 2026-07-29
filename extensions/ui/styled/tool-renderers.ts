import { renderDiff, type Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export type ToolRenderer = (...args: any[]) => Text;

function fg(theme: Theme, token: string, text: string): string {
  try { return theme.fg(token as any, text); } catch { return text; }
}

function text(last: unknown, value: string): Text {
  if (last instanceof Text) {
    last.setText(value);
    return last;
  }
  return new Text(value, 0, 0);
}

function header(label: string, summary: string, theme: Theme, ctx: any): string {
  const marker = ctx?.isPartial ? "·" : ctx?.isError ? "✗" : "✓";
  const token = ctx?.isError ? "error" : ctx?.isPartial ? "muted" : "success";
  let title = label;
  try { title = theme.bold(label); } catch {}
  return `${fg(theme, token, marker)} ${fg(theme, "toolTitle", title)} ${fg(theme, "dim", summary)}`.trimEnd();
}

function firstText(result: any): string {
  if (!Array.isArray(result?.content)) return "";
  return result.content.find((part: any) => part?.type === "text" && typeof part.text === "string")?.text ?? "";
}

function clippedLines(value: string, limit = 40): string[] {
  const lines = value.split("\n").filter((line) => line.trim());
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, Math.floor(limit / 2)), `─── ${lines.length - limit} more lines ───`, ...lines.slice(-Math.ceil(limit / 2))];
}

function statusResult(result: any, options: any, theme: Theme, ctx: any, countLabel?: string): Text {
  const output = firstText(result);
  const lines = clippedLines(output);
  const failed = !!ctx?.isError;
  const label = failed ? "Error" : "Done";
  const count = !failed && lines.length && countLabel ? ` • ${lines.length} ${countLabel}` : "";
  let display = `${fg(theme, "separator", "└─")} ${fg(theme, failed ? "error" : "success", label)}${fg(theme, "dim", count)}`;
  if (!options?.expanded && lines.length) display += fg(theme, "dim", " • expand to view");
  if (options?.expanded) display += lines.map((line) => `\n   ${fg(theme, "toolOutput", line)}`).join("");
  return text(ctx?.lastComponent, display);
}

function pathArg(args: any): string { return String(args?.path ?? args?.file_path ?? ""); }

function simpleCall(label: string, summary: (args: any) => string, remember?: (args: any, ctx: any) => void): ToolRenderer {
  return (args: any, theme: Theme, ctx: any) => {
    remember?.(args, ctx);
    let display = header(label, summary(args), theme, ctx);
    if (ctx?.isPartial) display += `\n${fg(theme, "separator", "└─")} ${fg(theme, "toolOutput", "Running...")}`;
    return text(ctx?.lastComponent, display);
  };
}

const readCall = simpleCall("Read", pathArg);
const bashCall = simpleCall("Bash", (args) => {
  const command = String(args?.command ?? "");
  return command.length > 80 ? `${command.slice(0, 79)}…` : command;
});
const grepCall = simpleCall("Grep", (args) => `${String(args?.pattern ?? "")} in ${String(args?.path ?? ".")}`);
const findCall = simpleCall("Find", (args) => `${String(args?.pattern ?? "")} in ${String(args?.path ?? ".")}`);
const lsCall = simpleCall("ls", (args) => String(args?.path ?? "."));
const writeCall = simpleCall("Write", pathArg, (args, ctx) => {
  if (ctx?.state) ctx.state.lineCount = String(args?.content ?? "").split("\n").length;
});
const editCall = simpleCall("Edit", pathArg, (args, ctx) => {
  if (ctx?.state) ctx.state.editCount = Array.isArray(args?.edits) ? args.edits.length : 0;
});

const ordinaryResult = (countLabel: string): ToolRenderer =>
  (result: any, options: any, theme: Theme, ctx: any) => statusResult(result, options, theme, ctx, countLabel);

const writeResult: ToolRenderer = (result, options, theme, ctx) => {
  if (ctx?.isError) return statusResult(result, options, theme, ctx);
  const count = Number(ctx?.state?.lineCount ?? 0);
  return text(ctx?.lastComponent, `${fg(theme, "separator", "└─")} ${fg(theme, "success", "Done")}${count ? fg(theme, "dim", ` • ${count} lines`) : ""}`);
};

const editResult: ToolRenderer = (result, options, theme, ctx) => {
  if (ctx?.isError) return statusResult(result, options, theme, ctx);
  const count = Number(ctx?.state?.editCount ?? 0);
  let display = `${fg(theme, "separator", "└─")} ${fg(theme, "success", "Done")}${count ? fg(theme, "dim", ` • ${count} edits`) : ""}`;
  if (typeof result?.details?.diff === "string") {
    if (options?.expanded) {
      let diff = result.details.diff;
      try { diff = renderDiff(diff); } catch {}
      display += clippedLines(diff).map((line) => `\n   ${line}`).join("");
    } else {
      display += fg(theme, "dim", " • expand to view");
    }
  }
  return text(ctx?.lastComponent, display);
};

const KNOWN = new Map<string, { call: ToolRenderer; result: ToolRenderer }>([
  ["read", { call: readCall, result: ordinaryResult("lines") }],
  ["bash", { call: bashCall, result: ordinaryResult("lines") }],
  ["edit", { call: editCall, result: editResult }],
  ["write", { call: writeCall, result: writeResult }],
  ["grep", { call: grepCall, result: ordinaryResult("matches") }],
  ["find", { call: findCall, result: ordinaryResult("files") }],
  ["ls", { call: lsCall, result: ordinaryResult("entries") }],
]);

export function getKnownCallRenderer(name: unknown): ToolRenderer | undefined {
  return KNOWN.get(String(name))?.call;
}

export function getKnownResultRenderer(name: unknown): ToolRenderer | undefined {
  return KNOWN.get(String(name))?.result;
}
