// Runs in a separate process: never patches the user's running Pi.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

const root = process.env.PI_STYLED_TEST_PI_ROOT;
const require = createRequire(resolve(root, "package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  moduleCache: true,
  alias: {
    "@earendil-works/pi-coding-agent": resolve(root, "dist/index.js"),
    "@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
    "@earendil-works/pi-ai": resolve(root, "node_modules/@earendil-works/pi-ai/dist/compat.js"),
    typebox: require.resolve("typebox"),
  },
});
const pi = await jiti.import(resolve(root, "dist/index.js"));
const tui = await jiti.import(require.resolve("@earendil-works/pi-tui"));
const styled = await jiti.import(new URL("../../extensions/ui/styled/index.ts", import.meta.url).pathname);
pi.initTheme("dark", false);
const { theme } = await jiti.import(resolve(root, "dist/modes/interactive/theme/theme.js"));
styled.installStyledPatches();
styled.setStyledActive(true, { theme });
const plain = (component, width = 60) => component.render(width).map(stripVTControlCharacters).join("\n");
const assistantMessage = { role: "assistant", content: [
  { type: "thinking", thinking: "consider this" }, { type: "text", text: "answer here" },
] };
const scenario = process.argv[2];
if (scenario === "defaults") {
  const user = new pi.UserMessageComponent("hello");
  assert.match(plain(user), /❯ hello/);
  assert.match(user.render(60).join("\n"), /\x1b\[48;/);
  const assistant = new pi.AssistantMessageComponent({ role: "assistant", content: [
    { type: "thinking", thinking: "consider this" }, { type: "text", text: "answer here" },
  ] });
  assert.match(plain(assistant), /✽ consider this/);
  assert.match(plain(assistant), /● answer here/);
}
if (scenario === "custom") {
  const user = new pi.UserMessageComponent("hello", pi.getMarkdownTheme(), 3);
  assert.match(plain(user), /^\s*U hello/m);
  assert.doesNotMatch(user.render(60).join("\n"), /\x1b\[48;/);
  const assistant = new pi.AssistantMessageComponent(assistantMessage);
  assert.match(plain(assistant), /T consider this/);
  assert.match(plain(assistant), /A answer here/);
  assert.match(assistant.render(60).join("\n"), new RegExp(theme.getFgAnsi("success").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "A"));
  for (const width of [1, 2, 3, 8, 20, 60]) {
    for (const component of [user, assistant]) {
      for (const line of component.render(width)) assert.ok(tui.visibleWidth(line) <= width, `${width}: ${line}`);
    }
  }
  // Reload-like disable/enable before any render: old instances must pick up
  // the new config even when the boolean active state is again unchanged.
  writeFileSync(resolve(process.env.PI_CODING_AGENT_DIR, "configs/styled-outputs.json"), "{}");
  styled.setStyledActive(false);
  styled.setStyledActive(true, { theme });
  assert.match(plain(user), /❯ hello/);
  assert.match(user.render(60).join("\n"), /\x1b\[48;/);
  styled.setStyledActive(false);
  assert.doesNotMatch(plain(user), /U hello/);
  assert.match(user.render(60).join("\n"), /\x1b\[48;/);
  assert.doesNotMatch(plain(assistant), /[AT] (answer|consider)/);
}
if (scenario === "empty") {
  const user = new pi.UserMessageComponent("hello", pi.getMarkdownTheme(), 3);
  const assistant = new pi.AssistantMessageComponent(assistantMessage, false, pi.getMarkdownTheme(), "Thinking...", 3);
  const styledUser = plain(user);
  const styledAssistant = plain(assistant);
  assert.match(styledUser, /^ {3}hello/m);
  assert.match(styledAssistant, /^ {3}answer here/m);
  styled.setStyledActive(false);
  assert.equal(plain(user), styledUser);
  assert.equal(plain(assistant), styledAssistant);
}
if (scenario === "fallback") {
  const user = new pi.UserMessageComponent("hello");
  assert.match(plain(user), /❯ hello/);
  assert.match(user.render(60).join("\n"), /\x1b\[48;/);
  assert.match(plain(new pi.AssistantMessageComponent(assistantMessage)), /● answer here/);
}
if (scenario === "interaction-transform") {
  const contexts = [];
  const transformer = (markdown, context) => { contexts.push(context); return `transformed ${markdown}`; };
  const assistant = new pi.AssistantMessageComponent(assistantMessage, false, pi.getMarkdownTheme(), "Thinking...", 3, [transformer]);
  const nativeMarkdown = assistant.contentContainer.children.find(child => child.constructor.name === "Markdown");
  const options = nativeMarkdown.options;
  const region = assistant.contentContainer.children.find(child => child.constructor.name === "MouseRegion");
  const callback = region.onMouse;
  assert.match(plain(assistant), /^ {3}● transformed answer here/m);
  assert.match(plain(assistant), /✽ transformed consider this/);
  assert.equal(nativeMarkdown.paddingX, 3);
  assert.equal(nativeMarkdown.options, options);
  assert.equal(region.onMouse, callback);
  assert.equal(region.child.defaultTextStyle.italic, true);
  assert.ok(contexts.some(context => context.messageType === "assistant" && context.availableWidth === 52 && context.isStreaming === false));
  assert.ok(contexts.some(context => context.messageType === "assistant-thinking"));
  assert.equal(region.handleMouse({ type: "click", button: "right" }), undefined);
  assert.equal(region.handleMouse({ type: "click", button: "left" }).handled, true);
  assert.doesNotMatch(plain(assistant), /consider this/);
  assert.match(plain(assistant), /✽ Thinking\.\.\./);
  const collapsed = assistant.contentContainer.children.find(child => child.constructor.name === "MouseRegion");
  assert.equal(collapsed.handleMouse({ type: "click", button: "left" }).handled, true);
  assert.match(plain(assistant), /✽ transformed consider this/);
  assistant.updateContent(assistantMessage, true);
  plain(assistant);
  assert.ok(contexts.some(context => context.messageType === "assistant" && context.isStreaming === true));
  assistant.setOutputPad(5);
  assert.match(plain(assistant), /^ {5}● transformed answer here/m);
  const user = new pi.UserMessageComponent("7. item\\!", pi.getMarkdownTheme(), 3, [transformer]);
  assert.match(plain(user), /^ {3}❯ transformed 7\. item\\!/m);
  const markdown = user.children[0];
  assert.equal(markdown.options.preserveOrderedListMarkers, true);
  assert.equal(markdown.options.preserveBackslashEscapes, true);
  assert.ok(contexts.some(context => context.messageType === "user" && context.availableWidth === 52));
  user.setOutputPad(5);
  assert.match(plain(user), /^ {5}❯ transformed 7\. item\\!/m);
  // A standalone ordered list is not silently renumbered.
  assert.match(plain(new pi.UserMessageComponent("7. item")), /❯ 7\. item/);
}
console.log(JSON.stringify({ scenario, version: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version }));
