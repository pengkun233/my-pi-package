import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory()
      ? sources(child)
      : entry.name.endsWith(".ts") ? [readFileSync(child, "utf8")] : [];
  });
}

describe("UI tool semantics", () => {
  it("is visual-only and registers no LLM tools", () => {
    const source = sources(join(process.cwd(), "extensions", "ui")).join("\n");
    expect(source).not.toMatch(/registerTool\s*\(/);
    expect(source).not.toMatch(/create(?:Read|Bash|Edit|Write|Grep|Find|Ls)Tool/);
  });
});
