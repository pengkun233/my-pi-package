import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export function estimatedTokens(text) {
  const cjk = (text.match(/[\u2e80-\u9fff\uf900-\ufaff]/g) || []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}
const within = (root, path) => { const rel = relative(root, resolve(path)); return rel === "" || (!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && rel !== ".." && !isAbsolute(rel)); };
async function files(root, extension, gaps) {
  const result = [];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) result.push(...await files(path, extension, gaps));
      else if (entry.isFile() && entry.name.endsWith(extension)) result.push(path);
    }
  } catch (error) { if (error.code !== "ENOENT") gaps.push(`Unreadable directory: ${root}`); }
  return result;
}
async function newestSnapshot(agentDir, project) {
  const paths = await files(join(agentDir, "token-analyze"), ".json", []);
  const snapshots = [];
  for (const path of paths) {
    try {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (data.version === 1 && typeof data.cwd === "string" && within(project, data.cwd)) snapshots.push(data);
    } catch { /* Atomic snapshots may disappear during reload. */ }
  }
  return snapshots.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] || null;
}
function stringContent(content) {
  return typeof content === "string" ? content : Array.isArray(content) ? content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
}

/** Existing records are the primary evidence; collector entries only supplement missing nested reads. */
export async function historyReport(sessionRoots, project, days, inventory, now = Date.now()) {
  const gaps = [];
  const paths = [...new Set((await Promise.all(sessionRoots.map((root) => files(root, ".jsonl", gaps)))).flat())];
  const since = now - days * 86400000;
  const usage = new Map(inventory.map((skill) => [skill.path, {
    name: skill.name, path: skill.path, successfulReadCalls: 0, failedReadCalls: 0, explicitInvocations: 0,
    sessionCoverage: 0, lastSeen: null,
  }]));
  const tools = new Map();
  const countedSessions = new Set();
  const coverage = { filesScanned: paths.length, projectSessionsInWindow: 0, sessionsWithCollectorEvidence: 0, malformedLines: 0, missingTimestamps: 0, nestedRecordsIncomplete: 0, duplicateSessionFiles: 0 };
  const getSkill = (path, cwd) => {
    if (typeof path !== "string" || !/(?:^|\/)SKILL\.md$/i.test(path)) return;
    path = resolve(cwd, path);
    if (!usage.has(path)) usage.set(path, { name: basename(dirname(path)), path, successfulReadCalls: 0, failedReadCalls: 0, explicitInvocations: 0, sessionCoverage: 0, lastSeen: null });
    return usage.get(path);
  };
  for (const path of paths) {
    let cwd, sessionId, inWindow = false, collector = false;
    const calls = new Map(), toolCalls = new Map(), readEvents = new Map(), seenSkills = new Set(), explicit = new Map();
    const stream = createReadStream(path, { encoding: "utf8" });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of reader) {
        let entry;
        try { entry = JSON.parse(line); } catch { coverage.malformedLines++; continue; }
        if (entry.type === "session") {
          if (typeof entry.cwd !== "string" || !within(project, entry.cwd)) break;
          cwd = entry.cwd; sessionId = entry.id;
          const created = Date.parse(entry.timestamp || "");
          inWindow ||= Number.isFinite(created) && created >= since && created <= now;
          continue;
        }
        if (!cwd) continue;
        const parsedTime = Date.parse(entry.timestamp || entry.data?.observedAt || "");
        const timestamp = Number.isFinite(parsedTime) ? parsedTime : entry.message?.timestamp;
        if (!Number.isFinite(timestamp)) { coverage.missingTimestamps++; continue; }
        // Keep inputs across the window boundary, so a result inside it still has a source.
        if (entry.type === "message" && entry.message?.role === "assistant" && Array.isArray(entry.message.content)) {
          for (const call of entry.message.content) if (call.type === "toolCall") {
            toolCalls.set(call.id, { name: call.name, timestamp, status: "unfinished", source: "direct" });
            if (call.name === "read") {
              const skill = getSkill(call.arguments?.path, cwd);
              if (skill) calls.set(call.id, skill);
            }
          }
        }
        if (timestamp < since || timestamp > now) continue;
        inWindow = true;
        const noteRead = (id, skill, success) => {
          if (!skill) return;
          readEvents.set(id, { skill, success, timestamp });
        };
        if (entry.type === "message") {
          const msg = entry.message;
          if (msg?.role === "toolResult") {
            const previous = toolCalls.get(msg.toolCallId);
            toolCalls.set(msg.toolCallId, { name: previous?.name || msg.toolName || "unknown", timestamp,
              status: msg.isError ? "error" : "ok", source: "direct" });
            noteRead(msg.toolCallId, calls.get(msg.toolCallId), !msg.isError);
            // Pi newer versions retain nested call metadata without results.
            const nested = msg.nestedCalls;
            if (nested?.complete === false) coverage.nestedRecordsIncomplete++;
            for (const [index, call] of ((Array.isArray(nested) ? nested : nested?.calls) || []).entries()) {
              const id = call.toolCallId || call.id || `${entry.id}:nested:${index}`;
              const name = call.name || call.toolName || "unknown";
              const status = ["ok", "success", "completed"].includes(call.status) ? "ok" : call.status === "error" ? "error" : "unfinished";
              toolCalls.set(id, { name, timestamp, status, source: "nested" });
              if (name === "read" && status !== "unfinished") {
                noteRead(id, getSkill(call.arguments?.path || call.args?.path, cwd), status === "ok");
              }
            }
          }
          if (msg?.role === "user") {
            const match = /^\s*\/skill:([a-z0-9-]+)(?:\s|$)/.exec(stringContent(msg.content));
            if (match) explicit.set(`${timestamp}:${match[1]}:raw`, { name: match[1], timestamp, source: "raw" });
            const expanded = /^<skill name="([a-z0-9-]+)" location="([^"]+)">/.exec(stringContent(msg.content));
            if (expanded) explicit.set(`${timestamp}:${expanded[1]}:expanded`, { name: expanded[1], path: expanded[2], timestamp, source: "expanded" });
          }
        }
        if (entry.type === "custom" && entry.customType === "token-analyze-coverage") collector = true;
        if (entry.type === "custom" && entry.customType === "token-analyze-skill-read") {
          collector = true;
          noteRead(entry.data.toolCallId, getSkill(entry.data.path, cwd), entry.data.success);
          const previous = toolCalls.get(entry.data.toolCallId);
          toolCalls.set(entry.data.toolCallId, { name: "read", timestamp, status: entry.data.success ? "ok" : "error", source: previous?.source || "collector" });
        }
        if (entry.type === "custom" && entry.customType === "token-analyze-skill-invoke") {
          collector = true;
          explicit.set(`${timestamp}:${entry.data.name}:collector`, { name: entry.data.name, timestamp, source: "collector" });
        }
      }
    } catch { gaps.push(`Unreadable/truncated session: ${path}`); }
    finally { reader.close(); stream.destroy(); }
    if (!cwd || !sessionId || !inWindow) continue;
    if (countedSessions.has(sessionId)) { coverage.duplicateSessionFiles++; continue; }
    countedSessions.add(sessionId);
    coverage.projectSessionsInWindow++;
    const seenTools = new Set();
    for (const call of toolCalls.values()) {
      if (call.timestamp < since || call.timestamp > now) continue;
      if (!tools.has(call.name)) tools.set(call.name, { name: call.name, calls: 0, successfulCalls: 0, failedCalls: 0,
        unfinishedCalls: 0, sessionCoverage: 0, lastSeen: null, sources: { direct: 0, nested: 0, collector: 0 } });
      const tool = tools.get(call.name);
      tool.calls++; tool[call.status === "ok" ? "successfulCalls" : call.status === "error" ? "failedCalls" : "unfinishedCalls"]++;
      tool.sources[call.source]++;
      if (!tool.lastSeen || call.timestamp > Date.parse(tool.lastSeen)) tool.lastSeen = new Date(call.timestamp).toISOString();
      seenTools.add(call.name);
    }
    for (const name of seenTools) tools.get(name).sessionCoverage++;
    if (collector) coverage.sessionsWithCollectorEvidence++;
    const mark = (skill, timestamp) => {
      seenSkills.add(skill);
      if (!skill.lastSeen || timestamp > Date.parse(skill.lastSeen)) skill.lastSeen = new Date(timestamp).toISOString();
    };
    for (const { skill, success, timestamp } of readEvents.values()) {
      skill[success ? "successfulReadCalls" : "failedReadCalls"]++;
      mark(skill, timestamp);
    }
    // Pair input evidence to a nearby persisted invocation once (time matching is approximate).
    const collectorInvocations = [...explicit.values()].filter((item) => item.source === "collector");
    const paired = new Set();
    for (const item of explicit.values()) {
      if (item.source === "collector") continue;
      const evidence = collectorInvocations.find((other) => !paired.has(other) && other.name === item.name && Math.abs(other.timestamp - item.timestamp) < 5000);
      if (evidence) paired.add(evidence);
    }
    for (const item of explicit.values()) {
      if (paired.has(item)) continue;
      const { name, path, timestamp } = item;
      const candidates = [...usage.values()].filter((value) => value.name === name);
      let skill = path ? getSkill(path, cwd) : candidates.length === 1 ? candidates[0] : undefined;
      if (!skill) {
        const key = `name:${name}`;
        if (!usage.has(key)) usage.set(key, { name, path: null, attribution: "explicit name only; loaded path unknown/ambiguous",
          successfulReadCalls: 0, failedReadCalls: 0, explicitInvocations: 0, sessionCoverage: 0, lastSeen: null });
        skill = usage.get(key);
      }
      skill.explicitInvocations++;
      mark(skill, timestamp);
    }
    for (const skill of seenSkills) skill.sessionCoverage++;
  }
  gaps.push("Counts describe observed loads/invocations, NOT workflow completion or currently retained context", "Old sessions may omit explicit invocation, codemode/nested calls, custom readers, bash reads and compacted/deleted sessions", "Collector coverage means an observed marker or skill event; nested/custom-reader gaps still apply", "All recorded branches are included for project activity; not current-conversation token totals");
  gaps.push("Tool calls are counted once by session/call ID: result time when present, otherwise invocation time with unfinished outcome; nested time is its parent result time", "Explicit input versus expanded/raw user records are paired by name within 5 seconds; attribution is approximate and input evidence need not mean successful expansion", "Forks/clones can contain copied ancestral activity; counts describe recorded session activity, not unique real-world executions");
  return { days, since: new Date(since).toISOString(), through: new Date(now).toISOString(), coverage, tools: [...tools.values()], skills: [...usage.values()], gaps };
}

