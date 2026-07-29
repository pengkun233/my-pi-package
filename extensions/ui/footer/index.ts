import type { ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { UiContext } from "../types.js";
import { loadFooterConfig } from "./config.js";
import { GitStatusCache } from "./git-status.js";
import { buildFooterContent } from "./layout.js";
import type { FooterLayoutContext } from "./types.js";

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheHitRate?: number;
  cost: number;
}
interface ExtensionRuntimeStatus {
  mcpConnected?: number;
  mcpConfigured?: number;
  memoryTopics?: number;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function parseExtensionStatuses(statuses: ReadonlyMap<string, string>): ExtensionRuntimeStatus {
  const result: ExtensionRuntimeStatus = {};
  const mcp = stripAnsi(statuses.get("mcp") ?? "");
  const enabled = mcp.match(/(\d+)\s+servers?\s+enabled/i);
  const disabled = mcp.match(/\((\d+)\s+disabled\)/i);
  const connected = mcp.match(/\((\d+)\s+connected\)/i);
  const connecting = mcp.match(/connecting\s+to\s+(\d+)\s+servers?/i);
  if (enabled) {
    result.mcpConnected = connected ? Number(connected[1]) : 0;
    result.mcpConfigured = Number(enabled[1]) + (disabled ? Number(disabled[1]) : 0);
  } else if (connecting) {
    result.mcpConnected = 0;
    result.mcpConfigured = Number(connecting[1]);
  }

  const memory = stripAnsi(statuses.get("memory") ?? "").match(/memory:\s*(\d+)/i);
  if (memory) result.memoryTopics = Number(memory[1]);
  return result;
}

function collectUsage(ctx: UiContext): Usage {
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  const branch = (ctx.sessionManager?.getBranch?.() ?? []) as Array<Record<string, any>>;
  for (const entry of branch) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role !== "assistant" || !message.usage) continue;
    const input = Number(message.usage.input ?? 0);
    const cacheRead = Number(message.usage.cacheRead ?? 0);
    const cacheWrite = Number(message.usage.cacheWrite ?? 0);
    usage.input += input + cacheRead + cacheWrite;
    usage.output += Number(message.usage.output ?? 0);
    usage.cacheRead += cacheRead;
    usage.cacheWrite += cacheWrite;
    usage.cost += Number(message.usage.cost?.total ?? 0);

    const promptTokens = input + cacheRead + cacheWrite;
    usage.cacheHitRate = promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
  }
  if (usage.cacheRead <= 0 && usage.cacheWrite <= 0) usage.cacheHitRate = undefined;
  return usage;
}

export class FooterService {
  private cache?: GitStatusCache;
  private tui?: TUI;
  private footerData?: ReadonlyFooterDataProvider;
  private disposed = false;

  constructor(private readonly ctx: UiContext, private readonly isActive: () => boolean) {}

  install(): void {
    this.ctx.ui.setFooter((tui, theme, footerData) => this.createComponent(tui, theme, footerData));
  }

  private createComponent(tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) {
    this.tui = tui;
    this.footerData = footerData;
    this.cache = new GitStatusCache(this.ctx.cwd, () => tui.requestRender());
    this.cache.refresh();
    const unsubscribe = footerData.onBranchChange(() => {
      this.cache?.invalidate();
      tui.requestRender();
    });
    let componentDisposed = false;
    return {
      invalidate() {},
      render: (width: number): string[] => {
        if (!this.isActive() || width <= 0) return [];
        const config = loadFooterConfig();
        const usage = collectUsage(this.ctx);
        const git = this.cache?.get();
        const context = this.ctx.getContextUsage?.();
        const runtime = parseExtensionStatuses(this.footerData?.getExtensionStatuses() ?? new Map());
        const layout: FooterLayoutContext = {
          theme,
          model: this.ctx.model,
          providerDisplayName: this.ctx.model
            ? this.ctx.modelRegistry.getProviderDisplayName(this.ctx.model.provider) || this.ctx.model.provider
            : undefined,
          cwd: this.ctx.cwd,
          gitBranch: git?.branch ?? this.footerData?.getGitBranch() ?? undefined,
          gitDirty: git?.dirty,
          thinkingLevel: this.ctx.thinkingLevel,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheHitRate: usage.cacheHitRate,
          cost: usage.cost,
          contextTokens: context?.tokens ?? undefined,
          contextWindow: context?.contextWindow ?? this.ctx.model?.contextWindow ?? undefined,
          contextPercent: context?.percent ?? undefined,
          terminalWidth: width,
          contextBar: config.contextBar,
          sessionName: this.ctx.sessionManager?.getSessionName?.(),
          ...runtime,
        };
        const row1 = buildFooterContent(layout, config.row1Left, config.row1Right, width);
        const row2 = buildFooterContent(layout, config.row2Left, config.row2Right, width);
        let divider = "─".repeat(width);
        try { divider = theme.fg("separator" as any, divider); } catch {}
        return ["", row1, divider, row2];
      },
      dispose: () => {
        if (componentDisposed) return;
        componentDisposed = true;
        unsubscribe();
        this.cache?.dispose();
      },
    };
  }

  onToolResult(event: unknown): void {
    if (!this.isActive()) return;
    const value = event as { toolName?: string; input?: { command?: unknown } };
    if (value.toolName === "write" || value.toolName === "edit" || value.toolName === "bash") this.cache?.invalidate();
  }

  onUserBash(event: unknown): void {
    if (!this.isActive()) return;
    this.cache?.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cache?.dispose();
    this.tui = undefined;
    this.footerData = undefined;
  }
}

export function createFooterService(ctx: UiContext, isActive: () => boolean): FooterService {
  return new FooterService(ctx, isActive);
}
