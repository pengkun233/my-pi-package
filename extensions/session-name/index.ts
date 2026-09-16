import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateTitle, namingContext } from "./generate.js";

export const STATE_TYPE = "my-pi-package:session-name";
interface NamingState {
  version: 1;
  rounds: number;
  manual: boolean;
  lastAutoName?: string;
}

function validState(data: unknown): data is NamingState {
  if (!data || typeof data !== "object") return false;
  const value = data as Partial<NamingState>;
  return value.version === 1 && Number.isSafeInteger(value.rounds) && value.rounds! >= 0
    && typeof value.manual === "boolean"
    && (value.lastAutoName === undefined || typeof value.lastAutoName === "string");
}

export default function sessionName(pi: ExtensionAPI): void {
  let state: NamingState = { version: 1, rounds: 0, manual: false };
  let enabled = false;
  let generation = 0;
  let active: AbortController | undefined;
  let queued: { ctx: ExtensionContext; conversation: string } | undefined;
  // Name events are dispatched asynchronously, so a synchronous boolean guard is insufficient.
  const ownNames: string[] = [];
  let warned = false;

  const save = () => pi.appendEntry(STATE_TYPE, { ...state });
  const cancel = () => {
    generation++;
    active?.abort();
    active = undefined;
    queued = undefined;
    ownNames.length = 0;
  };

  const launch = (ctx: ExtensionContext, conversation: string): void => {
    if (!enabled || state.manual) return;
    if (active) {
      queued = { ctx, conversation };
      return;
    }
    const controller = new AbortController();
    active = controller;
    const epoch = generation;
    const previousName = pi.getSessionName();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    timeout.unref();
    void generateTitle(ctx, conversation, previousName, controller.signal).then((title) => {
      if (!enabled || state.manual || controller.signal.aborted || epoch !== generation) return;
      // Protect a rename even if its asynchronous notification has not reached us yet.
      if (pi.getSessionName() !== previousName) return;
      state.lastAutoName = title;
      save();
      if (title !== previousName) {
        ownNames.push(title);
        pi.setSessionName(title);
      }
    }).catch(() => {
      // Never leak provider responses or credentials into notifications; no retries here.
      if (enabled && epoch === generation && !state.manual && !warned) {
        warned = true;
        ctx.ui.notify("Automatic session naming failed; kept the current name. Check session-name.json, provider access and the 16-column title limit. Will try at the next 10-round interval.", "warning");
      }
    }).finally(() => {
      clearTimeout(timeout);
      if (epoch !== generation) return;
      active = undefined;
      const next = queued;
      queued = undefined;
      if (next) launch(next.ctx, next.conversation);
    });
  };

  pi.on("session_start", (_event, ctx) => {
    cancel();
    enabled = ctx.mode === "tui";
    warned = false;
    state = { version: 1, rounds: 0, manual: false };
    if (!enabled) return;
    // Session names are session-wide, not branch-local; the latest persisted state wins.
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === STATE_TYPE && validState(entry.data)) {
        state = { ...entry.data };
      }
    }
    const currentName = pi.getSessionName();
    // Never take ownership of a pre-existing user/other-extension name.
    if (currentName && currentName !== state.lastAutoName) state.manual = true;
  });

  pi.on("input", (event, ctx) => {
    if (!enabled || state.manual || event.source !== "interactive" || !event.text.trim()) {
      return { action: "continue" };
    }
    state.rounds++;
    save();
    if ((state.rounds - 1) % 10 === 0) {
      launch(ctx, namingContext(ctx.sessionManager.getBranch(), event.text));
    }
    return { action: "continue" };
  });

  pi.on("session_info_changed", (event) => {
    if (!enabled) return;
    if (ownNames.length > 0 && ownNames[0] === event.name) {
      ownNames.shift();
      return;
    }
    // Built-in /name, RPC and other extensions all own their explicit renames.
    state.manual = true;
    cancel();
    save();
  });

  pi.on("session_tree", () => { cancel(); });
  pi.on("session_shutdown", () => {
    enabled = false;
    cancel();
  });
}
