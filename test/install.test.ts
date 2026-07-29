import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import policy from "../config/packages.json";

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
  it("installs unpinned packages and idempotently merges only owned settings", () => {
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
    mkdirSync(join(f.agent, "extensions", "memory"), { recursive: true });
    writeFileSync(join(f.agent, "extensions", "openai-usage.ts"), "legacy");
    mkdirSync(join(f.agent, "prompts"), { recursive: true });
    writeFileSync(join(f.agent, "prompts", "voice.md"), "legacy");

    const first = runInstall(f);
    expect(first.status, first.stderr).toBe(0);
    const firstSettings = readFileSync(join(f.agent, "settings.json"), "utf8");
    const second = runInstall(f);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(f.agent, "settings.json"), "utf8")).toBe(firstSettings);

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
    expect(first.stderr).toContain(join(f.agent, "prompts", "voice.md"));
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
