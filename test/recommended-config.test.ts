import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const recommendation = readFileSync("config/recommended.md", "utf8");

describe("recommended configuration", () => {
  it("ships a reference workflow instead of an installer", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    expect(existsSync("install.sh")).toBe(false);
    expect(manifest.files).not.toContain("install.sh");
    expect(readFileSync("README.md", "utf8")).toContain("config/recommended.md");
    expect(recommendation).toContain("## Pi");
    expect(recommendation).toContain("## Herdr");
  });

  it("resolves every linked recommendation reference", () => {
    const links = [...recommendation.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(links).toEqual(expect.arrayContaining([
      "packages.json", "global-agents.md", "herdr/config.toml",
    ]));
    for (const link of links) expect(existsSync(resolve("config", link))).toBe(true);
  });
});
