export type TaskMark = "working" | "sleeping" | "review";

export const MARK_ICONS: Record<TaskMark, string> = {
  working: "🚀",
  sleeping: "💤",
  review: "📖",
};

export function nextMark(mark: TaskMark): TaskMark {
  return mark === "review" ? "sleeping" : "review";
}

export function displayMark(mark: TaskMark, count: number): string {
  return Number.isSafeInteger(count) && count > 0 ? "🤖" : MARK_ICONS[mark];
}
