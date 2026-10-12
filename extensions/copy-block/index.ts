import { copyToClipboard, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { markdownBlocks } from "./markdown.js";

export function assistantResponses(entries: SessionEntry[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.type !== "message" || entry.message.role !== "assistant" ||
      entry.message.stopReason === "error" || entry.message.stopReason === "aborted") return [];
    const source = entry.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    return source ? [source] : [];
  }).reverse();
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("copy-block", {
    description: "Pick an assistant response and copy its Markdown section, code or quote",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const responses = assistantResponses(ctx.sessionManager.getBranch());
      if (!responses.length) { ctx.ui.notify("当前分支没有可复制的已完成回复", "warning"); return; }
      // Native selectors preserve the editor draft. Never reset it with setEditorText.
      const labels = responses.map((source, i) => `${i + 1}. ${source.replace(/\s+/g, " ").slice(0, 90)}`);
      const chosen = await ctx.ui.select("Assistant response (newest first)", labels);
      if (chosen === undefined) return;
      const source = responses[labels.indexOf(chosen)];
      const blocks = markdownBlocks(source);
      const options = blocks.map((block, i) => `${i + 1}. ${block.label}`);
      const selected = await ctx.ui.select("Copy source block", options);
      if (selected === undefined) return;
      const block = blocks[options.indexOf(selected)];
      try {
        await copyToClipboard(source.slice(block.start, block.end));
        // Pi's void-returning API may only have emitted OSC52. No acknowledgement exists.
        ctx.ui.notify("已提交复制请求（终端/OSC52 无法确认剪贴板是否写入）", "info");
      } catch (error) {
        ctx.ui.notify(`复制失败：${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
