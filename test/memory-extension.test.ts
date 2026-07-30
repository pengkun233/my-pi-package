import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalMemoryDir = process.env.PI_MEMORY_DIR;

afterEach(() => {
	if (originalMemoryDir === undefined) delete process.env.PI_MEMORY_DIR;
	else process.env.PI_MEMORY_DIR = originalMemoryDir;
	vi.resetModules();
});

async function loadExtension(memoryDir: string) {
	process.env.PI_MEMORY_DIR = memoryDir;
	vi.resetModules();
	const { default: memoryExtension } = await import("../extensions/memory/index.ts");
	return memoryExtension;
}

function createHarness(cwd: string) {
	const handlers = new Map<string, Function>();
	let memoryTool: any;
	const ui = {
		setStatus: vi.fn(),
		notify: vi.fn(),
	};
	const ctx: any = {
		cwd,
		ui,
		sessionManager: { getSessionId: () => "test-session" },
	};
	const pi: any = {
		on: (name: string, handler: Function) => handlers.set(name, handler),
		registerTool: (tool: any) => {
			if (tool.name === "memory") memoryTool = tool;
		},
		registerCommand: vi.fn(),
		getActiveTools: () => ["memory"],
		exec: vi.fn(async () => ({ code: 1, stdout: "", stderr: "" })),
	};
	return {
		pi,
		ctx,
		ui,
		handlers,
		getMemoryTool: () => memoryTool,
	};
}

function beforeAgentEvent(systemPrompt = "BASE") {
	return {
		systemPrompt,
		systemPromptOptions: { selectedTools: ["memory"] },
	};
}

describe.sequential("memory extension prompt snapshot", () => {
	it("keeps the injected system prompt byte-stable after memory changes until the next session start", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-memory-extension-"));
		try {
			const memoryDir = join(directory, "memory");
			const memoryExtension = await loadExtension(memoryDir);
			const harness = createHarness(join(directory, "project"));
			memoryExtension(harness.pi);

			await harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
			const first = await harness.handlers.get("before_agent_start")!(beforeAgentEvent(), harness.ctx);
			expect(first).toEqual({ systemPrompt: expect.stringContaining("## Persistent Memory Index") });
			expect(first).not.toHaveProperty("message");
			expect(first.systemPrompt).not.toContain("SNAPSHOT_UPDATE_SENTINEL");

			await harness.getMemoryTool().execute(
				"tool-call",
				{
					action: "upsert",
					scope: "project",
					topic: "snapshot-update",
					summary: "SNAPSHOT_UPDATE_SENTINEL",
					content: "Durable details remain available through live memory reads.",
				},
				undefined,
				undefined,
				harness.ctx,
			);

			const second = await harness.handlers.get("before_agent_start")!(beforeAgentEvent(), harness.ctx);
			expect(second.systemPrompt).toBe(first.systemPrompt);
			expect(second.systemPrompt).not.toContain("SNAPSHOT_UPDATE_SENTINEL");

			await harness.handlers.get("session_start")!({ reason: "resume" }, harness.ctx);
			const resumed = await harness.handlers.get("before_agent_start")!(beforeAgentEvent(), harness.ctx);
			expect(resumed.systemPrompt).toContain("SNAPSHOT_UPDATE_SENTINEL");
			expect(resumed.systemPrompt).not.toBe(first.systemPrompt);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("does not retry a failed snapshot during prompts but retries on the next session start", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-memory-extension-failure-"));
		try {
			const memoryDir = join(directory, "memory");
			await writeFile(memoryDir, "not a directory", "utf8");
			const memoryExtension = await loadExtension(memoryDir);
			const harness = createHarness(join(directory, "project"));
			memoryExtension(harness.pi);

			await harness.handlers.get("session_start")!({ reason: "startup" }, harness.ctx);
			expect(await harness.handlers.get("before_agent_start")!(beforeAgentEvent(), harness.ctx)).toBeUndefined();
			expect(harness.ui.notify).toHaveBeenCalledTimes(1);

			await rm(memoryDir, { force: true });
			await mkdir(memoryDir);
			expect(await harness.handlers.get("before_agent_start")!(beforeAgentEvent(), harness.ctx)).toBeUndefined();
			expect(harness.ui.notify).toHaveBeenCalledTimes(1);

			await harness.handlers.get("session_start")!({ reason: "resume" }, harness.ctx);
			const resumed = await harness.handlers.get("before_agent_start")!(beforeAgentEvent(), harness.ctx);
			expect(resumed.systemPrompt).toContain("## Persistent Memory Index");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
