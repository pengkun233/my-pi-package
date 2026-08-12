import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type ColorValue = string | number;
type ThemeFile = {
  vars?: Record<string, ColorValue>;
  colors: Record<string, ColorValue>;
};

function loadTheme(name: string): ThemeFile {
  return JSON.parse(readFileSync(join(process.cwd(), "themes", `${name}.json`), "utf8")) as ThemeFile;
}

function resolvedColor(theme: ThemeFile, token: string): ColorValue {
  let value = theme.colors[token];
  const seen = new Set<string>();
  while (typeof value === "string" && theme.vars && value in theme.vars) {
    if (seen.has(value)) throw new Error(`circular theme variable: ${value}`);
    seen.add(value);
    value = theme.vars[value];
  }
  if (typeof value === "string" && value !== "" && !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`unresolved or invalid color: ${value}`);
  }
  return typeof value === "string" ? value.toLowerCase() : value;
}

function expectSemanticColors(name: string, expected: Record<string, string>): void {
  const theme = loadTheme(name);
  expect(Object.fromEntries(Object.keys(expected).map((token) => [token, resolvedColor(theme, token)])))
    .toEqual(Object.fromEntries(Object.entries(expected).map(([token, value]) => [token, value.toLowerCase()])));
}

describe("theme semantic mappings", () => {
  it("resolves every published color role in every bundled theme", () => {
    for (const name of [
      "slop", "flexoki-dark", "everforest-dark-hard", "gruvbox-dark", "kanagawa-wave",
      "dracula", "ayu-dark", "ayu-mirage", "ayu-light", "vesper", "poimandres",
    ]) {
      const theme = loadTheme(name);
      expect(Object.keys(theme.colors).length, name).toBeGreaterThanOrEqual(51);
      for (const token of Object.keys(theme.colors)) expect(() => resolvedColor(theme, token), `${name}.${token}`).not.toThrow();
    }
  });

  it("keeps tool panels and fenced code backgrounds transparent in every theme", () => {
    for (const name of [
      "slop", "flexoki-dark", "everforest-dark-hard", "gruvbox-dark", "kanagawa-wave",
      "dracula", "ayu-dark", "ayu-mirage", "ayu-light", "vesper", "poimandres",
    ]) {
      const colors = loadTheme(name).colors;
      expect({
        toolPendingBg: colors.toolPendingBg,
        toolSuccessBg: colors.toolSuccessBg,
        toolErrorBg: colors.toolErrorBg,
        mdCodeBlock: colors.mdCodeBlock,
      }, name).toEqual({ toolPendingBg: "", toolSuccessBg: "", toolErrorBg: "", mdCodeBlock: "" });
    }
  });

  it("keeps Flexoki UI and syntax roles distinct", () => {
    expectSemanticColors("flexoki-dark", {
      accent: "#3aa99f",
      borderAccent: "#3aa99f",
      customMessageLabel: "#3aa99f",
      mdCode: "#3aa99f",
      mdListBullet: "#3aa99f",
      thinkingHigh: "#d0a215",
      bashMode: "#da702c",
      success: "#879a39",
      error: "#d14d41",
      warning: "#da702c",
      syntaxKeyword: "#879a39",
      syntaxFunction: "#da702c",
      syntaxVariable: "#cecdc3",
      syntaxString: "#3aa99f",
      syntaxNumber: "#8b7ec8",
      syntaxType: "#d0a215",
      syntaxOperator: "#d14d41",
    });
  });

  it("uses Everforest's green identity and canonical dark syntax roles", () => {
    expectSemanticColors("everforest-dark-hard", {
      accent: "#a7c080",
      borderAccent: "#a7c080",
      customMessageLabel: "#a7c080",
      mdCode: "#83c092",
      mdListBullet: "#a7c080",
      thinkingHigh: "#a7c080",
      bashMode: "#e69875",
      success: "#a7c080",
      error: "#e67e80",
      warning: "#dbbc7f",
      syntaxKeyword: "#e67e80",
      syntaxFunction: "#a7c080",
      syntaxVariable: "#d3c6aa",
      syntaxString: "#a7c080",
      syntaxNumber: "#d699b6",
      syntaxType: "#dbbc7f",
      syntaxOperator: "#e69875",
    });
  });

  it("uses Gruvbox's canonical syntax roles", () => {
    expectSemanticColors("gruvbox-dark", {
      accent: "#fabd2f",
      borderAccent: "#fabd2f",
      customMessageLabel: "#fabd2f",
      mdCode: "#8ec07c",
      mdListBullet: "#fabd2f",
      thinkingHigh: "#fabd2f",
      bashMode: "#fe8019",
      success: "#b8bb26",
      error: "#fb4934",
      warning: "#fabd2f",
      syntaxKeyword: "#fb4934",
      syntaxFunction: "#b8bb26",
      syntaxVariable: "#83a598",
      syntaxString: "#b8bb26",
      syntaxNumber: "#d3869b",
      syntaxType: "#fabd2f",
      syntaxOperator: "#ebdbb2",
    });
  });

  it("uses Kanagawa Wave's blue focus and canonical syntax roles", () => {
    expectSemanticColors("kanagawa-wave", {
      accent: "#7e9cd8",
      borderAccent: "#7e9cd8",
      customMessageLabel: "#7e9cd8",
      mdCode: "#98bb6c",
      mdListBullet: "#7e9cd8",
      thinkingHigh: "#957fb8",
      bashMode: "#ffa066",
      toolDiffAdded: "#98bb6c",
      toolDiffRemoved: "#e46876",
      success: "#98bb6c",
      error: "#e82424",
      warning: "#ff9e3b",
      syntaxKeyword: "#957fb8",
      syntaxFunction: "#7e9cd8",
      syntaxVariable: "#dcd7ba",
      syntaxString: "#98bb6c",
      syntaxNumber: "#d27e99",
      syntaxType: "#7aa89f",
      syntaxOperator: "#c0a36e",
    });
  });

  it("uses Vesper's peach UI focus while preserving mint strings", () => {
    expectSemanticColors("vesper", {
      accent: "#ffc799",
      borderAccent: "#ffc799",
      customMessageLabel: "#ffc799",
      mdCode: "#99ffe4",
      mdListBullet: "#ffc799",
      thinkingHigh: "#ffc799",
      bashMode: "#ffc799",
      success: "#99ffe4",
      error: "#ff8080",
      warning: "#ffc799",
      syntaxKeyword: "#a0a0a0",
      syntaxFunction: "#ffc799",
      syntaxVariable: "#ffffff",
      syntaxString: "#99ffe4",
      syntaxNumber: "#ffc799",
      syntaxType: "#ffc799",
      syntaxOperator: "#a0a0a0",
    });
  });
});
