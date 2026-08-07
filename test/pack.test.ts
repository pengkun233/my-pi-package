import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const allowed = /^(package\/(package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|install\.sh|config\/(packages\.json|global-agents\.md)|themes\/slop\.json|prompts\/(Get-Shit-Done|Neat-Freak|aye)\.md|skills\/(tidy-memory|wait-what-cn)\/SKILL\.md|extensions\/(chat-mode\.ts|openai-usage\.ts|loop\/.*\.ts|memory\/.*\.ts|memory\/README\.md|ui\/.*\.ts)))$/;

describe("tarball boundary", () => {
  it("contains only reproducible package resources", () => {
    const result = JSON.parse(execFileSync("npm", ["pack", "--json", "--dry-run"], { encoding: "utf8" }));
    const paths = result[0].files.map((file: { path: string }) => `package/${file.path}`);
    expect(paths.length).toBeGreaterThan(10);
    expect(paths).toContain("package/config/global-agents.md");
    expect(paths).toContain("package/skills/tidy-memory/SKILL.md");
    expect(paths).toContain("package/skills/wait-what-cn/SKILL.md");
    for (const path of paths) expect(path).toMatch(allowed);
    expect(paths.some((path: string) => /(?:test|node_modules|memory\/topics|session|auth|credentials)/i.test(path))).toBe(false);
  }, 15_000);
});
