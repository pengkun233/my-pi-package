import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = join(dir, entry.name);
    return entry.isDirectory() ? files(child) : entry.name.endsWith(".ts") ? [child] : [];
  });
}

describe("UI capability boundary", () => {
  it("contains no chat mode, plan mode, persisted toggle, or theme switching", () => {
    const root = join(process.cwd(), "extensions", "ui");
    const paths = files(root);
    const names = paths.map((file) => relative(root, file));
    const source = paths.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(names).not.toContain("chat-mode.ts");
    expect(names).not.toContain("state.ts");
    expect(names.some((name) => name.startsWith("plan-mode/"))).toBe(false);
    expect(source).not.toMatch(/registerTool\s*\(/);
    expect(source).not.toMatch(/registerFlag\s*\(/);
    expect(source).not.toMatch(/registerShortcut\s*\(/);
    expect(source).not.toMatch(/setTheme\s*\(/);
    expect(source).not.toMatch(/plan_complete|\/pikit-ui|pikit-ui\.json/);
  });
});
