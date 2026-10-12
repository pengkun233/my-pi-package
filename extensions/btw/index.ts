import { getMarkdownTheme, getSelectListTheme, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, Markdown, matchesKey, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { addUsage, emptyUsage, mainSnapshot, SideThread, type SideUsage } from "./thread.js";

export class SideOverlay {
  focused = true;
  private readonly editor: Editor;
  private scroll = 0;
  private unsubscribe: () => void;
  constructor(private readonly tui: TUI, private readonly theme: Theme,
    private readonly thread: () => SideThread, private readonly ask: (question: string) => void,
    private readonly newThread: () => void, private readonly done: () => void,
    subscribe: (listener: () => void) => () => void, private readonly totals: SideUsage) {
    this.editor = new Editor(tui, { borderColor: (text) => theme.fg("border", text), selectList: getSelectListTheme() });
    this.editor.setText(thread().draft);
    this.editor.onChange = () => { thread().draft = this.editor.getExpandedText(); };
    this.editor.onSubmit = (text) => { this.scroll = 0; ask(text); };
    let threadId = thread().id;
    this.unsubscribe = subscribe(() => {
      if (threadId !== thread().id) {
        threadId = thread().id; this.editor.setText(thread().draft); this.scroll = 0;
      }
      this.editor.disableSubmit = thread().busy; tui.requestRender();
    });
    this.editor.disableSubmit = thread().busy;
  }
  invalidate(): void { this.editor.invalidate(); }
  dispose(): void { this.unsubscribe(); }
  handleInput(data: string): void {
    if (matchesKey(data, "escape")) { this.done(); return; }
    if (matchesKey(data, "ctrl+k")) { this.thread().cancel(); this.editor.disableSubmit = false; }
    else if (matchesKey(data, "ctrl+n")) {
      this.newThread(); this.editor.setText(""); this.editor.disableSubmit = false; this.scroll = 0;
    } else if (matchesKey(data, "pageUp")) this.scroll += 8;
    else if (matchesKey(data, "pageDown")) this.scroll = Math.max(0, this.scroll - 8);
    else this.editor.handleInput(data);
    this.tui.requestRender();
  }
  render(width: number): string[] {
    const thread = this.thread();
    this.editor.focused = this.focused;
    const input = this.editor.render(width);
    const content = thread.messages.map((message) => {
      const value = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      return `**${message.role === "user" ? "You" : "Assistant"}**\n\n${value}`;
    }).join("\n\n") + (thread.partial ? `\n\n${thread.partial}` : "");
    const rendered = new Markdown(content || "输入问题开始旁问。", 0, 0, getMarkdownTheme()).render(width);
    const height = Math.max(0, Math.min(30, Math.floor(this.tui.terminal.rows * 0.9) - input.length - 3));
    this.scroll = Math.min(this.scroll, Math.max(0, rendered.length - height));
    const end = rendered.length - this.scroll;
    const body = rendered.slice(Math.max(0, end - height), end);
    const clip = (text: string) => truncateToWidth(text, width, "");
    return [this.theme.fg("accent", clip(`btw · ${thread.model.id} · ${thread.status} · no tools`)),
      ...body,
      this.theme.fg("dim", clip(`thread ${thread.usage.totalTokens} tokens · session side ${this.totals.totalTokens} tokens · $${this.totals.cost.toFixed(4)}`)),
      this.theme.fg("dim", clip("Esc Close · Ctrl+K Cancel · Ctrl+N New · PgUp/PgDn Scroll")), ...input];
  }
}

export default function (pi: ExtensionAPI) {
  let thread: SideThread | undefined;
  let totals = emptyUsage();
  let sessionGeneration = 0;
  let close: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  const clear = (_event: unknown, ctx: ExtensionContext) => {
    sessionGeneration++;
    close?.(); close = undefined;
    thread?.cancel(); thread = undefined; totals = emptyUsage(); listeners.clear();
    ctx.ui.setStatus("btw-usage", undefined);
  };
  pi.on("session_start", clear);
  pi.on("session_tree", () => {
    // Keep the session-scoped conversation/snapshot, but retire work owned by the old branch.
    close?.(); thread?.cancel(); changed();
  });
  pi.on("session_shutdown", clear);
  pi.registerCommand("btw", {
    description: "New isolated tool-free side conversation; no args reopen it",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") { ctx.ui.notify("btw 需要交互终端", "warning"); return; }
      const replace = () => {
        if (!ctx.model) throw new Error("No current model");
        thread?.cancel();
        thread = new SideThread(mainSnapshot(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()), ctx.model);
        changed();
      };
      if (args.trim()) replace();
      else if (!thread) { ctx.ui.notify("没有旁问线程；使用 /btw 问题 开始", "info"); return; }
      const generation = sessionGeneration;
      const ask = (question: string) => {
        void thread!.ask(question, ctx, changed, (usage) => {
          if (generation !== sessionGeneration) return;
          addUsage(totals, usage);
          ctx.ui.setStatus("btw-usage", `btw ${totals.totalTokens} tokens · $${totals.cost.toFixed(4)}`);
        });
      };
      if (args.trim()) ask(args.trim());
      if (close) { changed(); return; }
      let dismiss: (() => void) | undefined;
      try {
        await ctx.ui.custom<void>((tui, theme, _kb, done) => {
          dismiss = () => done();
          close = dismiss;
          return new SideOverlay(tui, theme, () => thread!, ask, replace, dismiss,
            (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, totals);
        }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "90%", anchor: "center" } });
      } finally {
        if (close === dismiss) close = undefined;
      }
      // Closing only removes the overlay. Requests and thread survive until cancellation/session change.
    },
  });
}
