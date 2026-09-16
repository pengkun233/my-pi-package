import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SidebarReporter } from "./reporter.js";
import { nextMark, type TaskMark } from "./state.js";
import { SubagentCounter } from "./subagents.js";

export default function herdrStatus(pi: ExtensionAPI): void {
  // Child/headless sessions inherit these variables too; mode is checked at start.
  const paneId = process.env.HERDR_PANE_ID;
  if (process.env.HERDR_ENV !== "1" || !paneId) return;

  let mark: TaskMark = "sleeping";
  let count = 0;
  let name: string | undefined;
  let reporter: SidebarReporter | undefined;
  let counter: SubagentCounter | undefined;

  const publish = () => reporter?.publish(mark, count, name);
  const setMark = (next: TaskMark) => {
    if (!reporter || next === mark) return;
    mark = next;
    publish();
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || reporter) return;
    mark = "sleeping";
    count = 0;
    name = pi.getSessionName();
    reporter = new SidebarReporter(paneId, (error) => {
      ctx.ui.notify(`Could not update Herdr sidebar metadata: ${error.message}`, "warning");
    });
    counter = new SubagentCounter(pi.events, (running) => {
      count = running;
      publish();
    });
    publish();
  });

  pi.on("session_info_changed", (event) => {
    name = event.name;
    publish();
  });

  pi.on("input", (event) => {
    // Completion nudges and automatic extension prompts must not clear bookmarks.
    if (event.source !== "extension") setMark("working");
    return { action: "continue" };
  });

  pi.registerShortcut("alt+m", {
    description: "Herdr task mark: review / sleep",
    handler: async () => { setMark(nextMark(mark)); },
  });

  pi.on("session_shutdown", async () => {
    counter?.dispose();
    counter = undefined;
    const previous = reporter;
    reporter = undefined;
    await previous?.dispose();
  });
}
