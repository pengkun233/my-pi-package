import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const FAST_STATUS_ID = "openai-fast";
export const FAST_STATE_TYPE = "my-pi-package:openai-fast";

// Explicit opt-in list: newly added models must not start using extra quota by surprise.
export const FAST_MODEL_IDS = new Set([
  "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna",
  "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4",
]);

type FastModel = { provider: string; id: string; api: string };

export function supportsFastMode(model: FastModel | undefined): boolean {
  return !!model && FAST_MODEL_IDS.has(model.id) && (
    (model.provider === "openai" && model.api === "openai-responses") ||
    (model.provider === "openai-codex" && model.api === "openai-codex-responses")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export default function openaiFast(pi: ExtensionAPI): void {
  let enabled = false;

  const updateStatus = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(FAST_STATUS_ID, enabled
      ? supportsFastMode(ctx.model) ? "Fast" : "Fast (N/A)"
      : undefined);
  };

  const restore = (ctx: ExtensionContext): void => {
    enabled = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === FAST_STATE_TYPE &&
          isRecord(entry.data) && typeof entry.data.enabled === "boolean") {
        enabled = entry.data.enabled;
      }
    }
    updateStatus(ctx);
  };

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("model_select", (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    enabled = false;
    updateStatus(ctx);
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled || !supportsFastMode(ctx.model)) return;
    if (!isRecord(event.payload) || event.payload.model !== ctx.model?.id) return;
    // ChatGPT OAuth uses the wire value "priority", even though the UI calls it Fast.
    return { ...event.payload, service_tier: "priority" };
  });

  pi.registerCommand("fast", {
    description: "开关 OpenAI Fast 模式（priority，可能增加额度消耗）",
    getArgumentCompletions: (prefix) => {
      const items = ["on", "off", "status"].filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (!["", "on", "off", "status"].includes(action)) {
        if (ctx.hasUI) ctx.ui.notify("用法：/fast [on|off|status]", "warning");
        return;
      }
      const next = action === "status" ? enabled : action === "on" ? true : action === "off" ? false : !enabled;
      if (next !== enabled) {
        pi.appendEntry(FAST_STATE_TYPE, { enabled: next });
        enabled = next;
      }
      updateStatus(ctx);
      if (ctx.hasUI) {
        const message = !enabled ? "Fast 已关闭" : supportsFastMode(ctx.model)
          ? "Fast 已开启（priority，可能增加额度消耗）"
          : "Fast 已开启；当前模型不支持，暂不应用";
        ctx.ui.notify(message, enabled && !supportsFastMode(ctx.model) ? "warning" : "info");
      }
    },
  });
}
