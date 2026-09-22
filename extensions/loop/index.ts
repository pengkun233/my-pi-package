import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { loadPatrolConfig, runPatrol, type PatrolConfig } from "./patrol.js";
import { setTerminalBackgroundActivity } from "../ui/terminal-status-events.js";

const LOOP_STATUS_ID = "loop";
const CHECK_TIMEOUT_MS = 120_000;
const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60_000;
const UNIT_MS = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
} as const;

export interface LoopDefinition extends Partial<PatrolConfig> {
  intervalMs: number;
  intervalLabel: string;
  prompt: string;
  maxRuns?: number;
  timeoutMs?: number;
  probeCommand?: string;
}

export interface LoopStatus extends PatrolConfig {
  active: true;
  intervalLabel: string;
  prompt: string;
  createdAt: number;
  nextRunAt: number;
  runs: number;
  maxRuns?: number;
  expiresAt?: number;
  probeCommand?: string;
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
  patrolModel: string;
  patrolThinking: PatrolConfig["patrolThinking"];
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
  private checkController?: AbortController;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly patrol: typeof runPatrol = runPatrol,
  ) {}

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

    const config = loadPatrolConfig({
      ...(definition.patrolModel === undefined ? {} : { patrolModel: definition.patrolModel }),
      ...(definition.patrolThinking === undefined ? {} : { patrolThinking: definition.patrolThinking }),
    });
    const now = Date.now();
    this.activeLoop = {
      ...definition,
      ...config,
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
      patrolModel: loop.patrolModel,
      patrolThinking: loop.patrolThinking,
      probeCommand: loop.probeCommand,
    };
  }

  formatStatus(): string {
    const loop = this.activeLoop;
    if (!loop) return "No active Loop.";
    const lines = [
      "Loop active",
      `Interval: ${loop.intervalLabel}`,
      `Prompt: ${loop.prompt}`,
      `Model: ${loop.patrolModel} (${loop.patrolThinking})`,
      `Runs: ${loop.runs}${loop.maxRuns === undefined ? "" : ` / ${loop.maxRuns}`}`,
      `Created: ${this.formatTime(loop.createdAt)}`,
      this.checkController ? "Check in progress" : `Next run: ${this.formatTime(loop.nextRunAt)}`,
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

  private async onTimer(): Promise<void> {
    this.timer = undefined;
    const loop = this.activeLoop;
    const ctx = this.context;
    if (!loop || !ctx) return;

    if (loop.expiresAt !== undefined && Date.now() >= loop.expiresAt) {
      this.finishLoop(loop, "Time limit reached; completion was not confirmed.");
      return;
    }

    const controller = new AbortController();
    this.checkController = controller;
    const remaining = loop.expiresAt === undefined ? Infinity : loop.expiresAt - Date.now();
    const deadline = setTimeout(() => controller.abort(new Error(
      remaining <= CHECK_TIMEOUT_MS ? "Loop time limit reached; completion was not confirmed." : "Loop check timed out.",
    )), Math.min(CHECK_TIMEOUT_MS, remaining));
    deadline.unref?.();
    loop.runs += 1;
    this.renderFooterStatus();

    try {
      const result = await this.patrol({
        cwd: ctx.cwd,
        prompt: loop.prompt,
        patrolModel: loop.patrolModel,
        patrolThinking: loop.patrolThinking,
        probeCommand: loop.probeCommand,
        signal: controller.signal,
      });
      if (this.activeLoop !== loop) return;
      controller.signal.throwIfAborted();
      const summary = [result.summary, result.evidence].filter(Boolean).join("\n");
      if (result.outcome !== "continue") {
        this.finishLoop(loop, `${result.outcome === "complete" ? "Completed" : "Needs attention"}: ${summary}`);
        return;
      }
      if (loop.maxRuns !== undefined && loop.runs >= loop.maxRuns) {
        this.finishLoop(loop, `Check limit reached (${loop.runs} checks); completion was not confirmed.\n${summary}`);
        return;
      }
      if (loop.expiresAt !== undefined && Date.now() >= loop.expiresAt) {
        this.finishLoop(loop, `Time limit reached; completion was not confirmed.\n${summary}`);
        return;
      }
    } catch (error) {
      if (this.activeLoop === loop) {
        this.finishLoop(loop, `Monitoring stopped: ${messageFromError(controller.signal.aborted ? controller.signal.reason : error)}`);
      }
      return;
    } finally {
      clearTimeout(deadline);
      if (this.checkController === controller) this.checkController = undefined;
    }

    // Schedule after completion: never overlap checks or catch up missed ticks.
    if (this.activeLoop === loop) {
      loop.nextRunAt = Date.now() + loop.intervalMs;
      this.armTimer();
      this.renderFooterStatus();
    }
  }

  private finishLoop(loop: ActiveLoop, summary: string): void {
    if (this.activeLoop !== loop) return;
    this.clearLoop();
    this.pi.sendMessage({
      customType: "loop-result",
      content: `Loop stopped.\nTask: ${loop.prompt}\n${summary}\nReport this result to the user.`,
      display: true,
    }, { triggerTurn: true, deliverAs: "followUp" });
  }

  private armTimer(): void {
    const loop = this.activeLoop;
    if (!loop) return;
    const wakeAt = loop.expiresAt === undefined
      ? loop.nextRunAt
      : Math.min(loop.nextRunAt, loop.expiresAt);
    const delay = Math.max(0, wakeAt - Date.now());
    this.timer = setTimeout(() => { void this.onTimer(); }, delay);
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
    this.checkController?.abort(new Error("Loop stopped"));
    this.checkController = undefined;
    this.renderFooterStatus();
    if (wasActive) this.emitActivity(false);
  }

  private renderFooterStatus(): void {
    const loop = this.activeLoop;
    const text = loop
      ? `↻ ${loop.intervalLabel} · ${this.checkController ? "checking" : formatBeijingFooterTime(loop.nextRunAt)}`
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

export function setupLoop(pi: ExtensionAPI, patrol: typeof runPatrol = runPatrol): LoopService {
  const service = new LoopService(pi, patrol);

  pi.registerTool({
    name: "loop_start",
    label: "Start Loop",
    description: "Start one session-scoped background patrol using an independent model with read-only tools. Supply a self-contained check and completion condition. Ordinary checks stay silent; completion, alerts, limits, and errors notify the main conversation.",
    promptSnippet: "Start a session-scoped repeated check from a natural-language schedule",
    parameters: Type.Object({
      intervalMinutes: Type.Integer({
        description: "Minutes between checks",
        minimum: MIN_INTERVAL_MS / 60_000,
        maximum: MAX_INTERVAL_MS / 60_000,
      }),
      prompt: Type.String({
        description: "Self-contained check prompt: what to inspect, where to find it, and when monitoring is complete or needs attention",
        minLength: 1,
      }),
      maxRuns: Type.Optional(Type.Integer({
        description: "Stop after this many checks unless completed earlier",
        minimum: 1,
      })),
      timeoutMinutes: Type.Optional(Type.Integer({
        description: "Stop after this many minutes",
        minimum: 1,
      })),
      patrolModel: Type.Optional(Type.String({
        description: "Override the configured patrol model (provider/model)",
        minLength: 1,
      })),
      patrolThinking: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)),
      probeCommand: Type.Optional(Type.String({
        description: "Optional read-only shell command run before each check; its output and exit code are supplied to the patrol model",
        minLength: 1,
      })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const status = service.startLoop({
        intervalMs: params.intervalMinutes * 60_000,
        intervalLabel: intervalLabelFromMinutes(params.intervalMinutes),
        prompt: params.prompt,
        maxRuns: params.maxRuns,
        patrolModel: params.patrolModel,
        patrolThinking: params.patrolThinking,
        probeCommand: params.probeCommand,
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
    description: "Stop the active Loop and cancel its current background check when the user asks to stop or monitoring is no longer needed.",
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
    description: "Monitor a task with an independent background model in the current TUI session",
    handler: async (args, ctx) => { service.handleCommand(args, ctx); },
  });
  pi.on("session_start", (_event, ctx) => { service.sessionStart(ctx); });
  pi.on("session_shutdown", () => { service.sessionShutdown(); });

  return service;
}

export default function loopExtension(pi: ExtensionAPI): void {
  setupLoop(pi);
}
