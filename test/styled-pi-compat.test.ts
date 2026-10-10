import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Explicit override for other machines; no install or mutation of host packages.
const hostRoot = process.env.PI_STYLED_TEST_PI_ROOT
  ?? join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const localRoot = new URL("../node_modules/@earendil-works/pi-coding-agent", import.meta.url).pathname;
const cases = [
  { scenario: "defaults", config: "{}" },
  { scenario: "custom", config: JSON.stringify({
    assistantMessage: { prefix: "A", prefixColor: "success" },
    thinkingMessage: { prefix: "T", prefixColor: "warning" },
    userMessage: { prefix: "U", prefixColor: "error", isThemeBackgroundVisible: false },
  }) },
  { scenario: "empty", config: JSON.stringify({
    assistantMessage: { prefix: "" }, thinkingMessage: { prefix: "" }, userMessage: { prefix: "" },
  }) },
  { scenario: "fallback", config: "{ broken json" },
  { scenario: "fallback", config: JSON.stringify({
    assistantMessage: { prefix: 8, prefixColor: "unknownToken" },
    thinkingMessage: null, userMessage: { prefix: false, isThemeBackgroundVisible: "false" },
  }) },
];

for (const [label, root, version] of [["local", localRoot, "0.82.1"], ["host", hostRoot, "1.1.0"]]) {
  describe.skipIf(!existsSync(join(root, "package.json")))(`${label} Pi ${version} real-component compatibility`, () => {
    const scenarios = label === "host" ? [...cases, { scenario: "interaction-transform", config: "{}" }] : cases;
    it.each(scenarios)("$scenario ($config)", ({ scenario, config }) => {
      const dir = mkdtempSync(join(tmpdir(), "styled-compat-"));
      try {
        mkdirSync(join(dir, "configs"));
        writeFileSync(join(dir, "configs/styled-outputs.json"), config);
        const result = spawnSync(process.execPath, ["test/helpers/styled-pi-compat.mjs", scenario], {
          cwd: new URL("..", import.meta.url),
          env: { ...process.env, PI_STYLED_TEST_PI_ROOT: root, PI_CODING_AGENT_DIR: dir },
          encoding: "utf8", timeout: 60_000,
        });
        expect(result.status, result.stderr || String(result.error)).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ scenario, version });
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }, 60_000);
  });
}
