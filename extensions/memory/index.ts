import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	appendInbox,
	buildMemoryPrompt,
	createMemoryState,
	createProjectIdentity,
	ensureMemoryState,
	forgetTopic,
	memoryStatus,
	readTopic,
	regenerateIndex,
	searchMemory,
	storeForScope,
	upsertTopic,
	type Confidence,
	type MemoryScope,
	type MemoryState,
} from "./core.ts";
import { parseRememberArgs, singularScope } from "./routing.ts";

const MEMORY_BASE = resolve(
	process.env.PI_MEMORY_DIR ||
		join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "memory"),
);

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function asScope(value: string | undefined, fallback: MemoryScope = "project"): MemoryScope {
	return value === "global" ? "global" : value === "project" ? "project" : fallback;
}

function required(value: string | undefined, name: string): string {
	if (!value?.trim()) throw new Error(`${name} is required for this memory action`);
	return value.trim();
}

async function gitValue(pi: ExtensionAPI, cwd: string, args: string[]): Promise<string | undefined> {
	try {
		const result = await pi.exec("git", args, { cwd, timeout: 2_500 });
		if (result.code !== 0) return undefined;
		return result.stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function resolveState(pi: ExtensionAPI, cwd: string): Promise<MemoryState> {
	const gitRoot = await gitValue(pi, cwd, ["rev-parse", "--show-toplevel"]);
	const root = gitRoot || cwd;
	const [remote, gitCommonDir] = await Promise.all([
		gitValue(pi, root, ["config", "--get", "remote.origin.url"]),
		gitValue(pi, root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
	]);
	const identity = createProjectIdentity({ cwd, gitRoot, remote, gitCommonDir });
	const state = createMemoryState(MEMORY_BASE, identity);
	await ensureMemoryState(state);
	return state;
}

function formatStatus(status: Awaited<ReturnType<typeof memoryStatus>>): string {
	const lines = [
		`Project: ${status.project.label}`,
		`Identity: ${status.project.key} (${status.project.source})`,
		`Root: ${status.project.root}`,
	];
	for (const store of status.stores) {
		lines.push(
			`${store.scope}: ${store.topics} topic(s), ${store.indexBytes} index bytes`,
			`  ${store.root}`,
		);
	}
	return lines.join("\n");
}

export default function memoryExtension(pi: ExtensionAPI) {
	let state: MemoryState | undefined;
	let stateCwd: string | undefined;
	let initialization: Promise<MemoryState> | undefined;
	let memoryPromptSnapshot: string | undefined;

	async function getState(cwd: string): Promise<MemoryState> {
		if (state && stateCwd === cwd) return state;
		if (!initialization || stateCwd !== cwd) {
			stateCwd = cwd;
			const pending = resolveState(pi, cwd).then((resolved) => {
				state = resolved;
				return resolved;
			});
			initialization = pending;
			pending.catch(() => {
				if (initialization === pending) {
					initialization = undefined;
					stateCwd = undefined;
				}
			});
		}
		return initialization;
	}

	pi.on("session_start", async (_event, ctx) => {
		memoryPromptSnapshot = undefined;
		try {
			const current = await getState(ctx.cwd);
			const memoryToolActive = pi.getActiveTools().includes("memory");
			const [prompt, status] = await Promise.all([
				buildMemoryPrompt(current, memoryToolActive),
				memoryStatus(current),
			]);
			memoryPromptSnapshot = prompt;
			const projectTopics = status.stores.find((store) => store.scope === "project")?.topics || 0;
			ctx.ui.setStatus("memory", `memory: ${projectTopics}`);
		} catch (error) {
			ctx.ui.setStatus("memory", "memory: error");
			ctx.ui.notify(`Memory initialization failed: ${errorMessage(error)}`, "warning");
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (memoryPromptSnapshot === undefined) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${memoryPromptSnapshot}` };
	});

	pi.registerTool({
		name: "memory",
		label: "Memory",
		description:
			"Search, read, or maintain durable cross-session memory. The injected MEMORY.md files are indexes; use search/read for topic details. Use upsert proactively only for verified, durable, reusable knowledge. Use project scope for repository-specific knowledge and global scope only for stable user preferences across projects. Upsert replaces the complete topic, so read it first when updating. Never store credentials, secrets, transient task state, or guesses. Output is capped at 50KB.",
		promptSnippet: "Search, read, and maintain durable cross-session memory with progressive disclosure",
		parameters: Type.Object({
			action: StringEnum(["status", "search", "read", "upsert", "forget", "reindex"] as const),
			scope: Type.Optional(StringEnum(["global", "project", "all"] as const)),
			query: Type.Optional(Type.String({ description: "Search query for action=search" })),
			topic: Type.Optional(
				Type.String({ description: "Lowercase topic slug using a-z, 0-9, and hyphens" }),
			),
			title: Type.Optional(Type.String({ description: "Human-readable topic title" })),
			summary: Type.Optional(Type.String({ description: "One-line index summary, max 240 characters" })),
			tags: Type.Optional(Type.Array(Type.String(), { maxItems: 12 })),
			confidence: Type.Optional(StringEnum(["confirmed", "likely", "uncertain"] as const)),
			content: Type.Optional(Type.String({ description: "Complete Markdown body for action=upsert" })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const current = await getState(ctx.cwd);
			const sessionId = ctx.sessionManager.getSessionId();
			const audit = { sessionId };

			switch (params.action) {
				case "status": {
					const status = await memoryStatus(current);
					return { content: [{ type: "text", text: formatStatus(status) }], details: status };
				}
				case "search": {
					const query = required(params.query, "query");
					const scope = params.scope || "all";
					const stores =
						scope === "all"
							? [current.project, current.global]
							: [storeForScope(current, asScope(scope))];
					const results = await searchMemory(stores, query, params.limit || 8);
					const text = results.length
						? results
								.map(
									(result) =>
										`- [${result.scope}/${result.topic}] ${result.title}: ${result.summary}\n  ${result.snippet}`,
								)
								.join("\n")
						: `No memory topics matched: ${query}`;
					return { content: [{ type: "text", text }], details: { query, results } };
				}
				case "read": {
					const scope = singularScope(params.scope, "read");
					const topic = required(params.topic, "topic");
					const result = await readTopic(storeForScope(current, scope), topic);
					const header = `# ${result.document.title}\n\nScope: ${scope}\nTopic: ${result.document.topic}\nSummary: ${result.document.summary}\n`;
					const suffix = result.truncated ? "\n\n[Topic truncated at 50KB.]" : "";
					return {
						content: [{ type: "text", text: `${header}\n${result.document.content}${suffix}` }],
						details: { scope, topic, truncated: result.truncated },
					};
				}
				case "upsert": {
					const scope = singularScope(params.scope, "upsert");
					const document = await upsertTopic(
						storeForScope(current, scope),
						{
							topic: required(params.topic, "topic"),
							title: params.title,
							summary: required(params.summary, "summary"),
							tags: params.tags,
							confidence: params.confidence as Confidence | undefined,
							content: required(params.content, "content"),
						},
						audit,
					);
					return {
						content: [{ type: "text", text: `Updated ${scope} memory topic: ${document.topic}` }],
						details: { scope, topic: document.topic, path: document.path },
					};
				}
				case "forget": {
					const scope = singularScope(params.scope, "forget");
					const topic = required(params.topic, "topic");
					await forgetTopic(storeForScope(current, scope), topic, audit);
					return {
						content: [{ type: "text", text: `Forgot ${scope} memory topic: ${topic}` }],
						details: { scope, topic },
					};
				}
				case "reindex": {
					const scope = params.scope || "all";
					const stores =
						scope === "all"
							? [current.global, current.project]
							: [storeForScope(current, asScope(scope))];
					for (const store of stores) await regenerateIndex(store);
					return {
						content: [{ type: "text", text: `Rebuilt memory index for: ${stores.map((store) => store.scope).join(", ")}` }],
						details: { scopes: stores.map((store) => store.scope) },
					};
				}
			}
		},
	});

	pi.registerCommand("memory", {
		description: "Show memory status or rebuild indexes: /memory [status|reindex [global|project|all]]",
		handler: async (args, ctx) => {
			try {
				const current = await getState(ctx.cwd);
				const parts = args.trim().split(/\s+/).filter(Boolean);
				const action = parts[0] || "status";
				if (action === "status") {
					ctx.ui.notify(formatStatus(await memoryStatus(current)), "info");
					return;
				}
				if (action === "reindex") {
					const scope = parts[1] || "all";
					if (!["global", "project", "all"].includes(scope)) {
						throw new Error("Scope must be global, project, or all");
					}
					const stores =
						scope === "all"
							? [current.global, current.project]
							: [storeForScope(current, asScope(scope))];
					for (const store of stores) await regenerateIndex(store);
					ctx.ui.notify(`Rebuilt memory index for: ${stores.map((store) => store.scope).join(", ")}`, "info");
					return;
				}
				throw new Error("Usage: /memory [status|reindex [global|project|all]]");
			} catch (error) {
				ctx.ui.notify(`Memory command failed: ${errorMessage(error)}`, "error");
			}
		},
	});

	pi.registerCommand("remember", {
		description: "Store a normalized one-line durable note in the project inbox; use --global for user-wide memory",
		handler: async (args, ctx) => {
			try {
				const current = await getState(ctx.cwd);
				const { scope, text } = parseRememberArgs(args);
				if (!text) throw new Error("Usage: /remember [--global] <durable note>");
				await appendInbox(storeForScope(current, scope), text, {
					sessionId: ctx.sessionManager.getSessionId(),
				});
				ctx.ui.notify(`Saved note to ${scope} memory inbox`, "info");
			} catch (error) {
				ctx.ui.notify(`Remember failed: ${errorMessage(error)}`, "error");
			}
		},
	});
}
