import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import policy from "../config/packages.json";

const skills = [
  "skills/engineering/ask-matt/SKILL.md",
  "skills/engineering/code-review/SKILL.md",
  "skills/engineering/diagnosing-bugs/SKILL.md",
  "skills/engineering/domain-modeling/SKILL.md",
  "skills/engineering/grill-with-docs/SKILL.md",
  "skills/engineering/implement/SKILL.md",
  "skills/engineering/setup-matt-pocock-skills/SKILL.md",
  "skills/engineering/tdd/SKILL.md",
  "skills/engineering/to-spec/SKILL.md",
  "skills/engineering/to-tickets/SKILL.md",
  "skills/engineering/wayfinder/SKILL.md",
  "skills/productivity/grill-me/SKILL.md",
  "skills/productivity/grilling/SKILL.md",
  "skills/productivity/handoff/SKILL.md",
  "skills/productivity/writing-for-agents/SKILL.md",
];

describe("package boundary", () => {
  it("publishes the agreed extensions, skill, prompts, and theme", () => {
    expect(pkg.private).toBe(true);
    expect(pkg.pi.extensions).toEqual([
      "./extensions/ui/index.ts",
      "./extensions/loop/index.ts",
      "./extensions/chat-mode.ts",
      "./extensions/memory/index.ts",
      "./extensions/openai-usage.ts",
    ]);
    expect(pkg.pi.skills).toEqual(["./skills"]);
    expect(pkg.pi.prompts).toEqual(["./prompts"]);
    expect(pkg.pi.themes).toEqual(["./themes"]);
  });

  it("uses Pi-supported prompt argument placeholders", () => {
    for (const name of ["Get-Shit-Done.md", "Neat-Freak.md", "tidy-memory.md"]) {
      const prompt = readFileSync(join(process.cwd(), "prompts", name), "utf8");
      expect(prompt).not.toContain("${ARGUMENTS}");
    }
  });

  it("keeps the exact external package and skill-filter policy", () => {
    expect(policy.packages).toEqual([
      "npm:pi-web-access",
      "npm:pi-mcp-adapter",
      "npm:pi-rtk-optimizer",
      "npm:pi-subagents",
      "npm:pi-codex-image-gen",
      "npm:pi-openai-codex-fast",
      "npm:@yusukeshib/pi-stash",
      "npm:@plannotator/pi-extension",
    ]);
    expect(policy.mattPocockSkills).toEqual({
      source: "git:github.com/mattpocock/skills@release/v1.2",
      extensions: [],
      skills,
      prompts: [],
      themes: [],
    });
  });
});
