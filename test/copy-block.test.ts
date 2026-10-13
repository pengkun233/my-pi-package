import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard, initTheme } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import copyBlock, { assistantResponses } from "../extensions/copy-block/index.js";
import { CopyHistory, copyHistory, type HistoryMessage } from "../extensions/copy-block/history.js";
import { COPY_REQUESTED, CopyOverlay } from "../extensions/copy-block/overlay.js";
import * as markdown from "../extensions/copy-block/markdown.js";

vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
  ...await original<typeof import("@earendil-works/pi-coding-agent")>(), copyToClipboard: vi.fn(async () => {}),
}));

const keys = { up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", home: "\x1b[H", end: "\x1b[F", pgUp: "\x1b[5~", pgDn: "\x1b[6~", enter: "\r", esc: "\x1b" };
const text = (value: string) => ({ type: "text", text: value });
const user = (source: string | any[]) => ({ type: "message", message: { role: "user", content: source } });
const assistant = (source: string, reason = "stop", extra: any[] = []) => ({ type: "message", message: { role: "assistant", stopReason: reason, content: [text(source), ...extra] } });
const source = "# 标题\r\n开头\r\n```ts\r\n  const 中文 = 1;\r\n\tfoo();\r\n```\r\n> 引用\r\n> 继续\r\n# 尾部\r\n结束";
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function overlay(messages: HistoryMessage[] = [{ role: "assistant", source }], copy = vi.fn(async (_text: string) => {}), themeName = "dark", rows = 40) {
  initTheme(themeName, false);
  const theme = getThemeByName(themeName)!;
  const tui = { requestRender: vi.fn(), terminal: { rows } };
  const notify = vi.fn(), done = vi.fn(), history = new CopyHistory(messages);
  const view = new CopyOverlay(tui as any, theme, history, copy, notify, done);
  return { view, copy, notify, done, tui, theme, history };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(copyToClipboard).mockResolvedValue(undefined); });

describe("copyable branch history", () => {
  it("keeps chronological main user/completed assistant text and excludes all other content", () => {
    const entries: any = [
      user("用户\r\n原文"), assistant("older", "length", [{ type: "thinking", thinking: "secret" }, { type: "toolCall", name: "read", arguments: {} }]),
      { type: "message", message: { role: "toolResult", content: [text("tool result")] } },
      { type: "custom_message", customType: "btw", content: "side" },
      { type: "custom", customType: "task-completion", data: { text: "finished" } },
      { type: "branch_summary", summary: "summary" },
      assistant("failed", "error"), assistant("cancelled", "aborted"),
      { type: "message", message: { role: "assistant", stopReason: undefined, content: [text("streaming")] } },
      { type: "message", message: { role: "assistant", content: [text("not finalized")] } },
      user([{ type: "image", data: "base64" }, text("text before"), text("text after")]),
      assistant("latest", "toolUse"), user("new question"), user([{ type: "image", data: "only image" }]),
    ];
    const history = copyHistory(entries);
    expect(history).toEqual([
      { role: "user", source: "用户\r\n原文" }, { role: "assistant", source: "older" },
      { role: "user", source: "text before\ntext after" }, { role: "assistant", source: "latest" },
      { role: "user", source: "new question" },
    ]);
    expect(new CopyHistory(history).initialIndex).toBe(3);
    expect(assistantResponses(entries)).toEqual(["latest", "older"]);
    const users = new CopyHistory(copyHistory([user("one"), user("two")] as any));
    expect(users.initialIndex).toBe(1);
    expect(users.blocks(1)).toEqual([{ kind: "whole", label: "Whole user message (text)", start: 0, end: 3 }]);
  });
  it("lazily scans only visited assistant messages, without adding paragraph selections", () => {
    const scan = vi.spyOn(markdown, "markdownBlocks");
    const history = new CopyHistory(Array.from({ length: 500 }, (_, i) => ({ role: "assistant", source: `paragraph ${i}\n\nnext paragraph` })));
    expect(scan).not.toHaveBeenCalled();
    expect(history.blocks(499).map((block) => block.kind)).toEqual(["whole"]);
    expect(history.blocks(499)).toBe(history.blocks(499));
    expect(scan).toHaveBeenCalledTimes(1);
    history.blocks(0); expect(scan).toHaveBeenCalledTimes(2);
    scan.mockRestore();
  });
});

describe("keyboard history overlay", () => {
  it("defaults to latest assistant; arrows preview real user/assistant text and clamp at history boundaries", async () => {
    const { view, copy, done } = overlay([
      { role: "user", source: "earliest user\r\nsecond line" }, { role: "assistant", source: "old answer" },
      { role: "assistant", source }, { role: "user", source: "latest question" },
    ]);
    expect(view.render(100).join("\n")).toContain("Assistant 3/4");
    expect(view.render(100).join("\n")).toContain("const 中文");
    view.handleInput(keys.right);
    expect(view.render(100).join("\n")).toContain("latest question");
    expect(view.render(100).join("\n")).toContain("User 4/4");
    view.handleInput(keys.right); expect(view.render(100).join("\n")).toContain("User 4/4");
    view.handleInput(keys.enter); await flush(); expect(copy).toHaveBeenLastCalledWith("latest question");
    for (let i = 0; i < 5; i++) view.handleInput(keys.left);
    expect(view.render(100).join("\n")).toContain("User 1/4");
    expect(view.render(100).join("\n")).toContain("earliest user");
    view.handleInput(keys.enter); await flush(); expect(copy).toHaveBeenLastCalledWith("earliest user\r\nsecond line");
    expect(done).not.toHaveBeenCalled();
    view.handleInput(keys.esc); expect(done).toHaveBeenCalledTimes(1);
  });
  it("copies whole, sections, code interiors and quotes from exact original offsets; Enter stays open", async () => {
    const { view, copy, notify, done } = overlay();
    const blocks = markdown.markdownBlocks(source);
    for (let i = 0; i < blocks.length; i++) {
      view.handleInput(keys.enter); await flush();
      expect(copy).toHaveBeenLastCalledWith(source.slice(blocks[i].start, blocks[i].end));
      expect(notify).toHaveBeenLastCalledWith(COPY_REQUESTED, "info");
      expect(done).not.toHaveBeenCalled();
      view.handleInput(keys.down);
    }
    expect(copy.mock.calls.map(([payload]) => payload)).toContain("  const 中文 = 1;\r\n\tfoo();\r\n");
    view.handleInput(keys.home); view.handleInput(keys.enter); await flush(); expect(copy).toHaveBeenLastCalledWith(source);
    view.handleInput(keys.end); view.handleInput(keys.enter); await flush(); expect(copy).toHaveBeenLastCalledWith("# 尾部\r\n结束");
    view.handleInput(keys.up); view.handleInput(keys.enter); await flush(); expect(copy).toHaveBeenLastCalledWith("> 引用\r\n> 继续\r\n");
  });
  it("pages the preview, clamps ends, resets on selection and reflows after resize", () => {
    const long = Array.from({ length: 100 }, (_, i) => `raw-line-${i}`).join("\n") + "\n```\ninterior\n```";
    const { view, tui } = overlay([{ role: "assistant", source: long }]);
    expect(view.render(100).join("\n")).toContain("raw-line-0");
    view.handleInput(keys.pgDn); expect(view.render(100).join("\n")).not.toContain("raw-line-0\n");
    expect(view.render(100).join("\n")).not.toContain("raw-line-0 ");
    for (let i = 0; i < 100; i++) view.handleInput(keys.pgDn);
    expect(view.render(100).join("\n")).toContain("interior");
    view.handleInput(keys.pgUp); expect(view.render(100).join("\n")).not.toContain("interior");
    view.handleInput(keys.end); expect(view.render(100).join("\n")).toContain("interior");
    expect(view.render(100).join("\n")).toContain("原文 1-2/2");
    tui.terminal.rows = 14;
    expect(view.render(28).length).toBeLessThanOrEqual(12);
  });
  it("caches selected preview layout and invalidates theme/resize output without scanning history again", () => {
    const { view, history, theme } = overlay();
    const blocks = vi.spyOn(history, "blocks");
    view.render(100);
    const cached = (view as any).preview;
    view.render(100); expect((view as any).preview).toBe(cached);
    expect(new Set(blocks.mock.calls.map(([index]) => index))).toEqual(new Set([0]));
    view.render(40); expect((view as any).preview).not.toBe(cached);
    const fg = vi.spyOn(theme, "fg");
    view.invalidate(); view.render(100); expect(fg).toHaveBeenCalled();
    fg.mockRestore();
  });
  it.each(["dark", "light"])("fits wide, narrow, tiny and short terminals and paints all padding in %s", (name) => {
    const { view, theme, tui } = overlay([{ role: "assistant", source: "# 宽字符\n中文 👩‍💻 e\u0301\n" + "averylongword".repeat(40) }], undefined, name);
    const bg = vi.spyOn(theme, "bg");
    for (const rows of [8, 10, 12, 24, 40]) {
      tui.terminal.rows = rows;
      for (const width of [0, 1, 4, 7, 8, 12, 20, 40, 80, 120]) {
        const lines = view.render(width);
        expect(lines.every((line) => visibleWidth(line) === width), `rows=${rows} width=${width}`).toBe(true);
        expect(lines.length, `rows=${rows} width=${width}`).toBeLessThanOrEqual(Math.floor(rows * 0.9));
      }
    }
    expect(bg.mock.calls.every(([token]) => token === "customMessageBg")).toBe(true);
    bg.mockRestore();
  });
  it("renders terminal controls literally but copies them unchanged", async () => {
    const value = "```\n\x1b]52;c;bad\x07\r\n\t  original\x08\n```";
    const { view, copy } = overlay([{ role: "assistant", source: value }]);
    view.handleInput(keys.end);
    const rendered = view.render(100).join("\n");
    expect(rendered).toContain("␛]52;c;bad␇"); expect(rendered).not.toContain("\x1b]52");
    view.handleInput(keys.enter); await flush();
    expect(copy).toHaveBeenCalledWith("\x1b]52;c;bad\x07\r\n\t  original\x08\n");
  });
  it("ignores repeated Enter while pending, captures the old selection, handles rejection and permits retry", async () => {
    const pending = deferred();
    const copy = vi.fn((_text: string) => pending.promise);
    const { view, notify, done } = overlay(undefined, copy);
    view.handleInput(keys.enter); view.handleInput(keys.enter); view.handleInput(keys.end);
    expect(copy).toHaveBeenCalledTimes(1); expect(copy).toHaveBeenCalledWith(source);
    expect(view.render(100).join("\n")).toContain("正在提交");
    pending.reject(new Error("clipboard unavailable")); await flush();
    expect(notify).toHaveBeenLastCalledWith("复制失败：clipboard unavailable", "error");
    expect(view.render(100).join("\n")).toContain("复制失败");
    expect(done).not.toHaveBeenCalled();
    copy.mockResolvedValueOnce(undefined); view.handleInput(keys.enter); await flush();
    expect(copy).toHaveBeenCalledTimes(2); expect(copy).toHaveBeenLastCalledWith("# 尾部\r\n结束");
    expect(notify).toHaveBeenLastCalledWith(COPY_REQUESTED, "info");
  });
  it.each(["resolve", "reject"] as const)("Esc/disposal suppresses late %s UI and never copies again", async (outcome) => {
    const pending = deferred(), copy = vi.fn((_text: string) => pending.promise);
    const { view, notify, done, tui } = overlay(undefined, copy);
    view.handleInput(keys.enter); view.handleInput(keys.esc); view.dispose(); view.close();
    const renders = tui.requestRender.mock.calls.length;
    pending[outcome](new Error("late")); await flush();
    expect(notify).not.toHaveBeenCalled(); expect(tui.requestRender).toHaveBeenCalledTimes(renders);
    view.handleInput(keys.enter); expect(copy).toHaveBeenCalledTimes(1); expect(done).toHaveBeenCalledTimes(1);
  });
  it("Esc before Enter and unknown/paste input never copy or edit anything", () => {
    const { view, copy, done } = overlay();
    view.handleInput("x"); view.handleInput("\x1b[200~paste\x1b[201~"); view.handleInput(keys.esc); view.handleInput(keys.enter);
    expect(copy).not.toHaveBeenCalled(); expect(done).toHaveBeenCalledTimes(1);
  });
});

function commandHarness() {
  initTheme("dark", false);
  const events = new Map<string, Function>(), commands = new Map<string, any>();
  copyBlock({ on: (event: string, handler: Function) => events.set(event, handler), registerCommand: (name: string, command: any) => commands.set(name, command) } as any);
  const branch = vi.fn((): any => [user("current user"), assistant("branch answer")]);
  let view!: CopyOverlay;
  const ui = { notify: vi.fn(), setEditorText: vi.fn(), pasteToEditor: vi.fn(), getEditorText: vi.fn(() => "draft"),
    custom: vi.fn((factory, _options?: unknown) => new Promise<void>((resolve) => {
      view = factory({ requestRender: vi.fn(), terminal: { rows: 40 } }, getThemeByName("dark")!, {}, () => { view.dispose(); resolve(); });
    })) };
  const ctx: any = { mode: "tui", hasUI: true, sessionManager: { getBranch: branch }, ui };
  return { ctx, ui, events, commands, branch, current: () => view, run: () => commands.get("copy-block").handler("", ctx) };
}

describe("copy-block command integration", () => {
  it("opens one overlay, preserves editor draft and built-in /copy, and takes a fresh branch snapshot on reopen", async () => {
    const h = commandHarness(), run = h.run();
    expect(h.ui.custom.mock.calls[0][1]).toEqual({ overlay: true, overlayOptions: { width: "95%", maxHeight: "90%", anchor: "center" } });
    await h.run(); expect(h.ui.custom).toHaveBeenCalledTimes(1);
    h.current().handleInput(keys.esc); await run;
    expect(copyToClipboard).not.toHaveBeenCalled();
    h.branch.mockReturnValue([assistant("replacement branch")]);
    const reopened = h.run(); expect(h.current().render(100).join("\n")).toContain("replacement branch");
    h.current().handleInput(keys.enter); await flush(); expect(copyToClipboard).toHaveBeenCalledWith("replacement branch");
    h.current().handleInput(keys.esc); await reopened;
    expect(h.ui.setEditorText).not.toHaveBeenCalled(); expect(h.ui.pasteToEditor).not.toHaveBeenCalled(); expect(h.ui.getEditorText).not.toHaveBeenCalled();
    expect(h.commands.has("copy")).toBe(false);
  });
  it.each(["session_tree", "session_start", "session_shutdown"])("%s retires old history and pending clipboard feedback", async (event) => {
    const h = commandHarness(), pending = deferred(); vi.mocked(copyToClipboard).mockReturnValueOnce(pending.promise);
    const run = h.run(), old = h.current(); old.handleInput(keys.enter);
    h.events.get(event)!({}, h.ctx); await run;
    expect(h.ui.notify).not.toHaveBeenCalled();
    h.branch.mockReturnValue([assistant("new branch")]);
    const reopened = h.run(); pending.resolve(); await flush();
    expect(h.ui.notify).not.toHaveBeenCalled(); expect(h.current().render(100).join("\n")).toContain("new branch");
    old.handleInput(keys.enter); expect(copyToClipboard).toHaveBeenCalledTimes(1);
    h.current().handleInput(keys.esc); await reopened;
  });
  it("retires during factory setup and does not let an old finally close a new overlay", async () => {
    const h = commandHarness();
    let factory!: Function, finish!: () => void;
    h.ui.custom.mockImplementationOnce((value) => { factory = value; return new Promise<void>((resolve) => { finish = resolve; }); });
    const old = h.run(); h.events.get("session_tree")!({}, h.ctx);
    const fresh = h.run(), current = h.current();
    const stale = factory({ requestRender: vi.fn(), terminal: { rows: 40 } }, getThemeByName("dark")!, {}, finish);
    await old; stale.handleInput(keys.enter); expect(copyToClipboard).not.toHaveBeenCalled();
    current.handleInput(keys.enter); await flush(); expect(copyToClipboard).toHaveBeenCalledTimes(1);
    current.handleInput(keys.esc); await fresh;
  });
  it("reports an empty branch and guards RPC/print instead of trying unsupported custom UI", async () => {
    const h = commandHarness(); h.branch.mockReturnValue([]); await h.run();
    expect(h.ui.notify).toHaveBeenCalledWith(expect.stringContaining("没有可复制"), "warning");
    expect(h.ui.custom).not.toHaveBeenCalled();
    h.ctx.mode = "rpc"; await h.run(); expect(h.ui.notify).toHaveBeenLastCalledWith("copy-block 需要交互终端", "warning");
    h.ctx.mode = "print"; h.ctx.hasUI = false; await h.run(); expect(h.ui.custom).not.toHaveBeenCalled();
  });
});
