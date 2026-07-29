import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  initTheme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { installStyledPatches, setStyledActive } from "../extensions/ui/styled/index.js";

const flag = Symbol.for("my-pi-package.ui.renderer-patches.v1");
const tool = ToolExecutionComponent.prototype as any;
const assistant = AssistantMessageComponent.prototype as any;
const user = UserMessageComponent.prototype as any;
const custom = CustomMessageComponent.prototype as any;
const saved = {
  updateDisplay: tool.updateDisplay,
  getCallRenderer: tool.getCallRenderer,
  getResultRenderer: tool.getResultRenderer,
  assistantUpdate: assistant.updateContent,
  userRebuild: user.rebuild,
  userRender: user.render,
  customRebuild: custom.rebuild,
  customRender: custom.render,
};

const theme: any = {
  name: "slop",
  fg: (_token: string, text: string) => text,
  bg: (_token: string, text: string) => text,
  bold: (text: string) => text,
};
const ui: any = { theme };
const markdownTheme: any = Object.fromEntries([
  "heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder",
  "hr", "listBullet", "bold", "italic", "strikethrough", "underline",
].map((name) => [name, (text: string) => text]));

function rendered(component: any, width = 100): string {
  return component.render(width).join("\n");
}

afterEach(() => {
  setStyledActive(false);
  tool.updateDisplay = saved.updateDisplay;
  tool.getCallRenderer = saved.getCallRenderer;
  tool.getResultRenderer = saved.getResultRenderer;
  assistant.updateContent = saved.assistantUpdate;
  user.rebuild = saved.userRebuild;
  user.render = saved.userRender;
  custom.rebuild = saved.customRebuild;
  custom.render = saved.customRender;
  delete tool[flag];
  delete assistant[flag];
  delete user[flag];
  delete custom[flag];
});

