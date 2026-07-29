import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { UiController } from "./controller.js";

export function registerAckCommand(pi: ExtensionAPI, controller: UiController): void {
  pi.registerCommand("ack", {
    description: "Acknowledge the current terminal status as idle",
    handler: async (_args, ctx) => {
      controller.acknowledge(ctx);
    },
  });
}
