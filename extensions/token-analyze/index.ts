import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { formatSkillsForPrompt, type BuildSystemPromptOptions, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export const SKILL_READ_ENTRY = "token-analyze-skill-read";
export const SKILL_INVOKE_ENTRY = "token-analyze-skill-invoke";
export function estimate(text: string) {
  const wide = (text.match(/[\u2e80-\u9fff\uf900-\ufaff]/g) || []).length;
  return { chars: text.length, bytes: Buffer.byteLength(text), estimatedTokens: wide + Math.ceil((text.length - wide) / 4),
    method: "CJK codepoints + other UTF-16 chars/4; heuristic, NOT tokenizer/provider totals", sha256: createHash("sha256").update(text).digest("hex") };
}
export function projectKey(cwd: string): string { return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 20); }
export function snapshotDirectory(cwd: string): string {
  return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "token-analyze", projectKey(cwd));
}

/** Metadata only: no prompt bodies, tool arguments/results, headers, credentials or payload dumps. */
export function promptSnapshot(pi: ExtensionAPI, ctx: ExtensionContext, options: BuildSystemPromptOptions | undefined, basePrompt?: string) {
  const effective = ctx.getSystemPrompt();
  const base = basePrompt;
  const skills = options?.skills || [];
  const index = formatSkillsForPrompt(skills);
  const active = new Set(pi.getActiveTools());
  return {
    version: 1, observedAt: new Date().toISOString(), cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(),
    sessionDir: ctx.sessionManager.getSessionDir(), model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
    phase: "context handler; order-sensitive, before provider serialization",
    system: estimate(effective), baseSystem: base === undefined ? null : estimate(base),
    basePhase: "before_agent_start at collector position; may already include earlier extension changes, NOT pristine static configuration",
    dynamic: { changedFromBase: base === undefined ? null : base !== effective, attribution: "unknown: extension overrides/injections and runtime changes cannot be separated reliably" },
    components: options ? {
      customSystem: estimate(options.customPrompt || ""), appendSystem: estimate(options.appendSystemPrompt || ""),
      contextFiles: (options.contextFiles || []).map((file) => ({ path: file.path, ...estimate(file.content) })),
      toolSnippets: Object.entries(options.toolSnippets || {}).map(([name, text]) => ({ name, ...estimate(text) })),
      promptGuidelines: estimate((options.promptGuidelines || []).join("\n")),
      skillIndex: { ...estimate(index), presentVerbatim: !!index && effective.includes(index) },
    } : null,
    skills: skills.map((skill) => ({ name: skill.name, path: skill.filePath,
      modelInvoked: !skill.disableModelInvocation,
      indexEstimate: estimate(formatSkillsForPrompt([skill])),
      // Includes wrapper for each item; do not sum these and claim exact additive attribution.
    })),
    tools: pi.getAllTools().map((tool) => ({ name: tool.name, active: active.has(tool.name),
      description: estimate(tool.description), schema: estimate(JSON.stringify(tool.parameters)),
      attribution: "registered catalog; active does not guarantee a wire declaration (codemode/loadout/provider transforms)" })),
    gaps: ["No hidden/server prompts or credentials inspected", "Provider token totals cannot be attributed to individual prompt components", "Base component estimates overlap; not an additive billing breakdown", "On-demand skill bodies are NOT included as permanent cost"],
  };
}

export default function (pi: ExtensionAPI) {
  let options: BuildSystemPromptOptions | undefined;
  let basePrompt: string | undefined;
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();
  const reads = new Map<string, string>();
  let warned = false;
  let coverageMarked = false;
  let latest: ReturnType<typeof promptSnapshot> | undefined;
  const reset = () => { generation++; options = undefined; basePrompt = undefined; latest = undefined; reads.clear(); warned = false; coverageMarked = false; };
  pi.on("session_start", reset);
  pi.on("session_tree", reset);
  pi.on("session_shutdown", reset);
  pi.on("before_agent_start", (event) => {
    options = structuredClone(event.systemPromptOptions); basePrompt = event.systemPrompt;
    if (!coverageMarked) {
      coverageMarked = true;
      pi.appendEntry("token-analyze-coverage", { version: 1, observedAt: new Date().toISOString(), nested: "host-dependent; only events exposed by Pi are observed" });
    }
  });
  const save = (ctx: ExtensionContext, snapshot: unknown) => {
    const current = generation;
    const dir = snapshotDirectory(ctx.cwd);
    // Serialize writes, and reject queued work belonging to a replaced session.
    queue = queue.then(async () => {
      if (current !== generation) return;
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temporary = join(dir, `.latest-${process.pid}.tmp`);
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      await rename(temporary, join(dir, "latest.json"));
    }).catch(() => {
      if (!warned && current === generation) { warned = true; ctx.ui.notify("token-analyze 快照写入失败；历史记录仍可分析", "warning"); }
    });
  };
  pi.on("context", (_event, ctx) => { latest = promptSnapshot(pi, ctx, options, basePrompt); save(ctx, latest); });
  pi.on("before_provider_request", (event, ctx) => {
    if (!latest) return;
    const payload = event.payload as { tools?: unknown[]; functions?: unknown[]; instructions?: unknown; system?: unknown } | null;
    if (!payload || typeof payload !== "object") return;
    const declarations = payload.tools || payload.functions;
    const wire = {
      phase: "before_provider_request; only known fields, later handlers/server changes unknown",
      tools: Array.isArray(declarations) ? declarations.map((tool) => ({
        ...estimate(JSON.stringify(tool)),
        name: typeof tool === "object" && tool !== null ? String((tool as any).name || (tool as any).function?.name || (tool as any).type || "unknown") : "unknown",
      })) : null,
      instructions: typeof payload.instructions === "string" ? estimate(payload.instructions) : null,
      system: typeof payload.system === "string" ? estimate(payload.system) : Array.isArray(payload.system) ? estimate(JSON.stringify(payload.system)) : null,
    };
    save(ctx, { ...latest, wire });
  });
  pi.on("tool_execution_start", (event, ctx) => {
    // Newer hosts emit this for nested calls too. Older codemode paths remain a documented gap.
    if (event.toolName === "read" && typeof event.args?.path === "string" && /(?:^|\/)SKILL\.md$/i.test(event.args.path)) {
      reads.set(event.toolCallId, resolve(ctx.cwd, event.args.path));
    }
  });
  pi.on("tool_execution_end", (event) => {
    const path = reads.get(event.toolCallId);
    if (!path) return;
    reads.delete(event.toolCallId);
    pi.appendEntry(SKILL_READ_ENTRY, { path, toolCallId: event.toolCallId, success: !event.isError, observedAt: new Date().toISOString() });
  });
  pi.on("input", (event) => {
    const match = /^\s*\/skill:([a-z0-9-]+)(?:\s|$)/.exec(event.text);
    if (match) pi.appendEntry(SKILL_INVOKE_ENTRY, { name: match[1], observedAt: new Date().toISOString(), evidence: "input event explicit invocation" });
  });
}
