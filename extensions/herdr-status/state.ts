export type TaskMark = "working" | "sleeping" | "review";

export const STATE_ENTRY = "my-pi-package:herdr-status";
export const MARK_ICONS: Record<TaskMark, string> = {
  working: "🚀",
  sleeping: "💤",
  review: "📖",
};

export function isTaskMark(value: unknown): value is TaskMark {
  return value === "working" || value === "sleeping" || value === "review";
}

export function nextMark(mark: TaskMark): TaskMark {
  return mark === "sleeping" ? "review" : "sleeping";
}

export function subagentLabel(count: number): string {
  return Number.isSafeInteger(count) && count > 0
    ? `🤖 ${count} subagent${count === 1 ? "" : "s"} running`
    : "";
}

// A session-level bookmark, not branch state: tree navigation must not clear it.
export function restoreMark(entries: readonly { type: string; customType?: string; data?: unknown }[]): TaskMark {
  let mark: TaskMark = "sleeping";
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
    const data = entry.data as { mark?: unknown } | undefined;
    if (isTaskMark(data?.mark)) mark = data.mark;
  }
  return mark;
}
