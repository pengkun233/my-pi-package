import type {
  AgentEndEvent,
  EventBus,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import {
  isTerminalBackgroundActivityEvent,
  TERMINAL_BACKGROUND_ACTIVITY_EVENT,
} from "./terminal-status-events.js";
import type { UiContext } from "./types.js";

const NEEDS_INPUT_EVENT = "my-pi-package:terminal-status:needs-input";

export type TerminalStatus = "idle" | "working" | "waiting" | "background" | "needs-input" | "error";
type BaseTerminalStatus = Exclude<TerminalStatus, "background" | "needs-input">;

const SUBAGENT_ASYNC_STARTED_EVENT = "subagent:async-started";
const SUBAGENT_ASYNC_COMPLETE_EVENT = "subagent:async-complete";

const STATUS_LABELS: Record<TerminalStatus, string> = {
  idle: "⚪ 空闲",
  working: "🔵 工作中",
  waiting: "🟢 等待回复",
  background: "🟣 等待中",
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

function subagentRunId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const event = value as { id?: unknown; runId?: unknown };
  if (typeof event.runId === "string" && event.runId) return event.runId;
  return typeof event.id === "string" && event.id ? event.id : undefined;
}

function isSubagentLaunch(event: ToolExecutionStartEvent): boolean {
  if (event.toolName !== "subagent" || !event.args || typeof event.args !== "object") return false;
  const args = event.args as Record<string, unknown>;
  if (typeof args.action === "string") return false;
  return "agent" in args || "tasks" in args || "chain" in args;
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
  private readonly backgroundWork = new Set<string>();
  private readonly unsubscribers: Array<() => void> = [];
  private disposed = false;

  constructor(
    private readonly ctx: UiContext,
    private readonly dependencies: TerminalStatusDependencies,
  ) {}

  install(): void {
    if (this.disposed || this.unsubscribers.length > 0) return;
    this.unsubscribers.push(
      this.dependencies.events.on(NEEDS_INPUT_EVENT, (event) => {
        if (!isNeedsInputEvent(event)) return;
        if (event.active) {
          this.needsInputDepth += 1;
        } else {
          this.needsInputDepth = Math.max(0, this.needsInputDepth - 1);
        }
        this.render();
      }),
      this.dependencies.events.on(TERMINAL_BACKGROUND_ACTIVITY_EVENT, (event) => {
        if (!isTerminalBackgroundActivityEvent(event)) return;
        this.setBackgroundWork(`extension:${event.source}`, event.active);
      }),
      this.dependencies.events.on(SUBAGENT_ASYNC_STARTED_EVENT, (event) => {
        const id = subagentRunId(event);
        if (id) this.setBackgroundWork(`subagent:async:${id}`, true);
      }),
      this.dependencies.events.on(SUBAGENT_ASYNC_COMPLETE_EVENT, (event) => {
        const id = subagentRunId(event);
        if (id) this.setBackgroundWork(`subagent:async:${id}`, false);
      }),
    );
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

  onToolExecutionStart(event: ToolExecutionStartEvent): void {
    if (isSubagentLaunch(event)) this.setBackgroundWork(`subagent:tool:${event.toolCallId}`, true);
  }

  onToolExecutionEnd(event: ToolExecutionEndEvent): void {
    this.setBackgroundWork(`subagent:tool:${event.toolCallId}`, false);
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
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.needsInputDepth = 0;
    this.backgroundWork.clear();
    this.ctx.ui.setTitle(this.defaultTitle());
  }

  private setBaseStatus(status: BaseTerminalStatus): void {
    this.baseStatus = status;
    this.render();
  }

  private setBackgroundWork(key: string, active: boolean): void {
    if (active) this.backgroundWork.add(key);
    else this.backgroundWork.delete(key);
    this.render();
  }

  private render(): void {
    if (this.disposed) return;
    const status: TerminalStatus = this.needsInputDepth > 0
      ? "needs-input"
      : this.baseStatus === "error"
        ? "error"
        : this.backgroundWork.size > 0
          ? "background"
          : this.baseStatus;
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
