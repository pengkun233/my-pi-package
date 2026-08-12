import { basename } from "node:path";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { DEFAULT_CONTEXT_BAR_CONFIG } from "./config.js";
import type { ContextBarConfig, FooterLayoutContext, SegmentId } from "./types.js";

function compact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatContextTokens(tokens: number): string {
  const value = Math.max(0, tokens);
  const units: Array<[number, string]> = [[1_000_000, "M"], [1_000, "k"]];
  for (const [size, suffix] of units) {
    if (value >= size) {
      return `${(value / size).toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return `${Math.round(value)}`;
}

type Rgb = { r: number; g: number; b: number };

function colorToRgb(theme: FooterLayoutContext["theme"], value: string): Rgb | undefined {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  try {
    const ansi = theme.fg(value as any, "x");
    const match = ansi.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
    if (match) return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  } catch {}
  return undefined;
}

function paint(theme: FooterLayoutContext["theme"], color: string, text: string): string {
  const rgb = colorToRgb(theme, color);
  if (rgb) return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[0m`;
  try { return theme.fg(color as any, text); } catch { return text; }
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const channel = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return { r: channel(from.r, to.r), g: channel(from.g, to.g), b: channel(from.b, to.b) };
}

function gradientColor(theme: FooterLayoutContext["theme"], config: ContextBarConfig, index: number, width: number): string {
  const start = colorToRgb(theme, config.gradientStart);
  const middle = colorToRgb(theme, config.gradientMid);
  const end = colorToRgb(theme, config.gradientEnd);
  if (!start || !middle || !end) return config.gradientMid;
  const position = index / Math.max(1, width - 1);
  const midpoint = config.gradientMidPoint;
  if (midpoint <= 0) {
    const rgb = mix(middle, end, position);
    return `#${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b.toString(16).padStart(2, "0")}`;
  }
  if (midpoint >= 1) {
    const rgb = mix(start, middle, position);
    return `#${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b.toString(16).padStart(2, "0")}`;
  }
  const rgb = position <= midpoint
    ? mix(start, middle, position / midpoint)
    : mix(middle, end, (position - midpoint) / (1 - midpoint));
  return `#${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b.toString(16).padStart(2, "0")}`;
}

function contextLabel(ctx: FooterLayoutContext, config: ContextBarConfig, compact = false): string {
  const labels: string[] = [];
  if (!compact && ctx.contextTokens !== undefined) {
    const current = formatContextTokens(ctx.contextTokens);
    labels.push(config.showContextLimit && ctx.contextWindow
      ? `${current} / ${formatContextTokens(ctx.contextWindow)}`
      : current);
  }
  if (config.showPercent && ctx.contextPercent !== undefined) labels.push(`${Math.min(100, Math.max(0, ctx.contextPercent)).toFixed(1)}%`);
  return labels.join(" · ");
}

function renderContextBar(ctx: FooterLayoutContext): string {
  const config = ctx.contextBar ?? DEFAULT_CONTEXT_BAR_CONFIG;
  const terminalWidth = ctx.terminalWidth ?? Number.POSITIVE_INFINITY;
  if (config.mode === "text" || (config.responsive && terminalWidth < 60)) {
    const label = contextLabel(ctx, config, config.responsive && terminalWidth < 60);
    return label ? ctx.theme.fg("muted" as any, `${label}${terminalWidth < 60 ? " ctx" : ""}`) : "";
  }

  const barWidth = config.responsive && terminalWidth < 80
    ? Math.min(config.barWidth, 8)
    : config.responsive && terminalWidth < 110
      ? Math.min(config.barWidth, 10)
      : config.barWidth;
  const percent = Math.min(100, Math.max(0, ctx.contextPercent ?? 0));
  const filled = Math.round(percent / 100 * barWidth);
  let bar = "";
  for (let index = 0; index < barWidth; index++) {
    bar += index < filled
      ? paint(ctx.theme, gradientColor(ctx.theme, config, index, barWidth), config.filledChar)
      : paint(ctx.theme, config.unfilledColor, config.unfilledChar);
  }
  const label = contextLabel(ctx, config, config.responsive && terminalWidth < 80);
  return label ? `${bar} ${ctx.theme.fg("muted" as any, label)}` : bar;
}

const THINKING_COLORS: Record<string, string> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};

export function renderSegment(id: SegmentId, ctx: FooterLayoutContext): string | undefined {
  const color = (token: string, text: string): string => {
    try { return ctx.theme.fg(token as any, text); } catch { return text; }
  };
  switch (id) {
    case "pi": return color("accent", "π");
    case "model": {
      if (!ctx.model) return undefined;
      const provider = ctx.providerDisplayName || ctx.model.provider;
      return color("text", `${provider} / ${ctx.model.name ?? ctx.model.id}`);
    }
    case "path": return color("muted", basename(ctx.cwd) || ctx.cwd);
    case "git": return ctx.gitBranch ? color(ctx.gitDirty ? "warning" : "success", `git:${ctx.gitBranch}${ctx.gitDirty ? "*" : ""}`) : undefined;
    case "thinking": {
      const level = (ctx.thinkingLevel ?? "off").toLowerCase();
      return color(THINKING_COLORS[level] ?? "thinkingText", level.toUpperCase());
    }
    case "tokens": {
      if (!ctx.inputTokens && !ctx.outputTokens) return undefined;
      const cacheHitRate = ctx.cacheHitRate === undefined ? "" : ` CH${ctx.cacheHitRate.toFixed(1)}%`;
      return color("muted", `↑${compact(ctx.inputTokens)} ↓${compact(ctx.outputTokens)}${cacheHitRate}`);
    }
    case "cost": return ctx.cost > 0 ? color("muted", `$${ctx.cost.toFixed(3)}`) : undefined;
    case "context": {
      if (ctx.contextPercent === undefined) return undefined;
      return renderContextBar(ctx);
    }
    case "session": {
      if (!ctx.sessionName) return undefined;
      return color("muted", `Session: ${truncateToWidth(ctx.sessionName, 30)}`);
    }
    case "separator": return color("separator", "|");
  }
}

export function renderSegments(ids: SegmentId[], ctx: FooterLayoutContext): string[] {
  const visible = ids.map((id) => ({ id, text: renderSegment(id, ctx) })).filter((part) => part.text !== undefined);
  const output: Array<{ id: SegmentId; text: string }> = [];
  for (const part of visible) {
    if (part.id === "separator" && (output.length === 0 || output.at(-1)?.id === "separator")) continue;
    output.push({ id: part.id, text: part.text! });
  }
  while (output.at(-1)?.id === "separator") output.pop();
  return output.map((part) => part.text);
}

export function buildFooterContent(
  ctx: FooterLayoutContext,
  leftIds: SegmentId[],
  rightIds: SegmentId[],
  width: number,
): string {
  if (width <= 0) return "";
  const innerWidth = Math.max(0, width - 2);
  const left = renderSegments(leftIds, ctx).join(" ");
  const right = renderSegments(rightIds, ctx).join(" ");
  if (!right) {
    const text = truncateToWidth(left, innerWidth);
    return truncateToWidth(` ${text}${" ".repeat(Math.max(0, innerWidth - visibleWidth(text)))} `, width);
  }
  const clippedRight = truncateToWidth(right, innerWidth);
  const rightWidth = visibleWidth(clippedRight);
  if (!left || rightWidth >= innerWidth) return truncateToWidth(` ${clippedRight} `, width);
  const clippedLeft = truncateToWidth(left, Math.max(0, innerWidth - rightWidth - 1));
  const gap = Math.max(1, innerWidth - visibleWidth(clippedLeft) - rightWidth);
  return truncateToWidth(` ${clippedLeft}${" ".repeat(gap)}${clippedRight} `, width);
}

export function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, "")
    .replace(/ +/g, " ")
    .trim();
}

