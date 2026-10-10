import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_STYLED_MESSAGES_CONFIG, loadStyledMessagesConfig, mergeStyledMessagesConfig } from "../extensions/ui/styled/config.js";

describe("machine-local message style configuration", () => {
  it.each([null, [], true, "invalid", 9])("falls back for an invalid root: %s", value => {
    expect(mergeStyledMessagesConfig(value)).toEqual(DEFAULT_STYLED_MESSAGES_CONFIG);
  });
  it("merges each valid field independently and rejects terminal controls", () => {
    expect(mergeStyledMessagesConfig({
      assistantMessage: { prefix: "→", prefixColor: 7 },
      thinkingMessage: { prefix: "\x1b[31m", prefixColor: "success" },
      userMessage: { prefix: " ", prefixColor: "bad\ncolor", isThemeBackgroundVisible: false },
    })).toEqual({
      assistantMessage: { prefix: "→", prefixColor: "text" },
      thinkingMessage: { prefix: "✽", prefixColor: "success" },
      userMessage: { prefix: "", prefixColor: "accent", isThemeBackgroundVisible: false },
    });
    expect(mergeStyledMessagesConfig({ userMessage: { prefix: "x".repeat(65), isThemeBackgroundVisible: 0 } }).userMessage)
      .toEqual(DEFAULT_STYLED_MESSAGES_CONFIG.userMessage);
  });
  it("does not share mutable defaults or earlier results", () => {
    const config = mergeStyledMessagesConfig();
    config.assistantMessage.prefix = "changed";
    expect(mergeStyledMessagesConfig()).toEqual(DEFAULT_STYLED_MESSAGES_CONFIG);
  });
  it("reads overrides without writing files and falls back for missing/broken files", () => {
    const dir = mkdtempSync(join(tmpdir(), "styled-config-"));
    const path = join(dir, "styled-outputs.json");
    try {
      expect(loadStyledMessagesConfig(path)).toEqual(DEFAULT_STYLED_MESSAGES_CONFIG);
      writeFileSync(path, "{invalid");
      expect(loadStyledMessagesConfig(path)).toEqual(DEFAULT_STYLED_MESSAGES_CONFIG);
      writeFileSync(path, JSON.stringify({ userMessage: { prefix: "", isThemeBackgroundVisible: false } }));
      expect(loadStyledMessagesConfig(path).userMessage).toEqual({ prefix: "", prefixColor: "accent", isThemeBackgroundVisible: false });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
