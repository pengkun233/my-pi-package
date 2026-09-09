import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HEARTBEAT_MS, SidebarReporter } from "./reporter.js";
import { nextMark, restoreMark, STATE_ENTRY, type TaskMark } from "./state.js";
import { SubagentCounter } from "./subagents.js";

export default function herdrStatus(pi: ExtensionAPI): void {
  // Child/headless sessions inherit these variables too; mode is checked at start.
  const paneId = process.env.HERDR_PANE_ID;
  if (process.env.HERDR_ENV !== "1" || !paneId) return;

  let mark: TaskMark = "sleeping";
  let count = 0;
  let reporter: SidebarReporter | undefined;
  let counter: SubagentCounter | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const publish = () => reporter?.publish(mark, count);
  const setMark = (next: TaskMark) => {
    if (!reporter || next === mark) return;
    mark = next;
    pi.appendEntry(STATE_ENTRY, { mark });
    publish();
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || reporter) return;
    mark = restoreMark(ctx.sessionManager.getEntries());
    count = 0;
    reporter = new SidebarReporter(paneId, (command, args, options) => pi.exec(command, args, options), () => {
      ctx.ui.notify("Could not update Herdr sidebar metadata. Check Herdr supports pane report-metadata.", "warning");
    });
    counter = new SubagentCounter(pi.events, (running) => {
      count = running;
      publish();
    });
    publish();
    heartbeat = setInterval(publish, HEARTBEAT_MS);
    heartbeat.unref();
  });

  pi.on("input", (event) => {
    // Completion nudges and automatic extension prompts must not clear bookmarks.
    if (event.source !== "extension") setMark("working");
    return { action: "continue" };
  });

  pi.registerShortcut("alt+m", {
    description: "Herdr task mark: sleep / review",
    handler: async () => { setMark(nextMark(mark)); },
  });

  pi.on("session_shutdown", async () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    counter?.dispose();
    counter = undefined;
    const previous = reporter;
    reporter = undefined;
    await previous?.dispose();
  });
}
