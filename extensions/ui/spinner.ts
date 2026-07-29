import { getKeybindings } from "@earendil-works/pi-tui";
import type { UiContext, UiFeatureSession } from "./types.js";
import {
  CHARACTERS_PER_ESTIMATED_TOKEN,
  SPINNER_FRAMES,
  SPINNER_INTERVAL_MS,
  STATUS_REFRESH_MS,
  VERB_CYCLE_MS,
} from "./spinner-config.js";
import { pickVerb } from "./verbs.js";

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export class SpinnerService implements UiFeatureSession {
  private timers = new Set<ReturnType<typeof setInterval>>();
  private started = 0;
  private characters = 0;
  private verb = "Thinking";
  private disposed = false;

  constructor(private readonly ctx: UiContext, private readonly isActive: () => boolean) {}

  install(): void { this.setThinkingLabel(); }

  private setThinkingLabel(): void {
    if (!this.isActive() || !this.ctx.hasUI) return;
    const key = getKeybindings().getKeys("app.thinking.toggle")[0] ?? "unbound";
    this.ctx.ui.setHiddenThinkingLabel(`→ ${key} to show thinking block`);
  }

  private sync(): void {
    if (!this.isActive() || !this.started) return;
    const estimate = Math.round(this.characters / CHARACTERS_PER_ESTIMATED_TOKEN);
    const status = `${duration(Date.now() - this.started)}${estimate ? ` · ≈${estimate.toLocaleString("en")} tokens` : ""}`;
    let message = `${this.verb}...\n· ${status}`;
    try { message = this.ctx.ui.theme.fg("accent", `${this.verb}...`) + `\n` + this.ctx.ui.theme.fg("muted", `· ${status}`); } catch {}
    this.ctx.ui.setWorkingMessage(message);
  }

  onTurnStart(): void {
    if (this.disposed || !this.isActive() || !this.ctx.hasUI || this.started) return;
    this.started = Date.now();
    this.characters = 0;
    this.verb = pickVerb();
    this.setThinkingLabel();
    this.ctx.ui.setWorkingVisible(true);
    this.ctx.ui.setWorkingIndicator({ frames: [...SPINNER_FRAMES], intervalMs: SPINNER_INTERVAL_MS });
    this.sync();
    this.timers.add(setInterval(() => this.sync(), STATUS_REFRESH_MS));
    this.timers.add(setInterval(() => { this.verb = pickVerb(this.verb); this.sync(); }, VERB_CYCLE_MS));
  }

  onMessageUpdate(event: unknown): void {
    if (!this.isActive() || !this.started) return;
    const outer = event as Record<string, any>;
    const delta = outer.assistantMessageEvent ?? outer.delta ?? outer;
    if (delta?.type === "text" || delta?.type === "text_delta") {
      this.characters += typeof delta.delta === "string" ? delta.delta.length : 0;
      this.sync();
    } else if (delta?.type === "done" && Array.isArray(delta.message?.content)) {
      this.characters = delta.message.content.reduce((sum: number, block: any) => sum + (block?.type === "text" && typeof block.text === "string" ? block.text.length : 0), 0);
      this.sync();
    }
  }

  private clearTurn(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    this.started = 0;
    this.characters = 0;
  }

  private restoreDefaults(): void {
    if (!this.ctx.hasUI) return;
    this.ctx.ui.setWorkingMessage();
    this.ctx.ui.setWorkingIndicator();
    this.ctx.ui.setHiddenThinkingLabel();
  }

  onTurnEnd(): void { this.clearTurn(); this.restoreDefaults(); }
  onAgentEnd(): void { this.clearTurn(); this.restoreDefaults(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTurn();
    this.restoreDefaults();
  }
}
