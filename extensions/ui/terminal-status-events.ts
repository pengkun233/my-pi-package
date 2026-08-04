import type { EventBus } from "@earendil-works/pi-coding-agent";

export const TERMINAL_BACKGROUND_ACTIVITY_EVENT = "my-pi-package:terminal-status:background-activity";

export interface TerminalBackgroundActivityEvent {
  source: string;
  active: boolean;
}

export function isTerminalBackgroundActivityEvent(value: unknown): value is TerminalBackgroundActivityEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as { source?: unknown; active?: unknown };
  return typeof event.source === "string" && event.source.length > 0 && typeof event.active === "boolean";
}

export function setTerminalBackgroundActivity(events: EventBus, source: string, active: boolean): void {
  events.emit(TERMINAL_BACKGROUND_ACTIVITY_EVENT, {
    source,
    active,
  } satisfies TerminalBackgroundActivityEvent);
}
