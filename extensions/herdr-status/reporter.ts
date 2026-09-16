import { reportMetadata, type MetadataParams } from "./socket.js";
import { displayMark, type TaskMark } from "./state.js";

export const MARK_TOKEN = "pi_task_mark";
export const SUBAGENTS_TOKEN = "pi_subagents";
export const SESSION_NAME_TOKEN = "pi_session_name";
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

  publish(mark: TaskMark, count: number, name: string | undefined): void {
    if (this.closed) return;
    void this.report({
      [MARK_TOKEN]: displayMark(mark, count),
      // Clear the legacy suffix for panes upgrading from the separate count display.
      [SUBAGENTS_TOKEN]: null,
      [SESSION_NAME_TOKEN]: name ?? null,
    });
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.report({ [MARK_TOKEN]: null, [SUBAGENTS_TOKEN]: null, [SESSION_NAME_TOKEN]: null });
  }

  private async report(tokens: MetadataParams["tokens"]): Promise<void> {
    try {
      await this.send({ pane_id: this.paneId, source: SOURCE, agent: "pi", seq: ++this.seq, tokens });
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
