import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import policy from "../config/packages.json";

const globalAgentsPolicy = readFileSync(join(process.cwd(), "config", "global-agents.md"), "utf8").trim();
const herdrConfig = readFileSync(join(process.cwd(), "config", "herdr", "config.toml"), "utf8");
const globalAgentsStart = "<!-- my-pi-package:global-agents:start -->";
const globalAgentsEnd = "<!-- my-pi-package:global-agents:end -->";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function executable(path: string, content: string) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "my-pi-install-"));
  roots.push(root);
  const home = join(root, "home");
  const agent = join(root, "agent");
  const bin = join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(agent, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const piLog = join(root, "pi.log");
  executable(join(bin, "pi"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$PI_TEST_LOG\"\n");
  return { root, home, agent, bin, piLog };
}

function runInstall(f: ReturnType<typeof fixture>, extraEnv: Record<string, string> = {}) {
  return spawnSync("bash", [join(process.cwd(), "install.sh")], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: f.home,
      PI_CODING_AGENT_DIR: f.agent,
      PI_BIN: join(f.bin, "pi"),
      PI_TEST_LOG: f.piLog,
      MY_PI_PACKAGE_SOURCE: "git:github.com/example/my-pi-package",
      PATH: `${f.bin}:${process.env.PATH}`,
      ...extraEnv,
    },
  });
}

function packageSource(value: unknown): string | undefined {
  return typeof value === "string"
    ? value
    : value && typeof value === "object" && "source" in value
      ? String((value as { source: unknown }).source)
      : undefined;
}

