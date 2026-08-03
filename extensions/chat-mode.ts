import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

const STATUS_ID = "chat-mode";
const WRITE_TOOLS = new Set(["edit", "write"]);

const CHAT_MODE_PROMPT = `## Chat Mode

Chat Mode is active. Treat this turn as discussion-only.

- Do not take actions with side effects. Do not change local or remote files, repositories, services, processes, packages, credentials, memory, or other external state.
- Do not use bash, subagents, or other tools to bypass this restriction or execute changes.
- You may inspect files, search, analyze, review, plan, and answer questions with read-only operations.
- You may show proposed code, pseudocode, or diff drafts in your response, but do not apply them.
- If the user asks you to implement or modify something, do not make the change. Ask them to exit Chat Mode with /chat or Ctrl+Alt+C first.`;

export default function chatModeExtension(pi: ExtensionAPI): void {
  let enabled = false;
  const restorableWriteTools = new Set<string>();

  function updateStatus(ctx: ExtensionContext): void {
    const status = enabled && ctx.mode === "tui"
      ? ctx.ui.theme.fg("warning", "💬 chat")
      : undefined;
    ctx.ui.setStatus(STATUS_ID, status);
  }

  function restrictWriteTools(rememberForRestore: boolean): void {
    const activeTools = pi.getActiveTools();
    const allowedTools = activeTools.filter((name) => {
      if (!WRITE_TOOLS.has(name)) return true;
      if (rememberForRestore) restorableWriteTools.add(name);
      return false;
    });

    if (allowedTools.length !== activeTools.length) {
      pi.setActiveTools(allowedTools);
    }
  }

  function restoreWriteTools(): void {
    if (restorableWriteTools.size === 0) return;

    const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
    const activeTools = pi.getActiveTools();
    const restoredTools = [
      ...activeTools,
      ...[...restorableWriteTools].filter(
        (name) => availableTools.has(name) && !activeTools.includes(name),
      ),
    ];

    if (restoredTools.length !== activeTools.length) {
      pi.setActiveTools(restoredTools);
    }
    restorableWriteTools.clear();
  }

  function enable(ctx: ExtensionContext, notify: boolean): void {
    restorableWriteTools.clear();
    enabled = true;
    restrictWriteTools(true);
    updateStatus(ctx);
    if (notify) {
      ctx.ui.notify("Chat mode enabled — file edits disabled", "info");
    }
  }

  function disable(ctx: ExtensionContext, notify: boolean): void {
    enabled = false;
    restoreWriteTools();
    updateStatus(ctx);
    if (notify) {
      ctx.ui.notify("Chat mode disabled — full tool access restored", "info");
    }
  }

  function toggle(ctx: ExtensionContext): void {
    if (!ctx.isIdle()) {
      ctx.ui.notify(
        "Wait for the current agent run to finish, or press Esc to stop it, before switching Chat mode.",
        "warning",
      );
      return;
    }

    if (enabled) disable(ctx, true);
    else enable(ctx, true);
  }

  pi.registerCommand("chat", {
    description: "Toggle discussion-only Chat mode",
    handler: async (_args, ctx) => toggle(ctx),
  });

  pi.registerShortcut(Key.ctrlAlt("c"), {
    description: "Toggle Chat mode",
    handler: async (ctx) => toggle(ctx),
  });

  pi.on("session_start", (_event, ctx) => {
    enabled = false;
    restorableWriteTools.clear();
    updateStatus(ctx);
  });

  pi.on("before_agent_start", (event) => {
    if (!enabled) return undefined;

    // Re-apply the restriction in case another extension changed the active tools.
    restrictWriteTools(false);
    return { systemPrompt: `${event.systemPrompt}\n\n${CHAT_MODE_PROMPT}` };
  });

  pi.on("tool_call", (event) => {
    if (!enabled || !WRITE_TOOLS.has(event.toolName)) return undefined;

    return {
      block: true,
      reason: "Chat mode blocks edit and write. Exit Chat mode with /chat or Ctrl+Alt+C before modifying files.",
    };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (enabled) disable(ctx, false);
    else updateStatus(ctx);
  });
}
