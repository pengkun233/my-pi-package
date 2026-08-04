export const LOOP_ACTIVITY_EVENT = "my-pi-package:loop-activity";

export interface LoopActivityEvent {
  active: boolean;
}

export function isLoopActivityEvent(value: unknown): value is LoopActivityEvent {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { active?: unknown }).active === "boolean";
}
