import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { setTerminalBackgroundActivity } from "../ui/terminal-status-events.js";

const LOOP_STATUS_ID = "loop";
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60_000;
const UNIT_MS = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
} as const;

export interface LoopDefinition {
  intervalMs: number;
  intervalLabel: string;
  prompt: string;
  maxRuns?: number;
  timeoutMs?: number;
}

export interface LoopStatus {
  active: true;
  intervalLabel: string;
  prompt: string;
  createdAt: number;
  nextRunAt: number;
  runs: number;
  maxRuns?: number;
  expiresAt?: number;
}

export type LoopDefinitionResult =
  | { ok: true; value: LoopDefinition }
  | { ok: false; error: string };

function toBeijingDate(timestamp: number): Date {
  return new Date(timestamp + BEIJING_OFFSET_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatBeijingTime(timestamp: number): string {
  const date = toBeijingDate(timestamp);
  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
    "UTC+8",
  ].join(" ");
}

export function formatBeijingFooterTime(timestamp: number, now = Date.now()): string {
  const target = toBeijingDate(timestamp);
  const reference = toBeijingDate(now);
  const time = `${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}`;
  const sameDay = target.getUTCFullYear() === reference.getUTCFullYear()
    && target.getUTCMonth() === reference.getUTCMonth()
    && target.getUTCDate() === reference.getUTCDate();
  return sameDay ? time : `${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())} ${time}`;
}

interface ActiveLoop extends LoopDefinition {
  createdAt: number;
  nextRunAt: number;
  runs: number;
  expiresAt?: number;
}

function intervalLabelFromMinutes(minutes: number): string {
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseLoopDefinition(args: string): LoopDefinitionResult {
  const match = args.trim().match(/^(\d+)([mhd])\s+([\s\S]+)$/i);
  if (!match) {
    return { ok: false, error: "Usage: /loop <interval> <prompt> (for example: /loop 5m check the deploy)" };
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase() as keyof typeof UNIT_MS;
  const prompt = match[3].trim();
  const intervalMs = amount * UNIT_MS[unit];

  if (!Number.isSafeInteger(amount) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
    return { ok: false, error: "Loop interval must be between 1m and 7d." };
  }
  if (!prompt) {
    return { ok: false, error: "Loop prompt cannot be empty." };
  }
  if (prompt.startsWith("/")) {
    return { ok: false, error: "Loop prompts beginning with '/' are not supported." };
  }

  return {
    ok: true,
    value: {
      intervalMs,
      intervalLabel: `${amount}${unit}`,
      prompt,
    },
  };
}

export class LoopService {
  private context?: ExtensionContext;
  private activeLoop?: ActiveLoop;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly pi: ExtensionAPI) {}

  sessionStart(ctx: ExtensionContext): void {
    this.dispose();
    if (ctx.hasUI && ctx.mode === "tui") this.context = ctx;
  }

  sessionShutdown(): void {
    this.dispose();
  }

  handleCommand(args: string, ctx: ExtensionCommandContext): void {
    if (!this.context || ctx.mode !== "tui") {
      ctx.ui.notify("Loop is available only in an interactive TUI session.", "warning");
      return;
    }

    const input = args.trim();
    if (!input || input.toLowerCase() === "status") {
      this.showStatus(ctx);
      return;
    }
    if (input.toLowerCase() === "stop") {
      this.stop(ctx);
      return;
    }

    const parsed = parseLoopDefinition(input);
    if (!parsed.ok) {
      ctx.ui.notify(parsed.error, "warning");
      return;
    }

    try {
      this.startLoop(parsed.value, ctx);
    } catch (error) {
      ctx.ui.notify(messageFromError(error), "warning");
    }
  }

  startLoop(definition: LoopDefinition, ctx: ExtensionContext): LoopStatus {
    if (!this.context || ctx.mode !== "tui") {
      throw new Error("Loop is available only in an interactive TUI session.");
    }
    if (this.activeLoop) {
      throw new Error("A Loop is already active. Stop it before creating another one.");
    }

    const now = Date.now();
    this.activeLoop = {
      ...definition,
      createdAt: now,
      nextRunAt: now + definition.intervalMs,
      runs: 0,
      expiresAt: definition.timeoutMs === undefined ? undefined : now + definition.timeoutMs,
    };
    this.armTimer();
    this.renderFooterStatus();
    this.emitActivity(true);
    ctx.ui.notify(
      `Loop started: every ${definition.intervalLabel}. Next run: ${this.formatTime(this.activeLoop.nextRunAt)}`,
      "info",
    );
    return this.getStatus()!;
  }

  getStatus(): LoopStatus | undefined {
    const loop = this.activeLoop;
    if (!loop) return undefined;
    return {
      active: true,
      intervalLabel: loop.intervalLabel,
      prompt: loop.prompt,
      createdAt: loop.createdAt,
      nextRunAt: loop.nextRunAt,
      runs: loop.runs,
      maxRuns: loop.maxRuns,
      expiresAt: loop.expiresAt,
    };
  }

  formatStatus(): string {
    const loop = this.activeLoop;
    if (!loop) return "No active Loop.";
    const lines = [
      "Loop active",
      `Interval: ${loop.intervalLabel}`,
      `Prompt: ${loop.prompt}`,
      `Runs: ${loop.runs}${loop.maxRuns === undefined ? "" : ` / ${loop.maxRuns}`}`,
      `Created: ${this.formatTime(loop.createdAt)}`,
      `Next run: ${this.formatTime(loop.nextRunAt)}`,
    ];
    if (loop.expiresAt !== undefined) lines.push(`Expires: ${this.formatTime(loop.expiresAt)}`);
    return lines.join("\n");
  }

  stopLoop(ctx: ExtensionContext, reason?: string): boolean {
    if (!this.activeLoop) {
      ctx.ui.notify("No active Loop.", "info");
      return false;
    }
    this.clearLoop();
    const suffix = reason?.trim() ? `: ${reason.trim()}` : ".";
    ctx.ui.notify(`Loop stopped${suffix}`, "info");
    return true;
  }

  private onTimer(): void {
    this.timer = undefined;
    const loop = this.activeLoop;
    const ctx = this.context;
    if (!loop || !ctx) return;

    const now = Date.now();
    if (loop.expiresAt !== undefined && now >= loop.expiresAt) {
      this.clearLoop();
      ctx.ui.notify("Loop stopped after reaching its timeout.", "info");
      return;
    }

    loop.nextRunAt = now + loop.intervalMs;
    if (!ctx.isIdle()) {
      this.armTimer();
      this.renderFooterStatus();
      return;
    }

    try {
      this.pi.sendUserMessage(loop.prompt);
      loop.runs += 1;
    } catch (error) {
      ctx.ui.notify(`Loop run skipped: ${messageFromError(error)}`, "warning");
    }

    if (loop.maxRuns !== undefined && loop.runs >= loop.maxRuns) {
      this.clearLoop();
      ctx.ui.notify(`Loop stopped after ${loop.runs} runs.`, "info");
      return;
    }

    this.armTimer();
    this.renderFooterStatus();
  }

  private armTimer(): void {
    const loop = this.activeLoop;
    if (!loop) return;
    const wakeAt = loop.expiresAt === undefined
      ? loop.nextRunAt
      : Math.min(loop.nextRunAt, loop.expiresAt);
    const delay = Math.max(0, wakeAt - Date.now());
    this.timer = setTimeout(() => this.onTimer(), delay);
    this.timer.unref?.();
  }

  private showStatus(ctx: ExtensionCommandContext): void {
    ctx.ui.notify(this.formatStatus(), "info");
  }

  private stop(ctx: ExtensionCommandContext): void {
    this.stopLoop(ctx);
  }

  private dispose(): void {
    this.clearLoop();
    this.context = undefined;
  }

  private clearLoop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const wasActive = this.activeLoop !== undefined;
    this.activeLoop = undefined;
    this.renderFooterStatus();
    if (wasActive) this.emitActivity(false);
  }

  private renderFooterStatus(): void {
    const loop = this.activeLoop;
    const text = loop
      ? `↻ ${loop.intervalLabel} · ${formatBeijingFooterTime(loop.nextRunAt)}`
      : undefined;
    this.context?.ui.setStatus(LOOP_STATUS_ID, text);
  }

  private emitActivity(active: boolean): void {
    setTerminalBackgroundActivity(this.pi.events, "loop", active);
  }

  private formatTime(timestamp: number): string {
    return formatBeijingTime(timestamp);
  }
}

export function setupLoop(pi: ExtensionAPI): LoopService {
  const service = new LoopService(pi);

  pi.registerTool({
    name: "loop_start",
    label: "Start Loop",
    description: "Start one session-scoped repeated check. Use a self-contained prompt; for monitored work, name the completion condition and tell the agent to call loop_stop when it is met.",
    promptSnippet: "Start a session-scoped repeated check from a natural-language schedule",
    parameters: Type.Object({
      intervalMinutes: Type.Integer({
        description: "Minutes between checks",
        minimum: MIN_INTERVAL_MS / 60_000,
        maximum: MAX_INTERVAL_MS / 60_000,
      }),
      prompt: Type.String({
        description: "Self-contained check prompt, including the completion condition and loop_stop instruction when monitoring bounded work",
        minLength: 1,
      }),
      maxRuns: Type.Optional(Type.Integer({
        description: "Stop after this many successfully dispatched checks",
        minimum: 1,
      })),
      timeoutMinutes: Type.Optional(Type.Integer({
        description: "Stop after this many minutes",
        minimum: 1,
      })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const status = service.startLoop({
        intervalMs: params.intervalMinutes * 60_000,
        intervalLabel: intervalLabelFromMinutes(params.intervalMinutes),
        prompt: params.prompt,
        maxRuns: params.maxRuns,
        timeoutMs: params.timeoutMinutes === undefined
          ? undefined
          : params.timeoutMinutes * 60_000,
      }, ctx);
      return {
        content: [{
          type: "text",
          text: `Loop started: every ${status.intervalLabel}. Next run: ${formatBeijingTime(status.nextRunAt)}`,
        }],
        details: status,
      };
    },
  });

  pi.registerTool({
    name: "loop_status",
    label: "Loop Status",
    description: "Show the active session-scoped Loop and its next check.",
    promptSnippet: "Inspect the active repeated check",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      const status = service.getStatus();
      return {
        content: [{ type: "text", text: service.formatStatus() }],
        details: status ?? { active: false },
      };
    },
  });

  pi.registerTool({
    name: "loop_stop",
    label: "Stop Loop",
    description: "Stop future checks for the active Loop. Call this as soon as the monitored completion condition is met, or when the user asks to stop.",
    promptSnippet: "Stop the active repeated check",
    parameters: Type.Object({
      reason: Type.Optional(Type.String({ description: "Why the Loop is stopping" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const stopped = service.stopLoop(ctx, params.reason);
      return {
        content: [{ type: "text", text: stopped ? "Loop stopped." : "No active Loop." }],
        details: { active: false, stopped, reason: params.reason },
      };
    },
  });

  pi.registerCommand("loop", {
    description: "Run one prompt repeatedly in the current TUI session",
    handler: async (args, ctx) => { service.handleCommand(args, ctx); },
  });
  pi.on("session_start", (_event, ctx) => { service.sessionStart(ctx); });
  pi.on("session_shutdown", () => { service.sessionShutdown(); });

  return service;
}

export default function loopExtension(pi: ExtensionAPI): void {
  setupLoop(pi);
}
