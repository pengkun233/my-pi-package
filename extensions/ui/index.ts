import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAckCommand } from "./command.js";
import { UiController } from "./controller.js";

export function setupUi(pi: ExtensionAPI): UiController {
  const controller = new UiController(undefined, {
    getSessionName: () => pi.getSessionName(),
    events: pi.events,
  });
  registerAckCommand(pi, controller);

  pi.on("session_start", (_event, ctx) => { controller.sessionStart(ctx); });
  pi.on("agent_start", () => { controller.onAgentStart(); });
  pi.on("turn_start", () => { controller.onTurnStart(); });
  pi.on("message_update", (event) => { controller.onMessageUpdate(event); });
  pi.on("turn_end", () => { controller.onTurnEnd(); });
  pi.on("agent_end", (event) => { controller.onAgentEnd(event); });
  pi.on("agent_settled", () => { controller.onAgentSettled(); });
  pi.on("session_info_changed", () => { controller.onSessionInfoChanged(); });
  pi.on("tool_result", (event) => { controller.onToolResult(event); });
  pi.on("user_bash", (event) => { controller.onUserBash(event); });
  pi.on("session_shutdown", () => { controller.sessionShutdown(); });
  return controller;
}

export default function uiExtension(pi: ExtensionAPI): void {
  setupUi(pi);
}
