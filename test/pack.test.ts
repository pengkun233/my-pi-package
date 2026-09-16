import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const bundledThemes = [
  "slop",
  "flexoki-dark",
  "everforest-dark-hard",
  "gruvbox-dark",
  "kanagawa-wave",
  "dracula",
  "ayu-dark",
  "ayu-mirage",
  "ayu-light",
  "vesper",
  "poimandres",
];
const allowed = /^(package\/(package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|config\/(recommended\.md|packages\.json|global-agents\.md|herdr\/config\.toml)|themes\/(slop|flexoki-dark|everforest-dark-hard|gruvbox-dark|kanagawa-wave|dracula|ayu-dark|ayu-mirage|ayu-light|vesper|poimandres)\.json|prompts\/(Get-Shit-Done|Neat-Freak|aye)\.md|skills\/(loop|project-init|tidy-memory|wait-what-cn)\/SKILL\.md|extensions\/(openai-usage\.ts|herdr-status\/.*\.ts|session-name\/.*\.ts|loop\/.*\.ts|memory\/.*\.ts|memory\/README\.md|prompt-snippets\/(README\.md|index\.ts|snippets\/.*\.md)|ui\/.*\.ts)))$/;

describe("tarball boundary", () => {
  it("contains only reproducible package resources", () => {
    const result = JSON.parse(execFileSync("npm", ["pack", "--json", "--dry-run"], { encoding: "utf8" }));
    const paths = result[0].files.map((file: { path: string }) => `package/${file.path}`);
    expect(paths.length).toBeGreaterThan(10);
    expect(paths).toContain("package/config/recommended.md");
    expect(paths).not.toContain("package/install.sh");
    expect(paths).toContain("package/config/global-agents.md");
    expect(paths).toContain("package/config/herdr/config.toml");
    expect(paths).toContain("package/extensions/herdr-status/index.ts");
    expect(paths).toContain("package/extensions/session-name/index.ts");
    expect(paths).toContain("package/extensions/session-name/generate.ts");
    expect(paths).toContain("package/skills/loop/SKILL.md");
    expect(paths).toContain("package/skills/project-init/SKILL.md");
    expect(paths).toContain("package/skills/tidy-memory/SKILL.md");
    expect(paths).toContain("package/skills/wait-what-cn/SKILL.md");
    for (const theme of bundledThemes) expect(paths).toContain(`package/themes/${theme}.json`);
    for (const path of paths) expect(path).toMatch(allowed);
    expect(paths.some((path: string) => /(?:^|\/)(?:test|node_modules|sessions?|auth|credentials)(?:\/|$)|memory\/topics/i.test(path))).toBe(false);
  }, 15_000);
});
