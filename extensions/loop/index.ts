import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
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

    if (this.activeLoop) {
      ctx.ui.notify("A Loop is already active. Run /loop stop before creating another one.", "warning");
      return;
    }

    const parsed = parseLoopDefinition(input);
    if (!parsed.ok) {
      ctx.ui.notify(parsed.error, "warning");
      return;
    }

    const now = Date.now();
    this.activeLoop = {
      ...parsed.value,
      createdAt: now,
      nextRunAt: now + parsed.value.intervalMs,
    };
    this.armTimer();
    this.renderFooterStatus();
    this.emitActivity(true);
    ctx.ui.notify(
      `Loop started: every ${parsed.value.intervalLabel}. Next run: ${this.formatTime(this.activeLoop.nextRunAt)}`,
      "info",
    );
  }

  private onTimer(): void {
    this.timer = undefined;
    const loop = this.activeLoop;
    const ctx = this.context;
    if (!loop || !ctx) return;

    loop.nextRunAt = Date.now() + loop.intervalMs;
    this.armTimer();
    this.renderFooterStatus();
    if (!ctx.isIdle()) return;

    try {
      this.pi.sendUserMessage(loop.prompt);
    } catch (error) {
      ctx.ui.notify(`Loop run skipped: ${String(error)}`, "warning");
    }
  }

  private armTimer(): void {
    const loop = this.activeLoop;
    if (!loop) return;
    const delay = Math.max(0, loop.nextRunAt - Date.now());
    this.timer = setTimeout(() => this.onTimer(), delay);
    this.timer.unref?.();
  }

  private showStatus(ctx: ExtensionCommandContext): void {
    const loop = this.activeLoop;
    if (!loop) {
      ctx.ui.notify("No active Loop.", "info");
      return;
    }
    ctx.ui.notify([
      "Loop active",
      `Interval: ${loop.intervalLabel}`,
      `Prompt: ${loop.prompt}`,
      `Created: ${this.formatTime(loop.createdAt)}`,
      `Next run: ${this.formatTime(loop.nextRunAt)}`,
    ].join("\n"), "info");
  }

  private stop(ctx: ExtensionCommandContext): void {
    if (!this.activeLoop) {
      ctx.ui.notify("No active Loop.", "info");
      return;
    }
    this.clearLoop();
    ctx.ui.notify("Loop stopped.", "info");
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
