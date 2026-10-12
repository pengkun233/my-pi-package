import { performance } from "node:perf_hooks";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const COMPLETION_ENTRY = "task-completion";
export interface Completion { status: "finished" | "stopped" | "error"; endedAt: string; durationMs: number }

export function completionText(data: Completion): string {
  const date = new Date(data.endedAt);
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
  const seconds = Math.max(0, Math.round(data.durationMs / 1000));
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : `${seconds}s`;
  return `${data.status} · ${time} · ${duration}`;
}

export default function (pi: ExtensionAPI) {
  let started: number | undefined;
  let status: Completion["status"] = "error";
  let signal: AbortSignal | undefined;
  const reset = () => { started = undefined; status = "error"; signal = undefined; };
  pi.on("session_start", reset);
  pi.on("session_tree", reset);
  pi.on("session_shutdown", reset);
  pi.on("agent_start", (_event, ctx) => {
    // Retries/automatic continuation must not restart the run's clock.
    if (started === undefined) started = performance.now();
    signal = ctx?.signal;
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const reason = event.message.stopReason;
    status = reason === "error" ? "error" : reason === "aborted" ? "stopped" : "finished";
  });
  pi.on("agent_settled", (event) => {
    if (started === undefined) return;
    // New hosts expose the final abort outcome; older hosts expose the run signal.
    // A cancellation during tools/retry need not emit an aborted assistant message.
    const aborted = (event as { aborted?: boolean } | undefined)?.aborted ?? signal?.aborted;
    const data: Completion = { status: aborted ? "stopped" : status, endedAt: new Date().toISOString(), durationMs: performance.now() - started };
    reset();
    pi.appendEntry(COMPLETION_ENTRY, data);
  });
  pi.registerEntryRenderer<Completion>(COMPLETION_ENTRY, (entry, _options, theme) => {
    const data = entry.data;
    if (!data || !Number.isFinite(Date.parse(data.endedAt)) || !Number.isFinite(data.durationMs)) return;
    return {
      invalidate() {},
      render(width) {
        const line = truncateToWidth(completionText(data), width, "");
        return [theme.fg("dim", " ".repeat(Math.max(0, width - visibleWidth(line))) + line)];
      },
    };
  });
}
