import { MARK_ICONS, subagentLabel, type TaskMark } from "./state.js";

export const MARK_TOKEN = "pi_task_mark";
export const SUBAGENTS_TOKEN = "pi_subagents";
export const HEARTBEAT_MS = 15_000;
const TTL_MS = 45_000;
const SOURCE = "my-pi-package:herdr-status";

type Execute = (command: string, args: string[], options: { timeout: number }) => Promise<{ code: number }>;

/** Serial, coalesced display-only reports; never changes Herdr's agent lifecycle. */
export class SidebarReporter {
  private seq = Date.now() * 1000;
  private pending: string[] | undefined;
  private inFlight: Promise<void> | undefined;
  private closed = false;
  private warned = false;

  constructor(
    private readonly paneId: string,
    private readonly execute: Execute,
    private readonly onError: () => void,
  ) {}

  publish(mark: TaskMark, count: number): void {
    if (this.closed) return;
    this.enqueue([
      "--token", `${MARK_TOKEN}=${MARK_ICONS[mark]}`,
      ...(count > 0
        ? ["--token", `${SUBAGENTS_TOKEN}=${subagentLabel(count)}`]
        : ["--clear-token", SUBAGENTS_TOKEN]),
    ]);
  }

  async dispose(): Promise<void> {
    if (this.closed) return this.inFlight;
    this.closed = true;
    this.enqueue(["--clear-token", MARK_TOKEN, "--clear-token", SUBAGENTS_TOKEN]);
    await this.inFlight;
  }

  private enqueue(tokens: string[]): void {
    this.pending = tokens;
    if (!this.inFlight) {
      this.inFlight = this.drain().finally(() => {
        this.inFlight = undefined;
        // A report may arrive in the microtask between drain settling and cleanup.
        if (this.pending) {
          this.enqueue(this.pending);
          return this.inFlight;
        }
      });
    }
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const tokens = this.pending;
      this.pending = undefined;
      try {
        const result = await this.execute("herdr", [
          "pane", "report-metadata", this.paneId,
          "--source", SOURCE, "--agent", "pi",
          "--seq", String(++this.seq), "--ttl-ms", String(TTL_MS),
          ...tokens,
        ], { timeout: 2000 });
        if (result.code !== 0) throw new Error("Herdr metadata report failed");
      } catch {
        // A missing/older Herdr must not prevent messages or shortcuts from working.
        // The heartbeat retries and the TTL removes stale metadata after a crash.
        if (!this.warned && !this.closed) {
          this.warned = true;
          this.onError();
        }
      }
    }
  }
}