describe("installer", () => {
  it("installs managed packages and idempotently merges only owned settings", () => {
    const f = fixture();
    executable(join(f.bin, "rtk"), "#!/bin/sh\nexit 0\n");
    const legacyPikit = "../../ai_playground/pi_workspace/pikit-ui";
    writeFileSync(join(f.agent, "settings.json"), JSON.stringify({
      defaultModel: "keep-me",
      nested: { untouched: true },
      theme: "dark",
      packages: [
        "npm:unrelated",
        legacyPikit,
        { source: "npm:@plannotator/pi-extension", autoload: false },
        { source: "https://github.com/mattpocock/skills.git", skills: ["old"] },
        "git:github.com/mattpocock/skills",
      ],
    }));
    writeFileSync(join(f.agent, "AGENTS.md"), "# Existing global rule\n\nKeep this instruction.\n");
    mkdirSync(join(f.agent, "extensions", "memory"), { recursive: true });
    writeFileSync(join(f.agent, "extensions", "openai-usage.ts"), "legacy");

    const first = runInstall(f);
    expect(first.status, first.stderr).toBe(0);
    const firstSettings = readFileSync(join(f.agent, "settings.json"), "utf8");
    const firstAgents = readFileSync(join(f.agent, "AGENTS.md"), "utf8");
    const second = runInstall(f);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(f.agent, "settings.json"), "utf8")).toBe(firstSettings);
    expect(readFileSync(join(f.agent, "AGENTS.md"), "utf8")).toBe(firstAgents);
    expect(readFileSync(join(f.home, ".config", "herdr", "config.toml"), "utf8")).toBe(herdrConfig);
    expect(existsSync(join(f.home, ".config", "herdr", "config.toml.backup-before-my-pi-package"))).toBe(false);

    expect(firstAgents).toContain("# Existing global rule\n\nKeep this instruction.");
    expect(firstAgents).toContain(`${globalAgentsStart}\n${globalAgentsPolicy}\n${globalAgentsEnd}`);
    expect(firstAgents.match(new RegExp(globalAgentsStart, "g"))).toHaveLength(1);

    const settings = JSON.parse(firstSettings);
    expect(settings.defaultModel).toBe("keep-me");
    expect(settings.nested).toEqual({ untouched: true });
    expect(settings.theme).toBe("slop");
    expect(settings.packages).toContain("npm:unrelated");
    expect(settings.packages).toContain(legacyPikit);
    expect(settings.packages.filter((entry: unknown) => packageSource(entry) === "npm:@plannotator/pi-extension"))
      .toEqual(["npm:@plannotator/pi-extension"]);
    expect(settings.packages.filter((entry: unknown) => packageSource(entry)?.includes("mattpocock/skills")))
      .toEqual([policy.mattPocockSkills]);
    for (const source of policy.packages) {
      expect(settings.packages.filter((entry: unknown) => packageSource(entry) === source)).toHaveLength(1);
    }
    expect(settings.packages).toContain("git:github.com/example/my-pi-package");

    const calls = readFileSync(f.piLog, "utf8").trim().split("\n").slice(0, 10);
    expect(calls).toEqual([
      "install git:github.com/example/my-pi-package",
      ...policy.packages.map((source) => `install ${source}`),
      `install ${policy.mattPocockSkills.source}`,
    ]);
    expect(first.stderr).toContain("legacy duplicate");
    expect(first.stderr).toContain(join(f.agent, "extensions", "memory"));
    expect(first.stderr).toContain(join(f.agent, "extensions", "openai-usage.ts"));
  });

  it("backs up a changed Herdr config before replacing it", () => {
    const f = fixture();
    const target = join(f.root, "custom-herdr.toml");
    executable(join(f.bin, "rtk"), "#!/bin/sh\nexit 0\n");
    writeFileSync(target, "# previous Herdr config\n");

    const result = runInstall(f, { PACKAGE_HERDR_CONFIG_TARGET: target });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(herdrConfig);
    expect(readFileSync(`${target}.backup-before-my-pi-package`, "utf8")).toBe("# previous Herdr config\n");
  });

  it("updates its managed AGENTS block without changing surrounding whitespace", () => {
    const f = fixture();
    const customPolicy = join(f.root, "global-agents.md");
    executable(join(f.bin, "rtk"), "#!/bin/sh\nexit 0\n");
    writeFileSync(customPolicy, "# Updated voice policy\n\nUse the new rules.\n");
    writeFileSync(
      join(f.agent, "AGENTS.md"),
      `Before this block  \n${globalAgentsStart}\n# Old voice policy\n${globalAgentsEnd}\nAfter this block  `,
    );

    const result = runInstall(f, { PACKAGE_GLOBAL_AGENTS_FILE: customPolicy });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(f.agent, "AGENTS.md"), "utf8")).toBe(
      `Before this block  \n${globalAgentsStart}\n# Updated voice policy\n\nUse the new rules.\n${globalAgentsEnd}\nAfter this block  `,
    );
  });

  it("rejects an invalid global AGENTS policy before any installer side effects", () => {
    const f = fixture();
    const invalid = join(f.root, "global-agents.md");
    const curlLog = join(f.root, "curl.log");
    writeFileSync(invalid, "   \n");
    executable(join(f.bin, "curl"), `#!/bin/sh\nprintf called > "${curlLog}"\n`);

    const result = runInstall(f, {
      PACKAGE_GLOBAL_AGENTS_FILE: invalid,
      RTK_COMMAND: "missing-rtk-for-test",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(f.piLog)).toBe(false);
    expect(existsSync(curlLog)).toBe(false);
    expect(existsSync(join(f.agent, "settings.json"))).toBe(false);
    expect(existsSync(join(f.agent, "AGENTS.md"))).toBe(false);
  });

  it("validates the package source before installing RTK", () => {
    const f = fixture();
    const curlLog = join(f.root, "curl.log");
    executable(join(f.bin, "curl"), `#!/bin/sh\nprintf called > "${curlLog}"\n`);

    const result = runInstall(f, {
      MY_PI_PACKAGE_SOURCE: "not-a-valid-source",
      RTK_COMMAND: "missing-rtk-for-test",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(f.piLog)).toBe(false);
    expect(existsSync(curlLog)).toBe(false);
  });

  it("rejects a malformed policy before running RTK or Pi installers", () => {
    const f = fixture();
    const malformed = join(f.root, "packages.json");
    const curlLog = join(f.root, "curl.log");
    writeFileSync(malformed, "{");
    executable(join(f.bin, "curl"), `#!/bin/sh\nprintf called > "${curlLog}"\n`);

    const result = runInstall(f, {
      PACKAGE_POLICY_FILE: malformed,
      RTK_COMMAND: "missing-rtk-for-test",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(f.piLog)).toBe(false);
    expect(existsSync(curlLog)).toBe(false);
  });

  it("rejects structurally invalid package sources and skill filters before side effects", () => {
    const f = fixture();
    const invalid = join(f.root, "packages.json");
    const curlLog = join(f.root, "curl.log");
    writeFileSync(invalid, JSON.stringify({
      packages: ["not-a-pi-package-source"],
      mattPocockSkills: {
        source: "git:github.com/mattpocock/skills",
        extensions: [],
        skills: [42],
        prompts: [],
        themes: [],
      },
    }));
    executable(join(f.bin, "curl"), `#!/bin/sh\nprintf called > "${curlLog}"\n`);

    const result = runInstall(f, {
      PACKAGE_POLICY_FILE: invalid,
      RTK_COMMAND: "missing-rtk-for-test",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(f.piLog)).toBe(false);
    expect(existsSync(curlLog)).toBe(false);
  });

  it("runs the official RTK installer only when RTK is missing", () => {
    const f = fixture();
    const curlLog = join(f.root, "curl.log");
    executable(join(f.bin, "curl"), `#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"${curlLog}\"\ncat <<'SCRIPT'\nmkdir -p \"$HOME/.local/bin\"\nprintf '#!/bin/sh\\nexit 0\\n' > \"$HOME/.local/bin/rtk\"\nchmod +x \"$HOME/.local/bin/rtk\"\nSCRIPT\n`);

    const result = runInstall(f, { RTK_COMMAND: "missing-rtk-for-test" });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(curlLog, "utf8")).toContain("-fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh");
  });
});
