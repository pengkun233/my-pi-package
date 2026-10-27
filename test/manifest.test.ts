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
  it("publishes the agreed extensions, skills, prompts, and themes", () => {
    expect(pkg.private).toBe(true);
    expect(pkg.pi.extensions).toEqual([
      "./extensions/ui/index.ts",
      "./extensions/herdr-status/index.ts",
      "./extensions/session-name/index.ts",
      "./extensions/loop/index.ts",
      "./extensions/memory/index.ts",
      "./extensions/prompt-snippets/index.ts",
      "./extensions/openai-usage.ts",
      "./extensions/btw/index.ts",
      "./extensions/completion/index.ts",
      "./extensions/copy-block/index.ts",
      "./extensions/token-analyze/index.ts",
    ]);
    expect(pkg.pi.skills).toEqual(["./skills"]);
    expect(pkg.pi.prompts).toEqual(["./prompts"]);
    expect(pkg.pi.themes).toEqual(["./themes"]);
  });

  it("ships Auto Drive as an explicit skill with the exact implement dispatch", () => {
    const skill = readFileSync(join(process.cwd(), "skills", "auto-drive", "SKILL.md"), "utf8");
    expect(skill).toContain("name: auto-drive");
    expect(skill).toContain("disable-model-invocation: true");
    expect(skill).toContain("```text\n/implement <ticket 链接>\n```");
  });

  it("ships Loop as a model-invoked natural-language skill", () => {
    const skill = readFileSync(join(process.cwd(), "skills", "loop", "SKILL.md"), "utf8");
    expect(skill).toContain("name: loop");
    expect(skill).toContain("description:");
    expect(skill).not.toContain("disable-model-invocation");
    for (const tool of ["loop_start", "loop_status", "loop_stop"]) {
      expect(skill).toContain(`\`${tool}\``);
    }
  });

  it("ships two independent Chinese read-only audit skills, without doctor", () => {
    const audit = readFileSync(join(process.cwd(), "skills/prompt-audit/SKILL.md"), "utf8");
    const tokens = readFileSync(join(process.cwd(), "skills/token-analyze/SKILL.md"), "utf8");
    expect(audit).toContain("name: prompt-audit"); expect(audit).toContain("修改提案");
    expect(tokens).toContain("name: token-analyze"); expect(tokens).toContain("当前 PROJECT");
    expect(tokens).toContain("history.tools"); expect(tokens).toContain("近 30 天");
    expect(tokens).toContain("不是当前会话 token 报表");
    for (const skill of [audit, tokens]) { expect(skill).toContain("description:"); expect(skill).not.toContain("disable-model-invocation"); }
    expect(pkg.pi.extensions.some((path) => path.includes("doctor"))).toBe(false);
  });

  it("uses Pi-supported prompt argument placeholders", () => {
    for (const name of ["Get-Shit-Done.md", "Neat-Freak.md", "aye.md", "frontend-humanize.md", "frontend-refine.md"]) {
      const prompt = readFileSync(join(process.cwd(), "prompts", name), "utf8");
      expect(prompt).not.toContain("${ARGUMENTS}");
    }
    expect(readFileSync(join(process.cwd(), "prompts", "aye.md"), "utf8")).toBe("全部同意\n");
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
    expect(policy.frontendDesignSkills).toEqual({
      source: "git:github.com/anthropics/skills",
      extensions: [],
      skills: ["skills/frontend-design/SKILL.md"],
      prompts: [],
      themes: [],
    });
    expect(policy.mattPocockSkills).toEqual({
      source: "git:github.com/mattpocock/skills@release/v1.2",
      extensions: [],
      skills,
      prompts: [],
      themes: [],
    });
  });
});
