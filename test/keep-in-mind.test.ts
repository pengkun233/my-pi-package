import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import keepInMind, {
  CHECKPOINT_TYPE, DEFAULT_INTERVAL_TOKENS, DEFAULT_PROMPT, REMINDER_TYPE,
} from "../extensions/keep-in-mind/index.js";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
const readConfig = vi.mocked(readFile);

function config(value: unknown) {
  readConfig.mockResolvedValue(JSON.stringify(value));
}

function harness(branch: any[] = []) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const ctx: any = {
    hasUI: true,
    getContextUsage: vi.fn(() => ({ tokens: 0, contextWindow: 1_000_000, percent: 0 })),
    sessionManager: { getBranch: () => branch },
    ui: { notify: vi.fn() },
  };
  const pi: any = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    appendEntry: vi.fn((customType: string, data: unknown) => branch.push({ type: "custom", customType, data })),
  };
  keepInMind(pi);
  return {
    ctx, pi, branch, handlers,
    async prompt(tokens: number | null | undefined, event: any = { messageType: "user", prompt: "Question", systemPrompt: "Fixed system" }) {
      ctx.getContextUsage.mockReturnValue(tokens === undefined ? undefined : { tokens });
      const result = await handlers.get("before_agent_start")!(event, ctx);
      // Pi persists the returned message before the first model request.
      if (result?.message) branch.push({ type: "custom_message", ...result.message });
      return result;
    },
    command: (args = "") => commands.get("keep-in-mind").handler(args, ctx),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  config({});
});

