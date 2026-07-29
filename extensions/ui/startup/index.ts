import { VERSION } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import type { UiContext } from "../types.js";
import { renderStartup, type StartupKeys } from "./layout.js";

export function getStartupKeys(): StartupKeys {
  const bindings = getKeybindings();
  return {
    model: bindings.getKeys("app.model.cycleForward")[0] ?? "unbound",
    thinking: bindings.getKeys("app.thinking.cycle")[0] ?? "unbound",
    version: VERSION,
  };
}

export function installHeader(ctx: UiContext): void {
  if (!ctx.hasUI || ctx.mode !== "tui") return;
  const keys = getStartupKeys();
  ctx.ui.setHeader((_tui, theme) => ({
    invalidate() {},
    render(width: number): string[] { return renderStartup(theme, width, keys); },
  }));
}
