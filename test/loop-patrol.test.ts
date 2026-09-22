import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/pi-agent",
  getPackageDir: () => "/pi",
}));

import {
  DEFAULT_PATROL_CONFIG,
  loadPatrolConfig,
  runPatrol,
} from "../extensions/loop/patrol.js";

type Plan = { stdout?: string; stderr?: string; code?: number | null; hold?: boolean };
let plans: Plan[] = [];
let children: Array<EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number; kill: ReturnType<typeof vi.fn> }>;

function childFor(plan: Plan) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: 123, kill: vi.fn(),
  });
  children.push(child);
  if (!plan.hold) queueMicrotask(() => {
    if (plan.stdout) child.stdout.write(plan.stdout);
    if (plan.stderr) child.stderr.write(plan.stderr);
    child.stdout.end(); child.stderr.end(); child.emit("close", plan.code ?? 0);
  });
  return child;
}

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loop-patrol-"));
  path = join(dir, "loop.json");
  children = [];
  plans = [];
  spawn.mockImplementation(() => childFor(plans.shift() ?? {}));
  vi.spyOn(process, "kill").mockReturnValue(true);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("patrol configuration", () => {
  it("uses defaults, file values, and explicit overrides in that order", async () => {
    expect(loadPatrolConfig({}, path)).toEqual(DEFAULT_PATROL_CONFIG);
    await writeFile(path, JSON.stringify({ patrolModel: " local/test ", patrolThinking: "high" }));
    expect(loadPatrolConfig({}, path)).toEqual({ patrolModel: "local/test", patrolThinking: "high" });
    expect(loadPatrolConfig({ patrolThinking: "low" }, path)).toEqual({ patrolModel: "local/test", patrolThinking: "low" });
  });

  it("accepts model IDs containing provider-specific slashes", () => {
    expect(loadPatrolConfig({ patrolModel: "openrouter/vendor/model" }, path).patrolModel)
      .toBe("openrouter/vendor/model");
  });

  it.each(["{", "null", "[]", '{"patrolModel":" "}', '{"patrolModel":"a"}', '{"patrolThinking":"wrong"}', '{"typo":true}'])("rejects invalid file settings: %s", async (content) => {
    await writeFile(path, content);
    expect(() => loadPatrolConfig({}, path)).toThrow("loop.json");
  });
});

describe("runPatrol", () => {
  const options = () => ({
    ...DEFAULT_PATROL_CONFIG, prompt: "check the deployment", cwd: "/work", signal: new AbortController().signal,
  });
  const event = (content: string, stopReason = "stop") => JSON.stringify({
    type: "message_end", message: { role: "assistant", stopReason, content: [{ type: "text", text: content }] },
  });

  it("runs an isolated fresh CLI and reads the last assistant result", async () => {
    plans.push({ stdout: `${event('{"outcome":"continue","summary":"still running"}')}\n${event('{"outcome":"complete","summary":"done","evidence":"ok"}')}\n` });
    await expect(runPatrol(options())).resolves.toEqual({ outcome: "complete", summary: "done", evidence: "ok" });
    expect(spawn).toHaveBeenCalledWith(process.execPath, expect.arrayContaining([
      "/pi/dist/cli.js", "--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-context-files", "--no-themes", "--tools", "read,grep,find,ls",
      "--model", "openai-codex/gpt-5.6-luna", "--thinking", "medium", "--offline",
    ]), expect.objectContaining({ cwd: "/work" }));
    expect(children[0]!.stdin.read()?.toString()).toContain("check the deployment");
  });

  it("accepts a fenced result and rejects abnormal, malformed, and failed CLI output", async () => {
    plans.push({ stdout: `${event('```json\n{"outcome":"alert","summary":"bad"}\n```')}\n` });
    await expect(runPatrol(options())).resolves.toEqual({ outcome: "alert", summary: "bad" });
    plans.push({ stdout: `${event('{"outcome":"continue","summary":"x"}', "length")}\n` });
    await expect(runPatrol(options())).rejects.toThrow("Patrol ended");
    plans.push({ stdout: `${event('{"outcome":"no","summary":1}')}\n` });
    await expect(runPatrol(options())).rejects.toThrow("invalid result");
    plans.push({ stderr: "cli failed", code: 1 });
    await expect(runPatrol(options())).rejects.toThrow("cli failed");
  });

  it("runs a probe once as observation, retaining its nonzero exit, before the CLI", async () => {
    plans.push({ stdout: "probe out", stderr: "probe err", code: 2 });
    plans.push({ stdout: `${event('{"outcome":"continue","summary":"waiting"}')}\n` });
    await runPatrol({ ...options(), probeCommand: "check-it" });
    expect(spawn).toHaveBeenNthCalledWith(1, "bash", ["-lc", "check-it"], expect.objectContaining({ cwd: "/work" }));
    expect(children[1]!.stdin.read()?.toString()).toContain('"exitCode":2');
  });

  it("kills the process group and rejects when cancelled", async () => {
    plans.push({ hold: true });
    const controller = new AbortController();
    const pending = runPatrol({ ...options(), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("Patrol cancelled");
    if (process.platform !== "win32") expect(process.kill).toHaveBeenCalledWith(-123, "SIGKILL");
    else expect(children[0]!.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not spawn a process for an already-cancelled check", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Stopped"));
    await expect(runPatrol({ ...options(), signal: controller.signal })).rejects.toThrow("Stopped");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("cancels the probe without launching a checker", async () => {
    plans.push({ hold: true });
    const controller = new AbortController();
    const pending = runPatrol({ ...options(), probeCommand: "check-it", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("Patrol cancelled");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("cleans up descendants when the immediate process exits", async () => {
    plans.push({ hold: true });
    const pending = runPatrol(options());
    children[0]!.stdout.write(event('{"outcome":"complete","summary":"done"}'));
    children[0]!.emit("exit", 0);
    if (process.platform !== "win32") expect(process.kill).toHaveBeenCalledWith(-123, "SIGKILL");
    children[0]!.emit("close", 0);
    await expect(pending).resolves.toMatchObject({ outcome: "complete" });
  });

  it("reports spawn errors and oversized output", async () => {
    plans.push({ hold: true });
    const pending = runPatrol(options());
    children[0]!.emit("error", new Error("spawn failed"));
    await expect(pending).rejects.toThrow("spawn failed");
    plans.push({ stdout: "x".repeat(4 * 1024 * 1024 + 1) });
    await expect(runPatrol(options())).rejects.toThrow("output too large");
  });
});