describe("Keep in mind", () => {
  it("adds one hidden reminder on the first question, without modifying the system prompt or tools", async () => {
    const h = harness();
    const result = await h.prompt(1_000);
    expect(result).toEqual({ message: {
      customType: REMINDER_TYPE, content: DEFAULT_PROMPT, display: false,
      details: { version: 1, prompt: DEFAULT_PROMPT, contextTokens: 1_000 },
    } });
    expect([...h.handlers.keys()]).toEqual(["before_agent_start"]);
    expect(h.pi.appendEntry).not.toHaveBeenCalled();
    expect(await h.prompt(1_200)).toBeUndefined();
  });

  it("compares growth since the last reminder, including multiple intervals crossed in one task", async () => {
    const h = harness();
    await h.prompt(50_000);
    expect(await h.prompt(59_999)).toBeUndefined();
    expect(await h.prompt(60_000)).toHaveProperty("message.content", DEFAULT_PROMPT);
    expect(await h.prompt(60_001)).toBeUndefined();
    expect(await h.prompt(95_000)).toHaveProperty("message.content", DEFAULT_PROMPT);
    expect(await h.prompt(95_001)).toBeUndefined();
    expect(h.branch.filter((entry) => entry.type === "custom_message")).toHaveLength(3);
  });

  it("uses the same persisted baseline after reload/resume/fork, and only reads the active branch", async () => {
    const original = harness();
    await original.prompt(20_000);
    const resumed = harness([...original.branch]);
    expect(await resumed.prompt(25_000)).toBeUndefined();
    expect(await resumed.prompt(30_000)).toHaveProperty("message");
    // Navigate back to the earlier branch: the later reminder no longer counts.
    resumed.branch.splice(0, resumed.branch.length, ...original.branch);
    expect(await resumed.prompt(30_000)).toHaveProperty("message");
    resumed.branch.length = 0;
    expect(await resumed.prompt(1_000)).toHaveProperty("message");
  });

  it("reminds once after compaction, then establishes a baseline when usage becomes available", async () => {
    const h = harness();
    await h.prompt(50_000);
    h.branch.push({ type: "compaction", id: "compact-1" });
    expect(await h.prompt(null)).toHaveProperty("message");
    expect(await h.prompt(null)).toBeUndefined();
    expect(await h.prompt(undefined)).toBeUndefined();
    expect(await h.prompt(12_000)).toBeUndefined();
    expect(h.pi.appendEntry).toHaveBeenLastCalledWith(CHECKPOINT_TYPE, {
      version: 1, prompt: DEFAULT_PROMPT, contextTokens: 12_000,
    });
    const reloaded = harness(h.branch);
    expect(await reloaded.prompt(21_999)).toBeUndefined();
    expect(await reloaded.prompt(22_000)).toHaveProperty("message");
  });

  it("waits through unavailable usage and rebases a falling estimate without adding another reminder", async () => {
    const h = harness();
    await h.prompt(50_000);
    expect(await h.prompt(null)).toBeUndefined();
    expect(await h.prompt(49_000)).toBeUndefined();
    expect(h.pi.appendEntry).toHaveBeenCalledOnce();
    expect(await h.prompt(58_999)).toBeUndefined();
    expect(await h.prompt(59_000)).toHaveProperty("message");
  });

  it("uses the first available reading as a baseline when the session starts without usage", async () => {
    const h = harness();
    await h.prompt(undefined);
    expect(await h.prompt(undefined)).toBeUndefined();
    expect(await h.prompt(40_000)).toBeUndefined();
    expect(await h.prompt(49_999)).toBeUndefined();
    expect(await h.prompt(50_000)).toHaveProperty("message");
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("treats invalid usage %s as unknown", async (tokens) => {
    const h = harness();
    expect(await h.prompt(tokens)).toHaveProperty("message.details.contextTokens", null);
    expect(await h.prompt(tokens)).toBeUndefined();
  });

  it("reads local configuration each question and applies a changed prompt on the next question", async () => {
    config({ intervalTokens: 500, prompt: "  Be clear.\nUse concrete names.  " });
    const h = harness();
    await h.prompt(2_000);
    expect(h.branch[0].content).toBe("Be clear.\nUse concrete names.");
    expect(await h.prompt(2_499)).toBeUndefined();
    expect(await h.prompt(2_500)).toHaveProperty("message");
    config({ intervalTokens: 500, prompt: "New instructions" });
    expect(await h.prompt(2_501)).toHaveProperty("message.content", "New instructions");
    expect(readConfig).toHaveBeenCalledTimes(4);
  });

  it("uses defaults for a missing file and honors the agent-directory override", async () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", "/tmp/keep-in-mind-agent");
    try {
      readConfig.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
      const h = harness();
      expect(await h.prompt(0)).toHaveProperty("message.content", DEFAULT_PROMPT);
      expect(readConfig).toHaveBeenCalledWith("/tmp/keep-in-mind-agent/keep-in-mind.json", "utf8");
      await h.command();
      expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining(DEFAULT_INTERVAL_TOKENS.toLocaleString()), "info");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([{ enabled: false }, { prompt: "  \n  " }])("does nothing when disabled or empty: %j", async (value) => {
    config(value);
    const h = harness();
    expect(await h.prompt(50_000)).toBeUndefined();
    expect(h.branch).toHaveLength(0);
    expect(h.ctx.getContextUsage).not.toHaveBeenCalled();
    await h.command();
    expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("不再追加提醒"), "info");
  });

  it("skips runs started by custom messages and supports hosts without messageType", async () => {
    const h = harness();
    expect(await h.prompt(50_000, { messageType: "custom", message: { content: "Patrol complete" } })).toBeUndefined();
    expect(readConfig).not.toHaveBeenCalled();
    expect(await h.prompt(50_000, { prompt: "Question", systemPrompt: "Fixed system" })).toHaveProperty("message");
  });

  it.each([
    [], null, "text", { enabled: "yes" }, { prompt: 123 },
    { enabled: null }, { prompt: null }, { intervalTokens: null },
    { intervalTokens: 0 }, { intervalTokens: -1 }, { intervalTokens: 1.5 }, { intervalTokens: "10000" },
  ])("reports invalid config and leaves context unchanged: %j", async (value) => {
    config(value);
    const h = harness();
    expect(await h.prompt(20_000)).toBeUndefined();
    expect(h.branch).toHaveLength(0);
    expect(h.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Keep in mind"), "warning");
  });

  it("reports malformed JSON and read errors without using fallback instructions", async () => {
    const h = harness();
    readConfig.mockResolvedValue("{");
    expect(await h.prompt(20_000)).toBeUndefined();
    readConfig.mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    expect(await h.prompt(20_000)).toBeUndefined();
    expect(h.branch).toHaveLength(0);
    expect(h.ctx.ui.notify).toHaveBeenCalledTimes(2);
  });

  it("ignores unrelated or malformed checkpoints", async () => {
    const h = harness([
      { type: "custom", customType: "other-extension", data: { version: 1, prompt: DEFAULT_PROMPT, contextTokens: 50_000 } },
      { type: "custom_message", customType: REMINDER_TYPE, details: { version: 1, prompt: DEFAULT_PROMPT, contextTokens: -1 } },
    ]);
    expect(await h.prompt(50_001)).toHaveProperty("message");
  });

  it("shows status without changing model context or the reminder baseline", async () => {
    const h = harness();
    await h.prompt(50_000);
    h.ctx.getContextUsage.mockReturnValue({ tokens: 53_000 });
    await h.command("status");
    expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("3,000"), "info");
    expect(h.branch).toHaveLength(1);
    expect(h.pi.appendEntry).not.toHaveBeenCalled();
    await h.command("extra");
    expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("用法"), "warning");
  });

  it("works headlessly and does not notify about a bad configuration", async () => {
    const h = harness();
    h.ctx.hasUI = false;
    expect(await h.prompt(0)).toHaveProperty("message");
    config({ intervalTokens: 0 });
    expect(await h.prompt(1)).toBeUndefined();
    await h.command();
    expect(h.ctx.ui.notify).not.toHaveBeenCalled();
  });
});
