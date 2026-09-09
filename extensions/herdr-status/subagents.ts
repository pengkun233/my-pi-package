import type { EventBus } from "@earendil-works/pi-coding-agent";

function eventId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** @tintinweb/pi-subagents top-level lifecycle: queued agents have not started yet.
 * Workflow/nested children are deliberately absent from this upstream contract.
 * Do not count tool calls: a background Agent tool returns before its agent ends.
 */
export class SubagentCounter {
  private readonly running = new Set<string>();
  private readonly unsubscribe: Array<() => void>;

  constructor(events: EventBus, private readonly changed: (count: number) => void) {
    this.unsubscribe = [
      events.on("subagents:started", (data) => this.update(data, true)),
      events.on("subagents:completed", (data) => this.update(data, false)),
      events.on("subagents:failed", (data) => this.update(data, false)),
    ];
  }

  dispose(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.running.clear();
  }

  private update(data: unknown, active: boolean): void {
    const id = eventId(data);
    if (!id) return;
    const before = this.running.size;
    if (active) this.running.add(id);
    else this.running.delete(id);
    if (this.running.size !== before) this.changed(this.running.size);
  }
}
