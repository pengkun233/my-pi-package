import type {
  AgentEndEvent,
  ExtensionUIContext,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { createEditorFeature, type EditorFeature } from "./chat-input.js";
import { createFooterService } from "./footer/index.js";
import { SpinnerService } from "./spinner.js";
import { installHeader } from "./startup/index.js";
import { installStyledPatches, setStyledActive } from "./styled/index.js";
import { installSubagentWidgetAdapter } from "./styled/subagent.js";
import { TerminalStatusService, type TerminalStatusDependencies } from "./terminal-status.js";
import type { SessionSnapshot, UiContext, UiFeatureSession, UiInstaller } from "./types.js";

class InstalledFeatures implements UiFeatureSession {
  constructor(
    private readonly footer: ReturnType<typeof createFooterService>,
    private readonly spinner: SpinnerService,
    private readonly editor: EditorFeature,
    private readonly disposeSubagentWidgets: () => void,
  ) {}

  onTurnStart(): void { this.spinner.onTurnStart(); }
  onMessageUpdate(event: unknown): void { this.spinner.onMessageUpdate(event); }
  onTurnEnd(): void { this.spinner.onTurnEnd(); }
  onAgentEnd(): void { this.spinner.onAgentEnd(); }
  onToolResult(event: unknown): void { this.footer.onToolResult(event); }
  onUserBash(event: unknown): void { this.footer.onUserBash(event); }
  dispose(): void {
    this.editor.dispose();
    this.disposeSubagentWidgets();
    this.spinner.dispose();
    this.footer.dispose();
  }
}

export class DefaultUiInstaller implements UiInstaller {
  install(ctx: UiContext, isActive: () => boolean): UiFeatureSession {
    installStyledPatches();
    setStyledActive(true, ctx.ui);
    const footer = createFooterService(ctx, isActive);
    const spinner = new SpinnerService(ctx, isActive);
    const editor = createEditorFeature(ctx);
    const disposeSubagentWidgets = installSubagentWidgetAdapter(ctx.ui);
    try {
      installHeader(ctx);
      footer.install();
      ctx.ui.setEditorComponent(editor.factory);
      spinner.install();
      return new InstalledFeatures(footer, spinner, editor, disposeSubagentWidgets);
    } catch (error) {
      editor.dispose();
      disposeSubagentWidgets();
      spinner.dispose();
      footer.dispose();
      setStyledActive(false);
      throw error;
    }
  }

  setStyledActive(value: boolean, ui?: ExtensionUIContext): void {
    setStyledActive(value, ui);
  }
}

export interface ControllerResult {
  ok: boolean;
  message: string;
}

export class UiController {
  private active = false;
  private context?: UiContext;
  private snapshot?: SessionSnapshot;
  private features?: UiFeatureSession;
  private terminalStatus?: TerminalStatusService;

  constructor(
    private readonly installer: UiInstaller = new DefaultUiInstaller(),
    private readonly terminalStatusDependencies?: TerminalStatusDependencies,
  ) {}

  isActive(): boolean { return this.active; }

  sessionStart(ctx: UiContext): ControllerResult {
    if (this.active || this.features || this.snapshot) this.sessionShutdown();
    if (!ctx.hasUI || ctx.mode !== "tui") {
      return { ok: true, message: "UI skipped outside an interactive TUI session." };
    }

    this.context = ctx;
    this.snapshot = { editor: ctx.ui.getEditorComponent() };
    this.active = true;
    try {
      this.features = this.installer.install(ctx, () => this.active);
      if (this.terminalStatusDependencies) {
        this.terminalStatus = new TerminalStatusService(ctx, this.terminalStatusDependencies);
        this.terminalStatus.install();
      }
      return { ok: true, message: "UI installed." };
    } catch (error) {
      this.cleanup(ctx);
      const message = `Unable to install UI: ${String(error)}`;
      ctx.ui.notify(message, "error");
      return { ok: false, message };
    }
  }

  acknowledge(ctx: UiContext): ControllerResult {
    if (!this.active || !this.terminalStatus) {
      const message = "Terminal status is unavailable outside the active UI.";
      ctx.ui.notify(message, "warning");
      return { ok: false, message };
    }
    if (!ctx.isIdle()) {
      const message = "Wait for the current agent run to finish before acknowledging it.";
      ctx.ui.notify(message, "warning");
      return { ok: false, message };
    }
    this.terminalStatus.acknowledge();
    const message = "Terminal status set to idle.";
    ctx.ui.notify(message, "info");
    return { ok: true, message };
  }

  sessionShutdown(): void {
    if (this.context) this.cleanup(this.context);
    else {
      this.features?.dispose();
      this.terminalStatus?.dispose();
      this.installer.setStyledActive(false);
    }
    this.context = undefined;
    this.snapshot = undefined;
    this.features = undefined;
    this.terminalStatus = undefined;
    this.active = false;
  }

  private cleanup(ctx: UiContext): void {
    this.terminalStatus?.dispose();
    this.terminalStatus = undefined;
    this.features?.dispose();
    this.features = undefined;
    this.active = false;
    ctx.ui.setFooter(undefined);
    ctx.ui.setHeader(undefined);
    ctx.ui.setEditorComponent(this.snapshot?.editor);
    ctx.ui.setWorkingMessage();
    ctx.ui.setWorkingVisible(true);
    ctx.ui.setWorkingIndicator();
    ctx.ui.setHiddenThinkingLabel();
    this.installer.setStyledActive(false);
  }

  onAgentStart(): void { if (this.active) this.terminalStatus?.onAgentStart(); }
  onTurnStart(): void { if (this.active) this.features?.onTurnStart?.(); }
  onMessageUpdate(event: unknown): void { if (this.active) this.features?.onMessageUpdate?.(event); }
  onTurnEnd(): void { if (this.active) this.features?.onTurnEnd?.(); }
  onAgentEnd(event: AgentEndEvent): void {
    if (!this.active) return;
    this.features?.onAgentEnd?.();
    this.terminalStatus?.onAgentEnd(event);
  }
  onAgentSettled(): void { if (this.active) this.terminalStatus?.onAgentSettled(); }
  onSessionInfoChanged(): void { if (this.active) this.terminalStatus?.refreshTitle(); }
  onToolExecutionStart(event: ToolExecutionStartEvent): void {
    if (this.active) this.terminalStatus?.onToolExecutionStart(event);
  }
  onToolExecutionEnd(event: ToolExecutionEndEvent): void {
    if (this.active) this.terminalStatus?.onToolExecutionEnd(event);
  }
  onToolResult(event: unknown): void { if (this.active) this.features?.onToolResult?.(event); }
  onUserBash(event: unknown): void { if (this.active) this.features?.onUserBash?.(event); }
}
