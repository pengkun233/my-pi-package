import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSnippets } from "../extensions/prompt-snippets/index.js";

function snippet(name: string, placement: "prepend" | "append", order: number, body: string): string {
  return `---\nname: ${name}\nplacement: ${placement}\norder: ${order}\n---\n${body}\n`;
}

describe("prompt snippets", () => {
  it("merges bundled and local snippets with local filename overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "prompt-snippets-"));
    const bundled = join(root, "bundled");
    const local = join(root, "local");
    mkdirSync(bundled);
    mkdirSync(local);

    try {
      writeFileSync(join(bundled, "shared.md"), snippet("Bundled shared", "prepend", 20, "bundled body"));
      writeFileSync(join(bundled, "packaged.md"), snippet("Packaged", "append", 20, "packaged body"));
      writeFileSync(join(local, "shared.md"), snippet("Local shared", "prepend", 10, "local body"));
      writeFileSync(join(local, "custom.md"), snippet("Custom", "append", 5, "custom body"));
      writeFileSync(join(local, "invalid.md"), "missing frontmatter");

      const result = loadSnippets([bundled, local]);

      expect(result.map(({ id, name }) => ({ id, name }))).toEqual([
        { id: "shared.md", name: "Local shared" },
        { id: "custom.md", name: "Custom" },
        { id: "packaged.md", name: "Packaged" },
      ]);
      expect(result.find((item) => item.id === "shared.md")?.body).toBe("local body");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
