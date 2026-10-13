import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, SelectList, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import { CopyHistory } from "./history.js";

export const COPY_REQUESTED = "已提交复制请求（终端/OSC52 无法确认剪贴板是否写入）";

/** Display controls literally; never let historical text emit terminal commands. Copy remains untouched. */
function displayText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, "    ")
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, (char) => {
      const code = char.charCodeAt(0);
      return code < 32 ? String.fromCharCode(0x2400 + code) : `\\u${code.toString(16).padStart(4, "0")}`;
    });
}

export class CopyOverlay {
  private messageIndex: number;
  private blockIndex = 0;
  private scroll = 0;
  private pageSize = 1;
  private maxScroll = 0;
  private busy = false;
  private closed = false;
  private status = "原文预览；Enter 复制所选内容";
  private statusColor: "muted" | "warning" | "error" = "muted";
  private preview?: { message: number; block: number; width: number; lines: string[] };
  private list?: { message: number; height: number; view: SelectList };

  constructor(private readonly tui: TUI, private readonly theme: Theme,
    private readonly history: CopyHistory, private readonly copy: (text: string) => Promise<void> | void,
    private readonly notify: (message: string, level: "info" | "error") => void,
    private readonly done: () => void) {
    this.messageIndex = history.initialIndex;
  }

