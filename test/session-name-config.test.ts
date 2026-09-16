import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NAMING_CONFIG, loadNamingConfig } from "../extensions/session-name/config.js";

let dir: string;
let path: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "session-name-")); path = join(dir, "session-name.json"); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("session-name configuration", () => {
  it("defaults when missing and merges partial settings", async () => {
    expect(await loadNamingConfig(path)).toEqual(DEFAULT_NAMING_CONFIG);
    await writeFile(path, JSON.stringify({ model: " small " }));
    expect(await loadNamingConfig(path)).toEqual({ ...DEFAULT_NAMING_CONFIG, model: "small" });
  });

  it("rereads settings on every generation", async () => {
    await writeFile(path, JSON.stringify({ provider: "local", model: "small", reasoning: "off" }));
    expect(await loadNamingConfig(path)).toEqual({ provider: "local", model: "small", reasoning: "off" });
    await writeFile(path, JSON.stringify({ reasoning: "high" }));
    expect(await loadNamingConfig(path)).toEqual({ ...DEFAULT_NAMING_CONFIG, reasoning: "high" });
  });

  it.each(["{", "null", "[]", '"text"', '{"model":" "}', '{"provider":1}', '{"reasoning":"invalid"}', '{"reasoning":null}', '{"modle":"typo"}'])("rejects invalid configuration %s", async (content) => {
    await writeFile(path, content);
    await expect(loadNamingConfig(path)).rejects.toThrow("session-name.json");
  });

  it("does not silently default on read errors", async () => {
    await expect(loadNamingConfig(dir)).rejects.toThrow("Cannot read");
  });
});
