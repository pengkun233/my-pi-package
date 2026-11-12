import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

export const REMINDER_TYPE = "my-pi-package:keep-in-mind";
export const CHECKPOINT_TYPE = "my-pi-package:keep-in-mind-checkpoint";
export const DEFAULT_INTERVAL_TOKENS = 10_000;
export const DEFAULT_PROMPT = [
  "用自然、容易理解的中文回答，保留帮助理解的必要解释。",
  "一句话尽量讲清一件事。对象称呼具体、前后一致；不熟悉的缩写和术语，出现时就解释。",
  "直接回答当前问题。只说明会影响当前判断或操作的限制，省去针对假想误解的澄清和自我辩护。",
  "用户本次另有表达要求时，按本次要求调整。",
].join("\n");

type Config = { enabled: boolean; intervalTokens: number; prompt: string };
type Checkpoint = { version: 1; prompt: string; contextTokens: number | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function configPath(): string {
  return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "keep-in-mind.json");
}

function contextTokens(ctx: ExtensionContext): number | null {
  const tokens = ctx.getContextUsage()?.tokens;
  return typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0 ? tokens : null;
}

async function loadConfig(): Promise<Config> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(configPath(), "utf8"));
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") value = {};
    else throw error;
  }
  if (!isRecord(value)) throw new Error("配置必须是 JSON 对象");
  const enabled = value.enabled === undefined ? true : value.enabled;
  const intervalTokens = value.intervalTokens === undefined ? DEFAULT_INTERVAL_TOKENS : value.intervalTokens;
  const prompt = value.prompt === undefined ? DEFAULT_PROMPT : value.prompt;
  if (typeof enabled !== "boolean") throw new Error("enabled 必须是布尔值");
  if (typeof intervalTokens !== "number" || !Number.isSafeInteger(intervalTokens) || intervalTokens <= 0) {
    throw new Error("intervalTokens 必须是正整数");
  }
  if (typeof prompt !== "string") throw new Error("prompt 必须是字符串");
  return { enabled, intervalTokens, prompt: prompt.trim() };
}

function parseCheckpoint(value: unknown): Checkpoint | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.prompt !== "string") return;
  const tokens = value.contextTokens;
  if (tokens !== null && (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0)) return;
  return { version: 1, prompt: value.prompt, contextTokens: tokens };
}

// Only the active branch counts. A compaction starts a fresh reminder interval.
function lastCheckpoint(branch: readonly SessionEntry[]): Checkpoint | undefined {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry.type === "compaction") return;
    const value = entry.type === "custom_message" && entry.customType === REMINDER_TYPE ? entry.details
      : entry.type === "custom" && entry.customType === CHECKPOINT_TYPE ? entry.data
      : undefined;
    const checkpoint = parseCheckpoint(value);
    if (checkpoint) return checkpoint;
  }
}

function notifyError(ctx: ExtensionContext, error: unknown): void {
  if (ctx.hasUI) ctx.ui.notify(`Keep in mind：${error instanceof Error ? error.message : String(error)}`, "warning");
}

export default function keepInMind(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    // Newer hosts can also start runs with a custom message, such as a patrol result.
    if ("messageType" in event && event.messageType !== "user") return;
    try {
      const config = await loadConfig();
      if (!config.enabled || !config.prompt) return;
      const tokens = contextTokens(ctx);
      const previous = lastCheckpoint(ctx.sessionManager.getBranch());
      const checkpoint: Checkpoint = { version: 1, prompt: config.prompt, contextTokens: tokens };
      const first = !previous || previous.prompt !== config.prompt;
      const due = previous?.contextTokens != null && tokens !== null &&
        tokens - previous.contextTokens >= config.intervalTokens;
      if (first || due) {
        // This is an append-only, model-facing message. It leaves the fixed system prefix intact.
        return { message: { customType: REMINDER_TYPE, content: config.prompt, display: false, details: checkpoint } };
      }
      if (tokens !== null && (previous.contextTokens === null || tokens < previous.contextTokens)) {
        // Usage can be unknown after compaction or change after switching models.
        // Save the new baseline as metadata, without adding another reminder to model context.
        pi.appendEntry(CHECKPOINT_TYPE, checkpoint);
      }
    } catch (error) {
      notifyError(ctx, error);
    }
  });

  pi.registerCommand("keep-in-mind", {
    description: "查看定期提醒的提示词、token 间隔和当前进度",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      if (!["", "status"].includes(args.trim())) {
        ctx.ui.notify("用法：/keep-in-mind [status]；编辑 keep-in-mind.json 修改配置", "warning");
        return;
      }
      try {
        const config = await loadConfig();
        const tokens = contextTokens(ctx);
        const previous = lastCheckpoint(ctx.sessionManager.getBranch());
        const growth = tokens !== null && previous?.contextTokens != null
          ? Math.max(0, tokens - previous.contextTokens) : null;
        const progress = !config.enabled || !config.prompt ? "不再追加提醒"
          : !previous || previous.prompt !== config.prompt ? "下次提问时提醒"
          : growth === null ? "等待 Pi 提供上下文用量"
          : `距上次提醒新增约 ${growth.toLocaleString()} token`;
        ctx.ui.notify([
          `Keep in mind：${config.enabled && config.prompt ? "开启" : "关闭"}`,
          `间隔：${config.intervalTokens.toLocaleString()} token；${progress}`,
          `配置：${configPath()}`,
          `提示词：\n${config.prompt || "（空）"}`,
        ].join("\n"), "info");
      } catch (error) {
        notifyError(ctx, error);
      }
    },
  });
}
