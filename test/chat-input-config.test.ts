import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_INPUT_CONFIG,
  loadChatInputConfig,
  mergeChatInputConfig,
} from "../extensions/ui/chat-input-config.js";
import { applyColor } from "../extensions/ui/chat-input-utils.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("input configuration", () => {
  it("uses package defaults with the companion enabled and no mode configuration", () => {
    expect(DEFAULT_CHAT_INPUT_CONFIG).toMatchObject({
      borderColor: "borderAccent",
      prefix: "❯",
      companion: { enabled: true, color: "accent" },
    });
    expect(Object.keys(DEFAULT_CHAT_INPUT_CONFIG)).not.toEqual(expect.arrayContaining([
      "planModePrefix",
      "planModePrefixColor",
      "planModeBorderColor",
      "chatModePrefix",
      "chatModePrefixColor",
      "chatModeBorderColor",
    ]));
  });

  it("allows machine-local overrides without disabling package-owned defaults", () => {
    const merged = mergeChatInputConfig({
      boxedView: false,
      boxPadX: 3,
      menuGap: 2,
      extraMenuIndent: 4,
      borderColor: "#112233",
      prefix: "λ",
      prefixColor: "warning",
      companion: { color: "#abcdef" },
    });

    expect(merged).toMatchObject({
      boxedView: false,
      boxPadX: 3,
      menuGap: 2,
      extraMenuIndent: 4,
      borderColor: "#112233",
      prefix: "λ",
      prefixColor: "warning",
      companion: { enabled: true, color: "#abcdef" },
    });
  });

  it("loads local JSON and falls back for missing or malformed files", () => {
    const directory = mkdtempSync(join(tmpdir(), "my-pi-input-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "chat-input.json");

    expect(loadChatInputConfig(path)).toEqual(DEFAULT_CHAT_INPUT_CONFIG);
    writeFileSync(path, JSON.stringify({ prefix: "→", companion: { enabled: false } }));
    expect(loadChatInputConfig(path)).toMatchObject({ prefix: "→", companion: { enabled: false, color: "accent" } });
    writeFileSync(path, "{");
    expect(loadChatInputConfig(path)).toEqual(DEFAULT_CHAT_INPUT_CONFIG);
  });

  it("applies six-digit hex colors directly and delegates theme tokens", () => {
    const theme = { fg: (token: string, text: string) => `<${token}>${text}</${token}>` } as any;
    expect(applyColor(theme, "#c07898", "cat")).toBe("\u001b[38;2;192;120;152mcat\u001b[0m");
    expect(applyColor(theme, "accent", "cat")).toBe("<accent>cat</accent>");
  });
});