function padFooterLine(line: string, width: number, innerWidth: number): string {
  const clipped = truncateToWidth(line, innerWidth, "");
  if (width < 3) return truncateToWidth(clipped, width, "");
  return ` ${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} `;
}

export function buildFooterStatusRows(
  ctx: FooterLayoutContext,
  fixedIds: SegmentId[],
  statuses: readonly string[],
  width: number,
): string[] {
  if (width <= 0) return [];
  const innerWidth = Math.max(1, width - (width >= 3 ? 2 : 0));
  const separator = ` ${renderSegment("separator", ctx) ?? "|"} `;
  const lines: string[] = [];
  let current = "";

  const startLine = (item: string): void => {
    const wrapped = wrapTextWithAnsi(item, innerWidth);
    lines.push(...wrapped.slice(0, -1));
    current = wrapped.at(-1) ?? "";
  };

  const appendItem = (item: string): void => {
    if (!item) return;
    if (!current) {
      startLine(item);
      return;
    }
    if (visibleWidth(current) + visibleWidth(separator) + visibleWidth(item) <= innerWidth) {
      current += separator + item;
      return;
    }
    lines.push(current);
    current = "";
    startLine(item);
  };

  const fixed = renderSegments(fixedIds, ctx).join(" ");
  if (fixed) startLine(fixed);
  for (const status of statuses) appendItem(sanitizeStatusText(status));
  if (current) lines.push(current);

  return lines.map((line) => padFooterLine(line, width, innerWidth));
}
