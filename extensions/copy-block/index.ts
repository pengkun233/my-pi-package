import { copyToClipboard, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { CopyHistory, copyHistory } from "./history.js";
import { CopyOverlay } from "./overlay.js";

export function assistantResponses(entries: SessionEntry[]): string[] {
  return copyHistory(entries).filter((message) => message.role === "assistant").map((message) => message.source).reverse();
}

export default function (pi: ExtensionAPI) {
  type Interaction = { closed: boolean; dismiss?: () => void };
  let active: Interaction | undefined;
  const retire = () => {
    const interaction = active;
    active = undefined;
    if (interaction) { interaction.closed = true; interaction.dismiss?.(); }
  };
  pi.on("session_start", retire);
  pi.on("session_tree", retire);
  pi.on("session_shutdown", retire);
  pi.registerCommand("copy-block", {
    description: "Browse branch history and copy original message text, Markdown sections, code or quotes",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("copy-block 需要交互终端", "warning");
        return;
      }
      if (active) return; // One interaction, including the custom factory's setup window.
      const messages = copyHistory(ctx.sessionManager.getBranch());
      if (!messages.length) { ctx.ui.notify("当前分支没有可复制的用户消息或已完成回复", "warning"); return; }
      const interaction: Interaction = { closed: false };
      active = interaction;
      try {
        await ctx.ui.custom<void>((tui, theme, _kb, done) => {
          const view = new CopyOverlay(tui, theme, new CopyHistory(messages), copyToClipboard,
            (message, level) => ctx.ui.notify(message, level), () => {
              interaction.closed = true;
              if (active === interaction) active = undefined;
              done();
            });
          interaction.dismiss = () => view.close();
          if (interaction.closed) view.close();
          return view;
        }, { overlay: true, overlayOptions: { width: "95%", maxHeight: "90%", anchor: "center" } });
      } finally {
        interaction.closed = true;
        interaction.dismiss?.();
        if (active === interaction) active = undefined;
      }
      // Only the custom interaction ends. Never read, reset, or paste into the main editor draft.
    },
  });
}