  invalidate(): void { this.preview = undefined; this.list = undefined; }
  dispose(): void { this.closed = true; this.invalidate(); }
  close(): void {
    if (this.closed) return;
    this.dispose();
    this.done();
  }
  private changeSelection(message: number, block: number): void {
    if (message === this.messageIndex && block === this.blockIndex) return;
    this.messageIndex = message; this.blockIndex = block;
    this.scroll = 0; this.maxScroll = 0; this.preview = undefined;
  }
  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, Key.escape)) { this.close(); return; }
    const blocks = this.history.blocks(this.messageIndex);
    if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      const delta = matchesKey(data, Key.left) ? -1 : 1;
      const next = Math.max(0, Math.min(this.history.messages.length - 1, this.messageIndex + delta));
      this.changeSelection(next, next === this.messageIndex ? this.blockIndex : 0);
    } else if (matchesKey(data, Key.up)) this.changeSelection(this.messageIndex, Math.max(0, this.blockIndex - 1));
    else if (matchesKey(data, Key.down)) this.changeSelection(this.messageIndex, Math.min(blocks.length - 1, this.blockIndex + 1));
    else if (matchesKey(data, Key.home)) this.changeSelection(this.messageIndex, 0);
    else if (matchesKey(data, Key.end)) this.changeSelection(this.messageIndex, blocks.length - 1);
    else if (matchesKey(data, Key.pageUp)) this.scroll = Math.max(0, this.scroll - this.pageSize);
    else if (matchesKey(data, Key.pageDown)) this.scroll = Math.min(this.maxScroll, this.scroll + this.pageSize);
    else if (matchesKey(data, Key.enter)) { void this.copySelected(); return; }
    else return;
    this.tui.requestRender();
  }
  private async copySelected(): Promise<void> {
    if (this.busy || this.closed) return;
    const message = this.history.messages[this.messageIndex];
    const block = this.history.blocks(this.messageIndex)[this.blockIndex];
    // Capture the exact original slice before yielding; navigation cannot change the request.
    const payload = message.source.slice(block.start, block.end);
    this.busy = true; this.status = "正在提交复制请求…"; this.statusColor = "warning";
    this.tui.requestRender();
    try {
      await this.copy(payload);
      if (this.closed) return;
      this.status = COPY_REQUESTED; this.statusColor = "muted";
      this.notify(COPY_REQUESTED, "info");
    } catch (error) {
      if (this.closed) return;
      this.status = `复制失败：${error instanceof Error ? error.message : String(error)}`;
      this.statusColor = "error";
      this.notify(displayText(this.status), "error");
    } finally {
      this.busy = false;
      // Clipboard helpers cannot cancel an already submitted request, but stale UI must stay retired.
      if (!this.closed) this.tui.requestRender();
    }
  }
  private previewLines(width: number): string[] {
    if (this.preview?.message === this.messageIndex && this.preview.block === this.blockIndex && this.preview.width === width) {
      return this.preview.lines;
    }
    const message = this.history.messages[this.messageIndex];
    const block = this.history.blocks(this.messageIndex)[this.blockIndex];
    const lines = wrapTextWithAnsi(displayText(message.source.slice(block.start, block.end)), width);
    this.preview = { message: this.messageIndex, block: this.blockIndex, width, lines };
    return lines;
  }
  private blockList(height: number, width: number): string[] {
    if (!this.list || this.list.message !== this.messageIndex || this.list.height !== height) {
      this.list = { message: this.messageIndex, height, view: new SelectList(
        this.history.blocks(this.messageIndex).map((block, index) => ({ value: String(index), label: displayText(block.label) })),
        Math.max(1, height - 1), {
          selectedPrefix: (text) => this.theme.fg("accent", text),
          selectedText: (text) => this.theme.fg("accent", text),
          description: (text) => this.theme.fg("muted", text),
          scrollInfo: (text) => this.theme.fg("dim", text),
          noMatch: (text) => this.theme.fg("muted", text),
        }) };
    }
    this.list.view.setSelectedIndex(this.blockIndex);
    return this.list.view.render(width).slice(0, height);
  }
  render(width: number): string[] {
    const height = Math.max(1, Math.min(32, Math.floor(this.tui.terminal.rows * 0.9)));
    if (width < 8 || height < 9) {
      const lines = ["copy-block", "Esc 关闭 / Enter 复制", this.status];
      return lines.slice(0, height).map((line) => this.theme.bg("customMessageBg", truncateToWidth(displayText(line), Math.max(0, width), "", true)));
    }
    const inner = width - 4;
    const message = this.history.messages[this.messageIndex];
    const blocks = this.history.blocks(this.messageIndex);
    const helpText = "↑↓ 区块  ←→ 消息  Home/End 首尾区块\nPgUp/PgDn 预览  Enter 复制  Esc 关闭";
    const help = inner >= 32 && height >= 16 ? wrapTextWithAnsi(helpText, inner) :
      ["↑↓ 区块 / ←→ 消息", "PgUp/PgDn 预览 / Home/End 首尾", "Enter 复制 / Esc 关闭"];
    // Bound variable status/error text so it cannot crowd the preview off-screen.
    const status = wrapTextWithAnsi(displayText(this.status), inner).slice(0, Math.min(3, height - help.length - 6));
    const bodyHeight = Math.max(2, height - 4 - help.length - status.length);
    const wide = inner >= 72;
    const listWidth = wide ? Math.min(34, Math.floor(inner * 0.36)) : inner;
    const listHeight = wide ? bodyHeight - 1 : Math.max(1, Math.min(5, Math.floor((bodyHeight - 1) / 3)));
    const previewWidth = wide ? inner - listWidth - 3 : inner;
    const previewHeight = Math.max(1, wide ? bodyHeight - 1 : bodyHeight - listHeight - 1);
    const preview = this.previewLines(previewWidth);
    this.pageSize = previewHeight;
    this.maxScroll = Math.max(0, preview.length - previewHeight);
    this.scroll = Math.min(this.scroll, this.maxScroll);
    const list = this.blockList(listHeight, listWidth);
    const raw = preview.slice(this.scroll, this.scroll + previewHeight).map((line) => this.theme.fg("text", line));
    const detail = `原文 ${this.scroll + 1}-${Math.min(preview.length, this.scroll + previewHeight)}/${preview.length}`;
    const body: string[] = [];
    if (wide) {
      body.push(this.theme.fg("muted", truncateToWidth(`区块 ${this.blockIndex + 1}/${blocks.length}`, listWidth, "", true)) + " │ " + this.theme.fg("muted", detail));
      for (let i = 0; i < previewHeight; i++) {
        body.push(truncateToWidth(list[i] ?? "", listWidth, "", true) + this.theme.fg("border", " │ ") + (raw[i] ?? ""));
      }
    } else {
      body.push(...list);
      while (body.length < listHeight) body.push("");
      body.push(this.theme.fg("muted", `区块 ${this.blockIndex + 1}/${blocks.length} / ${detail}`), ...raw);
      while (body.length < bodyHeight) body.push("");
    }
    const border = (text: string) => this.theme.fg("borderAccent", text);
    const title = truncateToWidth(" copy-block ", width - 2, "");
    const lines = [border("╭") + this.theme.fg("accent", title) + border("─".repeat(width - 2 - visibleWidth(title)) + "╮"),
      ...[this.theme.fg(message.role === "user" ? "accent" : "text",
        `${message.role === "user" ? "User" : "Assistant"} ${this.messageIndex + 1}/${this.history.messages.length}  ← 更早 / 更晚 →`),
      ...body, ...status.map((line) => this.theme.fg(this.statusColor, line)), ...help.map((line) => this.theme.fg("dim", line)),
      ].map((line) => border("│") + " " + truncateToWidth(line, inner, "", true) + " " + border("│")),
      border(`╰${"─".repeat(width - 2)}╯`)];
    // Paint padding as well: the transcript underneath must not bleed through.
    return lines.map((line) => this.theme.bg("customMessageBg", line));
  }
}
