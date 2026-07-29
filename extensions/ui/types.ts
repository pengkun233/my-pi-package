import type {
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

type EditorFactory = Parameters<ExtensionUIContext["setEditorComponent"]>[0];

export type UiContext = ExtensionContext | ExtensionCommandContext;

export interface Disposable {
  dispose(): void;
}

export interface UiFeatureSession extends Disposable {
  onTurnStart?(): void;
  onMessageUpdate?(event: unknown): void;
  onTurnEnd?(): void;
  onAgentEnd?(): void;
  onToolResult?(event: unknown): void;
  onUserBash?(event: unknown): void;
}

export interface UiInstaller {
  install(ctx: UiContext, isActive: () => boolean): UiFeatureSession;
  setStyledActive(active: boolean, ui?: ExtensionUIContext): void;
}

export interface SessionSnapshot {
  editor: EditorFactory | undefined;
}
