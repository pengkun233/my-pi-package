import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const localRoot = new URL("../node_modules/@earendil-works/pi-coding-agent", import.meta.url).pathname;
const hostRoot = process.env.PI_ENHANCEMENTS_TEST_PI_ROOT ?? join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
for (const [label, root] of [["local", localRoot], ["host", hostRoot]]) {
  describe.skipIf(!existsSync(join(root, "package.json")))(`${label} Pi enhancement compatibility`, () => {
    it("loads side chat, completion and draft recovery against real host APIs", () => {
      const result = spawnSync(process.execPath, ["test/helpers/enhancements-pi-compat.mjs"], {
        cwd: new URL("..", import.meta.url), env: { ...process.env, PI_ENHANCEMENTS_TEST_PI_ROOT: root },
        encoding: "utf8", timeout: 60_000,
      });
      expect(result.status, result.stderr || String(result.error)).toBe(0);
    }, 60_000);
  });
}
