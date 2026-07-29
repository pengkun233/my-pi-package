import type { Model } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";

export const SEGMENT_IDS = ["pi", "model", "path", "git", "thinking", "tokens", "cost", "context", "session", "mcp", "memory", "separator"] as const;
export type SegmentId = (typeof SEGMENT_IDS)[number];

export interface ContextBarConfig {
  mode: "bar" | "text";
  barWidth: number;
  filledChar: string;
  unfilledChar: string;
  unfilledColor: string;
  gradientStart: string;
  gradientMid: string;
  gradientEnd: string;
  gradientMidPoint: number;
  showPercent: boolean;
  showContextLimit: boolean;
  responsive: boolean;
}

export interface FooterConfig {
  row1Left: SegmentId[];
  row1Right: SegmentId[];
  row2Left: SegmentId[];
  row2Right: SegmentId[];
  contextBar: ContextBarConfig;
}

export interface FooterLayoutContext {
  theme: Theme;
  model?: Model<any>;
  providerDisplayName?: string;
  cwd: string;
  gitBranch?: string;
  gitDirty?: boolean;
  thinkingLevel?: string;
  inputTokens: number;
  outputTokens: number;
  cacheHitRate?: number;
  cost: number;
  contextTokens?: number;
  contextWindow?: number;
  contextPercent?: number;
  terminalWidth?: number;
  contextBar?: ContextBarConfig;
  sessionName?: string;
  mcpConnected?: number;
  mcpConfigured?: number;
  memoryTopics?: number;
}
