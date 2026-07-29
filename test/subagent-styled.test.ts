import { describe, expect, it, vi } from "vitest";
import { Container, Markdown, visibleWidth } from "@earendil-works/pi-tui";
import {
  createAssistantMessage,
  createCustomMessage,
  createSubagentNotification,
} from "../extensions/ui/styled/messages.js";
import {
  installSubagentWidgetAdapter,
  wrapSubagentResultRenderer,
} from "../extensions/ui/styled/subagent.js";

const theme: any = {
  name: "slop",
  fg: (_token: string, text: string) => text,
  bg: (token: string, text: string) => `[${token}]${text}`,
  bold: (text: string) => text,
};
const markdownTheme: any = Object.fromEntries([
  "heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder",
  "hr", "listBullet", "bold", "italic", "strikethrough", "underline",
].map((name) => [name, (text: string) => text]));

function plainTheme() {
  return { ...theme, bg: (_token: string, text: string) => text };
}

describe("subagent foreground rendering", () => {
  it("keeps the existing renderer and gives Markdown/code fences the Pikit gutter", () => {
    const source = new Container();
    source.addChild(new Markdown("Result\n\n```ts\nconst value = 1;\n```", 0, 0, markdownTheme));
    const original = vi.fn(() => source);
    const component = wrapSubagentResultRenderer(original)(
      { content: [] },
      { expanded: true },
      plainTheme(),
      { lastComponent: undefined },
    );

    const lines = component.render(30);
    expect(original).toHaveBeenCalledOnce();
    expect(lines.join("\n")).toContain("   ```ts");
    expect(lines.join("\n")).toContain("     const value = 1;");
    expect(lines.every((line) => visibleWidth(line) <= 30)).toBe(true);
  });

  it("drops the gutter in very narrow terminals without exceeding width", () => {
    const source = new Container();
    source.addChild(new Markdown("```js\nlongIdentifier();\n```", 0, 0, markdownTheme));
    const component = wrapSubagentResultRenderer(() => source)({}, { expanded: true }, plainTheme(), {});
    const lines = component.render(8);
    expect(lines.every((line) => visibleWidth(line) <= 8)).toBe(true);
    expect(lines[0]?.trimEnd()).toBe("```js");
  });
});

