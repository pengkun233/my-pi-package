import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SEGMENT_IDS, type ContextBarConfig, type FooterConfig, type SegmentId } from "./types.js";

export const DEFAULT_CONTEXT_BAR_CONFIG: ContextBarConfig = {
  mode: "bar",
  barWidth: 18,
  filledChar: "▋",
  unfilledChar: "▋",
  unfilledColor: "borderMuted",
  gradientStart: "borderAccent",
  gradientMid: "accent",
  gradientEnd: "dim",
  gradientMidPoint: 0.55,
  showPercent: true,
  showContextLimit: true,
  responsive: true,
};

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
  row1Left: ["pi", "separator", "model", "separator", "thinking"],
  row1Right: ["tokens", "separator", "cost", "separator", "context"],
  row2Left: ["path", "separator", "session"],
  contextBar: DEFAULT_CONTEXT_BAR_CONFIG,
};

const known = new Set<string>(SEGMENT_IDS);

export function normalizeSegments(value: unknown): SegmentId[] {
  if (!Array.isArray(value)) return [];
  const filtered = value.filter((item): item is SegmentId => typeof item === "string" && known.has(item));
  const result: SegmentId[] = [];
  for (const id of filtered) {
    if (id === "separator" && (result.length === 0 || result.at(-1) === "separator")) continue;
    result.push(id);
  }
  while (result.at(-1) === "separator") result.pop();
  return result;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeContextBar(value: unknown): ContextBarConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_CONTEXT_BAR_CONFIG };
  const record = value as Record<string, unknown>;
  const width = typeof record.barWidth === "number" && Number.isFinite(record.barWidth)
    ? Math.min(32, Math.max(4, Math.round(record.barWidth)))
    : DEFAULT_CONTEXT_BAR_CONFIG.barWidth;
  const midpoint = typeof record.gradientMidPoint === "number" && Number.isFinite(record.gradientMidPoint)
    ? Math.min(1, Math.max(0, record.gradientMidPoint))
    : DEFAULT_CONTEXT_BAR_CONFIG.gradientMidPoint;
  return {
    mode: record.mode === "text" ? "text" : "bar",
    barWidth: width,
    filledChar: stringValue(record.filledChar, DEFAULT_CONTEXT_BAR_CONFIG.filledChar),
    unfilledChar: stringValue(record.unfilledChar, DEFAULT_CONTEXT_BAR_CONFIG.unfilledChar),
    unfilledColor: stringValue(record.unfilledColor, DEFAULT_CONTEXT_BAR_CONFIG.unfilledColor),
    gradientStart: stringValue(record.gradientStart, DEFAULT_CONTEXT_BAR_CONFIG.gradientStart),
    gradientMid: stringValue(record.gradientMid, DEFAULT_CONTEXT_BAR_CONFIG.gradientMid),
    gradientEnd: stringValue(record.gradientEnd, DEFAULT_CONTEXT_BAR_CONFIG.gradientEnd),
    gradientMidPoint: midpoint,
    showPercent: booleanValue(record.showPercent, DEFAULT_CONTEXT_BAR_CONFIG.showPercent),
    showContextLimit: booleanValue(record.showContextLimit, DEFAULT_CONTEXT_BAR_CONFIG.showContextLimit),
    responsive: booleanValue(record.responsive, DEFAULT_CONTEXT_BAR_CONFIG.responsive),
  };
}

export function normalizeConfig(value: unknown): FooterConfig {
  if (!value || typeof value !== "object") return DEFAULT_FOOTER_CONFIG;
  const record = value as Record<string, unknown>;
  return {
    row1Left: normalizeSegments(record.row1Left ?? DEFAULT_FOOTER_CONFIG.row1Left),
    row1Right: normalizeSegments(record.row1Right ?? DEFAULT_FOOTER_CONFIG.row1Right),
    row2Left: normalizeSegments(record.row2Left ?? DEFAULT_FOOTER_CONFIG.row2Left),
    contextBar: normalizeContextBar(record.contextBar),
  };
}

export function loadFooterConfig(path = join(homedir(), ".pi", "agent", "configs", "ui-footer.json")): FooterConfig {
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return DEFAULT_FOOTER_CONFIG;
  }
}