describe("renderer-only patches", () => {
  it("calls originals, preserves custom renderers, gates fallback, and restores layout", () => {
    const originalRenderer = vi.fn();
    const display = vi.fn(function (this: any) { this.order.push("original"); return "kept"; });
    tool.updateDisplay = display;
    tool.getCallRenderer = vi.fn(function (this: any) { return this.hasRenderer ? originalRenderer : undefined; });
    tool.getResultRenderer = vi.fn(function (this: any) { return this.hasRenderer ? originalRenderer : undefined; });
    installStyledPatches();

    const bg = vi.fn();
    const instance: any = Object.create(tool);
    instance.order = [];
    instance.toolName = "third-party";
    instance.hasRenderer = true;
    instance.contentBox = { paddingX: 7, paddingY: 8, bgFn: bg, setBgFn(value: unknown) { this.bgFn = value; } };
    instance.result = { isError: false };
    instance.isPartial = false;

    expect(instance.getCallRenderer()).toBe(originalRenderer);
    expect(instance.updateDisplay()).toBe("kept");
    setStyledActive(true, ui);
    expect(instance.getCallRenderer()).toBe(originalRenderer);
    instance.hasRenderer = false;
    expect(instance.getCallRenderer()).toBeTypeOf("function");
    expect(instance.getResultRenderer()).toBeTypeOf("function");
    expect(instance.updateDisplay()).toBe("kept");
    expect(instance.contentBox.paddingY).toBe(0);

    setStyledActive(false);
    instance.updateDisplay();
    expect(instance.contentBox.paddingX).toBe(7);
    expect(instance.contentBox.paddingY).toBe(8);
    expect(instance.contentBox.bgFn).toBe(bg);
  });

  it("styles assistant, thinking, user, and custom messages only while active", () => {
    installStyledPatches();
    setStyledActive(true, ui);
    const message: any = {
      role: "assistant", content: [
        { type: "thinking", thinking: "consider this" },
        { type: "text", text: "answer here" },
      ],
    };
    const assistantComponent: any = Object.create(assistant);
    assistantComponent.contentContainer = { children: [], clear() { this.children = []; }, addChild(value: any) { this.children.push(value); } };
    assistantComponent.markdownTheme = markdownTheme;
    saved.assistantUpdate.call(assistantComponent, message);
    assistantComponent.updateContent(message);
    const output = assistantComponent.contentContainer.children.flatMap((child: any) => child.render?.(80) ?? []).join("\n");
    expect(output).toContain("✽");
    expect(output).toContain("●");

    const userComponent = new UserMessageComponent("hello", markdownTheme);
    expect(rendered(userComponent)).toContain("❯");
    const customComponent = new CustomMessageComponent({ customType: "notice", content: "details" } as any, undefined, markdownTheme);
    expect(rendered(customComponent)).toContain("Custom message");

    setStyledActive(false);
    (userComponent as any).rebuild();
    expect((userComponent as any).children[0].children[0].constructor.name).toBe("Markdown");
  });

  it("preserves unrelated custom-message renderers while adapting subagent notifications", () => {
    initTheme("dark", false);
    installStyledPatches();
    setStyledActive(true, ui);
    const semanticRenderer = vi.fn(() => new Markdown("semantic renderer", 0, 0, markdownTheme));
    const ordinary = new CustomMessageComponent(
      { customType: "third-party", content: "raw content" } as any,
      semanticRenderer as any,
      markdownTheme,
    );
    expect(rendered(ordinary)).toContain("semantic renderer");
    expect(semanticRenderer).toHaveBeenCalledOnce();
    setStyledActive(false);
    rendered(ordinary);
    setStyledActive(true, ui);
    rendered(ordinary);
    expect(semanticRenderer).toHaveBeenCalledOnce();

    const subagentRenderer = vi.fn(() => new Markdown("foreign style", 0, 0, markdownTheme));
    const notification = new CustomMessageComponent(
      { customType: "subagent-notify", content: "Background task completed: **worker**\n\nDone safely" } as any,
      subagentRenderer as any,
      markdownTheme,
    );
    expect(rendered(notification)).toContain("Subagent worker");
    expect(rendered(notification)).not.toContain("foreign style");
  });

  it("uses local renderers for every known builtin including status, expansion, and edit diff", () => {
    tool.getCallRenderer = vi.fn(() => vi.fn());
    tool.getResultRenderer = vi.fn(() => vi.fn());
    installStyledPatches();
    setStyledActive(true, ui);
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      const instance: any = Object.create(tool);
      instance.toolName = name;
      const state: any = {};
      const call = instance.getCallRenderer();
      const callOutput = rendered(call({ path: "a.ts", command: "echo ok", pattern: "x", edits: [{ oldText: "a", newText: "b" }] }, theme, { state }));
      expect(callOutput.toLowerCase()).toContain(name === "ls" ? "ls" : name);
      const result = instance.getResultRenderer();
      const details = name === "edit" ? { diff: "@@ -1 +1 @@\n-old\n+new" } : undefined;
      const resultOutput = rendered(result({ content: [{ type: "text", text: "one\ntwo" }], details }, { expanded: true }, theme, { state, isError: false }));
      expect(resultOutput).toContain("Done");
      if (name === "edit") expect(resultOutput).toMatch(/old|new/);
    }
  });

  it("bounds generic fallback and emits placeholders for non-text content", () => {
    tool.getCallRenderer = vi.fn(() => undefined);
    tool.getResultRenderer = vi.fn(() => undefined);
    installStyledPatches();
    setStyledActive(true, ui);
    const instance: any = Object.create(tool);
    instance.toolName = "unknown";
    const callOutput = rendered(instance.getCallRenderer()({ nested: { secret: "not rendered" } }, theme));
    expect(callOutput).toContain("[non-text content omitted]");
    expect(callOutput).not.toContain("secret");
    const long = Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n");
    const output = rendered(instance.getResultRenderer()({ content: [{ type: "image", data: "base64" }, { type: "text", text: long }] }, { expanded: true }, theme));
    expect(output).toContain("[non-text content omitted]");
    expect(output).not.toContain("base64");
    expect(output.split("\n").length).toBeLessThanOrEqual(42);
  });

  it("shares active runtime state with wrappers installed before a fresh module reload", async () => {
    tool.getCallRenderer = vi.fn(() => undefined);
    tool.getResultRenderer = vi.fn(() => undefined);
    installStyledPatches();
    setStyledActive(false);
    const instance: any = Object.create(tool);
    instance.toolName = "unknown";
    expect(instance.getCallRenderer()).toBeUndefined();

    vi.resetModules();
    const fresh = await import("../extensions/ui/styled/index.js");
    fresh.setStyledActive(true, ui);
    expect(instance.getCallRenderer()).toBeTypeOf("function");
    fresh.setStyledActive(false);
    expect(instance.getCallRenderer()).toBeUndefined();
  });
});
