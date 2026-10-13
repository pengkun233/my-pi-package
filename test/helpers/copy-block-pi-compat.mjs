// Real Pi loader/session/theme/TUI smoke test. No terminal or clipboard side effects.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = process.env.PI_COPY_BLOCK_TEST_PI_ROOT;
const require = createRequire(resolve(root, "package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: true, alias: {
  "@earendil-works/pi-coding-agent": resolve(root, "dist/index.js"),
  "@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
} });
const pi = await jiti.import(resolve(root, "dist/index.js"));
const tui = await jiti.import(require.resolve("@earendil-works/pi-tui"));
const themes = await jiti.import(resolve(root, "dist/modes/interactive/theme/theme.js"));
const { CopyHistory, copyHistory } = await jiti.import(new URL("../../extensions/copy-block/history.ts", import.meta.url).pathname);
const { CopyOverlay, COPY_REQUESTED } = await jiti.import(new URL("../../extensions/copy-block/overlay.ts", import.meta.url).pathname);
const { default: copyBlock } = await jiti.import(new URL("../../extensions/copy-block/index.ts", import.meta.url).pathname);

const manager = pi.SessionManager.inMemory("/project");
manager.appendMessage({ role: "user", content: "用户上下文", timestamp: Date.now() });
manager.appendCustomEntry("task-completion", { text: "must not leak" });
manager.appendMessage({ role: "assistant", api: "test", model: "test", provider: "test", timestamp: Date.now(),
  stopReason: "stop", content: [{ type: "text", text: "```ts\r\n  const 中文 = 1;\r\n```" }, { type: "thinking", thinking: "secret" }],
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
assert.equal(copyHistory(manager.getBranch()).length, 2);
const fakeTui = { requestRender() {}, terminal: { rows: 40 } };
for (const name of ["dark", "light"]) {
  pi.initTheme(name, false);
  const theme = themes.getThemeByName(name);
  const copied = [], feedback = [];
  let closed = false;
  const view = new CopyOverlay(fakeTui, theme, new CopyHistory(copyHistory(manager.getBranch())),
    async (payload) => { copied.push(payload); }, (message) => feedback.push(message), () => { closed = true; });
  for (const width of [1, 8, 20, 40, 80, 120]) {
    const lines = view.render(width);
    for (const line of lines) assert.equal(tui.visibleWidth(line), width);
    assert.ok(lines.length <= 32);
  }
  assert.match(view.render(100).join("\n"), /Assistant 2\/2/);
  view.handleInput("\x1b[F"); view.handleInput("\r");
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(copied, ["  const 中文 = 1;\r\n"]);
  assert.deepEqual(feedback, [COPY_REQUESTED]);
  assert.equal(closed, false);
  view.handleInput("\x1b[D"); assert.match(view.render(100).join("\n"), /用户上下文/);
  view.handleInput("\x1b"); assert.equal(closed, true);
  view.dispose();
}
const commands = new Map(), events = new Map();
copyBlock({ on: (name, handler) => events.set(name, handler), registerCommand: (name, command) => commands.set(name, command) });
let view;
const ctx = { mode: "tui", hasUI: true, sessionManager: manager, ui: {
  notify() {},
  setEditorText() { assert.fail("copy-block must not change the editor draft"); },
  custom(factory) {
    return new Promise((done) => { view = factory(fakeTui, themes.getThemeByName("light"), {}, done); });
  },
} };
const interaction = commands.get("copy-block").handler("", ctx);
events.get("session_tree")({}, ctx);
await interaction;
view.handleInput("\r"); // Closed component cannot reach the real clipboard helper.
console.log("copy-block real-host loader, session, themes, rendering, keys and lifecycle passed");
