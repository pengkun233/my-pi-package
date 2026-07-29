import type { AgentEndEvent, EventBus } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import type { UiContext } from "./types.js";

const NEEDS_INPUT_EVENT = "my-pi-package:terminal-status:needs-input";

export type TerminalStatus = "idle" | "working" | "waiting" | "needs-input" | "error";
type BaseTerminalStatus = Exclude<TerminalStatus, "needs-input">;

const STATUS_LABELS: Record<TerminalStatus, string> = {
  idle: "⚪ 空闲",
  working: "🔵 工作中",
  waiting: "🟢 等待回复",
  "needs-input": "🟠 需要输入",
  error: "🔴 错误",
};

interface NeedsInputEvent {
  active: boolean;
}

export interface TerminalStatusDependencies {
  getSessionName(): string | undefined;
  events: EventBus;
}

function isNeedsInputEvent(value: unknown): value is NeedsInputEvent {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { active?: unknown }).active === "boolean";
}

export async function withTerminalNeedsInput<T>(
  events: EventBus,
  operation: () => Promise<T>,
): Promise<T> {
  events.emit(NEEDS_INPUT_EVENT, { active: true } satisfies NeedsInputEvent);
  try {
    return await operation();
  } finally {
    events.emit(NEEDS_INPUT_EVENT, { active: false } satisfies NeedsInputEvent);
  }
}

export class TerminalStatusService {
  private baseStatus: BaseTerminalStatus = "idle";
  private needsInputDepth = 0;
  private lastRunFailed = false;
  private unsubscribeNeedsInput?: () => void;
  private disposed = false;

  constructor(
    private readonly ctx: UiContext,
    private readonly dependencies: TerminalStatusDependencies,
  ) {}

  install(): void {
    if (this.disposed || this.unsubscribeNeedsInput) return;
    this.unsubscribeNeedsInput = this.dependencies.events.on(NEEDS_INPUT_EVENT, (event) => {
      if (!isNeedsInputEvent(event)) return;
      if (event.active) {
        this.needsInputDepth += 1;
      } else {
        this.needsInputDepth = Math.max(0, this.needsInputDepth - 1);
      }
      this.render();
    });
    this.render();
  }

  onAgentStart(): void {
    this.lastRunFailed = false;
    this.setBaseStatus("working");
  }

  onAgentEnd(event: AgentEndEvent): void {
    const lastAssistant = [...event.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    this.lastRunFailed = lastAssistant?.role === "assistant" && lastAssistant.stopReason === "error";
  }

  onAgentSettled(): void {
    this.setBaseStatus(this.lastRunFailed ? "error" : "waiting");
  }

  acknowledge(): void {
    this.lastRunFailed = false;
    this.setBaseStatus("idle");
  }

  refreshTitle(): void {
    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeNeedsInput?.();
    this.unsubscribeNeedsInput = undefined;
    this.needsInputDepth = 0;
    this.ctx.ui.setTitle(this.defaultTitle());
  }

  private setBaseStatus(status: BaseTerminalStatus): void {
    this.baseStatus = status;
    this.render();
  }

  private render(): void {
    if (this.disposed) return;
    const status: TerminalStatus = this.needsInputDepth > 0 ? "needs-input" : this.baseStatus;
    this.ctx.ui.setTitle(`${STATUS_LABELS[status]} · ${this.defaultTitle()}`);
  }

  private defaultTitle(): string {
    const projectName = basename(this.ctx.cwd);
    const sessionName = this.dependencies.getSessionName();
    return sessionName
      ? `pi - ${sessionName} - ${projectName}`
      : `pi - ${projectName}`;
  }
}
