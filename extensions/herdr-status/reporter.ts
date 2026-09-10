import { reportMetadata, type MetadataParams } from "./socket.js";
import { MARK_ICONS, subagentLabel, type TaskMark } from "./state.js";

export const MARK_TOKEN = "pi_task_mark";
export const SUBAGENTS_TOKEN = "pi_subagents";
const SOURCE = "my-pi-package:herdr-status";

/** Independent display-only requests; Herdr rejects out-of-order sequence numbers. */
export class SidebarReporter {
  private seq = Date.now() * 1000;
  private closed = false;

  constructor(
    private readonly paneId: string,
    private readonly onError: (error: Error) => void,
    private readonly send: (params: MetadataParams) => Promise<void> = reportMetadata,
  ) {}

  publish(mark: TaskMark, count: number): void {
    if (this.closed) return;
    void this.report({
      [MARK_TOKEN]: MARK_ICONS[mark],
      [SUBAGENTS_TOKEN]: subagentLabel(count) || null,
    });
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.report({ [MARK_TOKEN]: null, [SUBAGENTS_TOKEN]: null });
  }

  private async report(tokens: MetadataParams["tokens"]): Promise<void> {
    try {
      await this.send({ pane_id: this.paneId, source: SOURCE, agent: "pi", seq: ++this.seq, tokens });
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