describe("subagent notifications", () => {
  it("renders a compact successful notification and expanded fenced output", () => {
    const component = createSubagentNotification({
      customType: "subagent-notify",
      content: "Background task completed: **worker**\n\nImplemented the helper.\n\n```ts\nexport const ok = true;\n```\n\nSession file: /tmp/session.jsonl",
    }, markdownTheme, plainTheme());

    const collapsed = component.render(60).join("\n");
    expect(collapsed).toContain("✓ Subagent worker");
    expect(collapsed).toContain("└─ Completed");
    expect(collapsed).toContain("Implemented the helper.");
    expect(collapsed).not.toContain("export const ok");

    component.setExpanded(true);
    const expanded = component.render(60);
    expect(expanded.join("\n")).toContain("   ```ts");
    expect(expanded.join("\n")).toContain("     export const ok = true;");
    expect(expanded.join("\n")).toContain("Session file: /tmp/session.jsonl");
    expect(expanded.every((line) => visibleWidth(line) <= 60)).toBe(true);
  });

  it("never exceeds widths 1-8 for message headers, prefixes, or expanded output", () => {
    const notification = createSubagentNotification({
      customType: "subagent-notify",
      content: "Background task completed: **an-extremely-long-agent-name**\n\n```ts\nconst longIdentifier = true;\n```",
    }, markdownTheme, plainTheme());
    notification.setExpanded(true);
    const custom = createCustomMessage({
      customType: "a-very-long-custom-message-type",
      content: "long custom message output",
      details: { title: "an-even-longer-title" },
    }, markdownTheme, plainTheme());
    custom.setExpanded(true);
    const assistant = createAssistantMessage("long assistant output", markdownTheme, plainTheme());

    for (let width = 1; width <= 8; width++) {
      for (const component of [notification, custom, assistant]) {
        expect(component.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
      }
    }
  });

  it("distinguishes failed, paused, and grouped parallel notifications", () => {
    const failed = createSubagentNotification({
      customType: "subagent-notify",
      content: "Background task failed: **worker**\n\nTests failed",
    }, markdownTheme, plainTheme()).render(50).join("\n");
    const paused = createSubagentNotification({
      customType: "subagent-notify",
      content: "Background task paused: **worker**\n\nPaused after interrupt.",
    }, markdownTheme, plainTheme()).render(50).join("\n");
    const grouped = createSubagentNotification({
      customType: "subagent-notify",
      content: "Background tasks completed (2): **a**, **b**\n\n1. a\nfirst result\n\n2. b\nsecond result",
    }, markdownTheme, plainTheme()).render(50).join("\n");

    expect(failed).toContain("✗ Subagent worker");
    expect(failed).toContain("Failed");
    expect(paused).toContain("■ Subagent worker");
    expect(paused).toContain("Paused");
    expect(grouped).toContain("Subagent parallel (2)");
    expect(grouped).toContain("first result");
  });
});

describe("subagent runtime widget adapter", () => {
  it("adds a pending card while forwarding render, input, invalidation, and disposal", () => {
    let registered: any;
    const originalSetWidget = vi.fn((_key: string, content: any, options?: any) => {
      registered = { content, options };
    });
    const ui: any = { setWidget: originalSetWidget };
    const disposeAdapter = installSubagentWidgetAdapter(ui);
    const source = {
      render: vi.fn(() => ["agent one · running"]),
      invalidate: vi.fn(),
      handleInput: vi.fn(),
      dispose: vi.fn(),
      wantsKeyRelease: true,
    };
    const factory = vi.fn(() => source);
    const tui = { requestRender: vi.fn() };

    ui.setWidget("subagent-fleet-status", factory, { placement: "belowEditor" });
    const shell = registered.content(tui, plainTheme());
    const output = shell.render(50).join("\n");
    expect(output).toContain("Subagent · running");
    expect(output).toContain("agent one · running");
    for (let width = 1; width <= 8; width++) {
      expect(shell.render(width).every((line: string) => visibleWidth(line) <= width)).toBe(true);
    }
    expect(registered.options).toEqual({ placement: "belowEditor" });
    shell.handleInput("down");
    shell.invalidate();
    expect(source.handleInput).toHaveBeenCalledWith("down");
    expect(source.invalidate).toHaveBeenCalled();
    expect(shell.wantsKeyRelease).toBe(true);

    disposeAdapter();
    expect(ui.setWidget).toBe(originalSetWidget);
    expect(tui.requestRender).toHaveBeenCalled();
    expect(shell.render(50)).toEqual(["agent one · running"]);
    shell.dispose();
    expect(source.dispose).toHaveBeenCalledOnce();
  });

  it("leaves unrelated widgets untouched and can reactivate an existing shell", () => {
    let registered: any;
    const originalSetWidget = vi.fn((_key: string, content: any) => { registered = content; });
    const ui: any = { setWidget: originalSetWidget };
    const firstDispose = installSubagentWidgetAdapter(ui);
    const unrelated = vi.fn(() => ({ render: () => ["other"], invalidate() {} }));
    ui.setWidget("other-extension", unrelated);
    expect(registered).toBe(unrelated);

    const source = { render: () => ["live"], invalidate() {} };
    ui.setWidget("subagent-async", () => source);
    const tui = { requestRender: vi.fn() };
    const shell = registered(tui, plainTheme());
    expect(shell.render(40).join("\n")).toContain("Async subagents");
    firstDispose();
    expect(shell.render(40)).toEqual(["live"]);

    const secondDispose = installSubagentWidgetAdapter(ui);
    expect(shell.render(40).join("\n")).toContain("Async subagents");
    secondDispose();
  });
});
