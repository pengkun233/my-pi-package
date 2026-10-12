import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import tokenAnalyze, { estimate, projectKey, promptSnapshot } from "../extensions/token-analyze/index.js";

const dirs: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function temporary() { const dir = await mkdtemp(join(tmpdir(), "pi-token-test-")); dirs.push(dir); return dir; }
const options: any = { cwd: "/project", customPrompt: "secret system", appendSystemPrompt: "secret appended", contextFiles: [{ path: "/project/AGENTS.md", content: "private instructions" }],
  skills: [{ name: "test-skill", description: "调用测试", filePath: "/skills/test-skill/SKILL.md", disableModelInvocation: false }, { name: "manual", description: "manual only", filePath: "/skills/manual/SKILL.md", disableModelInvocation: true }] };
const pi: any = { getAllTools: () => [{ name: "read", description: "private description", parameters: { type: "object", properties: { secret: { const: "private schema" } } } }], getActiveTools: () => ["read"] };
const ctx: any = { cwd: "/project", model: { provider: "test", id: "model" }, getSystemPrompt: () => "secret effective prompt", sessionManager: { getSessionId: () => "session", getSessionDir: () => "/sessions" } };

describe("token analysis metadata", () => {
  it("labels estimates and persists no raw instructions, descriptions, schemas or secrets", () => {
    const snapshot = promptSnapshot(pi, ctx, options, "secret base prompt");
    expect(snapshot.dynamic.changedFromBase).toBe(true);
    expect(snapshot.skills).toHaveLength(2); expect(snapshot.skills[1].indexEstimate.estimatedTokens).toBe(0);
    expect(snapshot.tools[0].active).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/secret effective|secret system|secret base|private instructions|private description|private schema|secret appended/);
    expect(estimate("你好abcd").estimatedTokens).toBe(3);
    expect(snapshot.system.method).toContain("NOT tokenizer");
  });
  it("collects snapshots plus minimal explicit/read metadata without a model-facing tool", async () => {
    const root = await temporary(); vi.stubEnv("PI_CODING_AGENT_DIR", root);
    const events = new Map<string, Function>(), appendEntry = vi.fn();
    tokenAnalyze({ ...pi, on: (event: string, handler: Function) => events.set(event, handler), appendEntry } as any);
    events.get("before_agent_start")!({ systemPromptOptions: options, systemPrompt: "base" }, ctx);
    events.get("context")!({}, ctx);
    events.get("before_provider_request")!({ payload: { instructions: "secret wire", tools: [{ type: "function", function: { name: "read", description: "wire secret" } }] } }, ctx);
    const file = join(root, "token-analyze", projectKey(ctx.cwd), "latest.json");
    await vi.waitFor(async () => expect(JSON.parse(await readFile(file, "utf8")).wire.tools[0].name).toBe("read"));
    expect(await readFile(file, "utf8")).not.toContain("wire secret");
    events.get("input")!({ text: "/skill:test-skill do it" });
    events.get("tool_execution_start")!({ toolName: "read", toolCallId: "parent/1", args: { path: "skills/test/SKILL.md" } }, ctx);
    events.get("tool_execution_end")!({ toolName: "read", toolCallId: "parent/1", isError: false });
    expect(appendEntry.mock.calls.map((call) => call[0])).toEqual(["token-analyze-coverage", "token-analyze-skill-invoke", "token-analyze-skill-read"]);
    expect(appendEntry.mock.calls[2][1]).toMatchObject({ success: true, path: "/project/skills/test/SKILL.md" });
  });
  it("reports unknown effective configuration instead of inventing current conversation totals", async () => {
    const root = await temporary();
    const result = JSON.parse(execFileSync("node", ["skills/token-analyze/scripts/report.mjs", "--cwd", root, "--agent-dir", root], { cwd: process.cwd(), encoding: "utf8" }));
    expect(result.snapshot).toBeNull(); expect(result.history.days).toBe(30);
    expect(result.limitations.join(" ")).toContain("UNKNOWN"); expect(result).not.toHaveProperty("conversationTokens");
  });
  it("counts tool outcomes, boundary-crossing reads, expanded/name-only invocations and empty recent sessions", async () => {
    const root = await temporary(), project = join(root, "project"), sessions = join(root, "sessions");
    await mkdir(project); await mkdir(sessions);
    const timestamp = new Date().toISOString(), old = new Date(Date.now() - 40 * 86400000).toISOString();
    const path = join(project, "skills", "legacy", "SKILL.md");
    const lines = [
      { type: "session", id: "first", cwd: join(project, "subdir"), timestamp: old },
      { type: "message", timestamp: old, message: { role: "assistant", content: [{ type: "toolCall", id: "boundary", name: "read", arguments: { path } }] } },
      { type: "message", timestamp, message: { role: "toolResult", toolCallId: "boundary", toolName: "read", isError: true, content: "secret result" } },
      { type: "message", timestamp, message: { role: "assistant", content: [{ type: "toolCall", id: "pending", name: "bash", arguments: { command: "secret command" } }] } },
      { type: "message", timestamp, message: { role: "toolResult", toolCallId: "parent", toolName: "codemode", nestedCalls: { complete: true, calls: [{ id: "parent/1", name: "write", status: "unfinished" }] } } },
      { type: "message", timestamp, message: { role: "user", content: `<skill name="legacy" location="${path}">\nsecret body\n</skill>` } },
      { type: "message", timestamp, message: { role: "user", content: "/skill:unknown" } },
    ];
    await writeFile(join(sessions, "first.jsonl"), lines.map((entry) => JSON.stringify(entry)).join("\n"));
    await writeFile(join(sessions, "second.jsonl"), JSON.stringify({ type: "session", id: "second", cwd: project, timestamp }));
    const result = JSON.parse(execFileSync("node", ["skills/token-analyze/scripts/report.mjs", "--cwd", project, "--agent-dir", root, "--session-dir", sessions], { encoding: "utf8" }));
    expect(result.history.coverage.projectSessionsInWindow).toBe(2);
    expect(result.history.tools.find((tool: any) => tool.name === "read")).toMatchObject({ calls: 1, failedCalls: 1, sessionCoverage: 1 });
    expect(result.history.tools.find((tool: any) => tool.name === "bash")).toMatchObject({ calls: 1, unfinishedCalls: 1 });
    expect(result.history.tools.find((tool: any) => tool.name === "write")).toMatchObject({ calls: 1, unfinishedCalls: 1, sources: { nested: 1 } });
    expect(result.history.skills.find((skill: any) => skill.name === "legacy")).toMatchObject({ successfulReadCalls: 0, failedReadCalls: 1, explicitInvocations: 1, sessionCoverage: 1 });
    expect(result.history.skills.find((skill: any) => skill.name === "unknown")).toMatchObject({ path: null, explicitInvocations: 1, sessionCoverage: 1 });
    expect(JSON.stringify(result)).not.toMatch(/secret command|secret result|secret body/);
  });
  it("uses legacy sessions first, deduplicates collector/nested reads, filters project/window and shows last seen/coverage", async () => {
    const root = await temporary(), project = join(root, "project"), agent = join(root, "agent");
    const sessions = join(agent, "sessions"); await mkdir(sessions, { recursive: true }); await mkdir(project);
    const timestamp = new Date().toISOString(), old = new Date(Date.now() - 40 * 86400000).toISOString();
    const skillPath = join(project, "skills", "demo", "SKILL.md"); await mkdir(join(project, "skills", "demo"), { recursive: true }); await writeFile(skillPath, "full skill body");
    const lines = [
      { type: "session", id: "first", cwd: project },
      { type: "message", id: "call", timestamp, message: { role: "assistant", content: [{ type: "toolCall", name: "read", id: "read-1", arguments: { path: skillPath } }] } },
      { type: "message", id: "result", timestamp, message: { role: "toolResult", toolCallId: "read-1", isError: false } },
      { type: "custom", timestamp, customType: "token-analyze-skill-read", data: { path: skillPath, toolCallId: "read-1", success: true } },
      { type: "message", id: "nested", timestamp, message: { role: "toolResult", toolName: "codemode", nestedCalls: { complete: false, calls: [{ id: "parent/1", name: "read", arguments: { path: skillPath }, status: "ok" }] } } },
      { type: "custom", timestamp, customType: "token-analyze-skill-read", data: { path: skillPath, toolCallId: "parent/1", success: true } },
      { type: "message", timestamp, message: { role: "user", content: "/skill:demo" } },
      { type: "custom", timestamp, customType: "token-analyze-skill-invoke", data: { name: "demo" } },
      { type: "custom", timestamp: old, customType: "token-analyze-skill-read", data: { path: skillPath, toolCallId: "old", success: true } },
    ];
    await writeFile(join(sessions, "one.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n") + "\n{unfinished");
    await writeFile(join(sessions, "other.jsonl"), [{ type: "session", id: "other", cwd: join(root, "unrelated") }, ...lines.slice(1)].map((line) => JSON.stringify(line)).join("\n"));
    const snapshotDir = join(agent, "token-analyze", projectKey(project)); await mkdir(snapshotDir, { recursive: true });
    await writeFile(join(snapshotDir, "latest.json"), JSON.stringify({ version: 1, cwd: project, observedAt: timestamp, skills: [{ name: "demo", path: skillPath }] }));
    const result = JSON.parse(execFileSync("node", ["skills/token-analyze/scripts/report.mjs", "--cwd", project, "--agent-dir", agent], { encoding: "utf8" }));
    expect(result.history.coverage).toMatchObject({ projectSessionsInWindow: 1, malformedLines: 1, nestedRecordsIncomplete: 1 });
    expect(result.history.skills[0]).toMatchObject({ successfulReadCalls: 2, explicitInvocations: 1, sessionCoverage: 1, lastSeen: timestamp });
    expect(result.history.tools.find((tool: any) => tool.name === "read")).toMatchObject({ calls: 2, successfulCalls: 2, failedCalls: 0, sessionCoverage: 1, lastSeen: timestamp, sources: { direct: 1, nested: 1, collector: 0 } });
    expect(result.bodies[0].scope).toContain("NOT permanent injection");
    expect(JSON.stringify(result)).not.toContain("full skill body");
    expect(result.history.gaps.join(" ")).toContain("codemode/nested");
  });
});
