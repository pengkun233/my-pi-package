import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderStartup } from "../extensions/ui/startup/layout.js";

const theme = { fg: (_token: string, text: string) => text } as any;

describe("startup layout", () => {
  it("hides below 44 columns and fits responsive widths", () => {
    expect(renderStartup(theme, 43, { model: "ctrl+p", thinking: "shift+tab" })).toEqual([]);
    for (const width of [44, 76, 82, 120]) {
      const lines = renderStartup(theme, width, { model: "ctrl+p", thinking: "shift+tab" });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("shows truthful core hints without removed mode branding", () => {
    const text = renderStartup(theme, 82, { model: "MKEY", thinking: "TKEY" }).join("\n");
    expect(text).toContain("Personal UI loaded");
    expect(text).toContain("/ commands");
    expect(text).toContain("! run bash");
    expect(text).toContain("MKEY");
    expect(text).toContain("TKEY");
    expect(text).not.toMatch(/Pikit|\/chat|plan mode|skills|prompts|MCP/i);
  });
});
