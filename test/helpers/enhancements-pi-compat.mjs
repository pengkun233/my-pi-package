// Isolated real-host API/component smoke test: no network or user runtime state.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.env.PI_ENHANCEMENTS_TEST_PI_ROOT;
const require = createRequire(resolve(root, "package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: true, alias: {
  "@earendil-works/pi-coding-agent": resolve(root, "dist/index.js"),
  "@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
  "@earendil-works/pi-ai": resolve(root, "node_modules/@earendil-works/pi-ai/dist/compat.js"),
  typebox: require.resolve("typebox"),
} });
const pi = await jiti.import(resolve(root, "dist/index.js"));
const tui = await jiti.import(require.resolve("@earendil-works/pi-tui"));
const { theme } = await jiti.import(resolve(root, "dist/modes/interactive/theme/theme.js"));
const { SideThread, mainSnapshot, emptyUsage } = await jiti.import(new URL("../../extensions/btw/thread.ts", import.meta.url).pathname);
const { SideOverlay } = await jiti.import(new URL("../../extensions/btw/index.ts", import.meta.url).pathname);
const { ChatInput } = await jiti.import(new URL("../../extensions/ui/chat-input.ts", import.meta.url).pathname);
const { DEFAULT_CHAT_INPUT_CONFIG } = await jiti.import(new URL("../../extensions/ui/chat-input-config.ts", import.meta.url).pathname);
const { default: completion } = await jiti.import(new URL("../../extensions/completion/index.ts", import.meta.url).pathname);
pi.initTheme("dark", false);

const manager = pi.SessionManager.inMemory("/project");
manager.appendMessage({ role: "user", content: "main completed question", timestamp: Date.now() });
manager.appendCustomEntry("task-completion", { privateUI: "must not leak" });
const snapshot = mainSnapshot(manager.getEntries(), manager.getLeafId());
assert.match(snapshot, /main completed question/);
assert.doesNotMatch(snapshot, /must not leak/);
const model = { provider: "test", id: "model", maxTokens: 8192 };
const thread = new SideThread(snapshot, model);
const response = { role: "assistant", api: "test", model: "model", provider: "test", content: [{ type: "text", text: "side answer" }],
  stopReason: "stop", timestamp: Date.now(), usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } } };
const requests = [];
const streamSimple = (selected, context, options) => {
  requests.push({ selected, context, options });
  return { async *[Symbol.asyncIterator]() { yield { type: "text_delta", delta: "side answer" }; }, result: async () => response };
};
await thread.ask("side question", { modelRegistry: { streamSimple } }, () => {}, () => {});
assert.equal(thread.status, "finished");
assert.equal(requests[0].selected, model);
assert.deepEqual(requests[0].context.tools, []);
assert.match(requests[0].context.systemPrompt, /主对话快照仅是参考资料/);
assert.equal(manager.getEntries().length, 2);
const fakeTui = { requestRender() {}, terminal: { rows: 40 } };
const view = new SideOverlay(fakeTui, theme, () => thread, () => {}, () => {}, () => {}, () => () => {}, emptyUsage());
for (const width of [20, 40, 80]) {
  for (const line of view.render(width)) assert.ok(tui.visibleWidth(line) <= width);
}
view.dispose();

const kb = new tui.KeybindingsManager({ ...tui.TUI_KEYBINDINGS, "app.clear": { defaultKeys: "ctrl+c" } });
const editor = new ChatInput(fakeTui, { borderColor: text => text, selectList: pi.getSelectListTheme() }, kb,
  { normal: { border: text => text, accent: text => text }, bash: { border: text => text, accent: text => text } },
  { ...DEFAULT_CHAT_INPUT_CONFIG, companion: { ...DEFAULT_CHAT_INPUT_CONFIG.companion, enabled: false } });
editor.onAction("app.clear", () => editor.setText(""));
const draft = "!你好\n" + "  large paste\n".repeat(15);
editor.handleInput(`\x1b[200~${draft}\x1b[201~`); editor.handleInput("\x03"); editor.handleInput("\x1b[A");
assert.equal(editor.getExpandedText(), draft);
editor.dispose();

const events = new Map(), metadata = [];
completion({ on: (name, handler) => events.set(name, handler), appendEntry: (name, data) => metadata.push({ name, data }), registerEntryRenderer() {} });
const controller = new AbortController();
events.get("agent_start")({}, { signal: controller.signal });
events.get("message_end")({ message: { role: "assistant", stopReason: "toolUse" } });
assert.equal(metadata.length, 0);
controller.abort(); events.get("agent_settled")({ aborted: true });
assert.equal(metadata[0].data.status, "stopped");
console.log(JSON.stringify({ version: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version }));