export async function report({ cwd = process.cwd(), agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), days = 30, sessionDir } = {}) {
  cwd = resolve(cwd);
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  const project = git.status === 0 ? git.stdout.trim() : cwd;
  const snapshot = await newestSnapshot(agentDir, project);
  const inventory = snapshot?.skills || [];
  const bodies = await Promise.all(inventory.map(async (skill) => {
    try {
      const body = await readFile(skill.path, "utf8");
      return { name: skill.name, path: skill.path, estimatedTokens: estimatedTokens(body), chars: body.length,
        sha256: createHash("sha256").update(body).digest("hex"), scope: "current disk body, on-demand POTENTIAL cost; NOT permanent injection or historical retained text" };
    } catch { return { name: skill.name, path: skill.path, unknown: "body unreadable" }; }
  }));
  const roots = sessionDir ? [resolve(sessionDir)] : [join(agentDir, "sessions"), ...(snapshot?.sessionDir ? [snapshot.sessionDir] : [])];
  const history = await historyReport(roots, project, days, inventory);
  return { project, requestedCwd: cwd, snapshot, bodies, history,
    limitations: ["Heuristic estimates (CJK + other chars/4) are not tokenizer counts or provider billing totals", "No snapshot means effective runtime system prompt/tools/skill index are UNKNOWN; reload collector and make a main request", "Snapshot is latest observed request for this project; it can be stale, from another session/subdirectory or earlier hook order", "SYSTEM/APPEND origins are merged in Pi options; extension injection attribution and final provider/server transforms can be unknown", "Never automatically disable low-use skills or globally delete configuration; propose scoped changes with semantic risk", "No auth files, environment secrets or hidden/server prompts are read"] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!value || !["--cwd", "--agent-dir", "--days", "--session-dir"].includes(flag)) throw new Error("Usage: report.mjs [--cwd PATH] [--agent-dir PATH] [--days 30] [--session-dir PATH]");
    options[{ "--cwd": "cwd", "--agent-dir": "agentDir", "--days": "days", "--session-dir": "sessionDir" }[flag]] = flag === "--days" ? Number(value) : value;
  }
  if (options.days !== undefined && (!Number.isFinite(options.days) || options.days <= 0)) throw new Error("days must be positive");
  console.log(JSON.stringify(await report(options), null, 2));
}
