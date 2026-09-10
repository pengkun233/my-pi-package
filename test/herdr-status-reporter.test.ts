import { describe, expect, it, vi } from "vitest";
import { SidebarReporter } from "../extensions/herdr-status/reporter.js";
import type { MetadataParams } from "../extensions/herdr-status/socket.js";

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("Herdr metadata reporting", () => {
  it("reports only display tokens to the calling pane, without TTL", async () => {
    const send = vi.fn(async (_params: MetadataParams) => {});
    const reporter = new SidebarReporter("w1:p3", vi.fn(), send);
    reporter.publish("review", 2);
    expect(send).toHaveBeenCalledWith({
      pane_id: "w1:p3", source: "my-pi-package:herdr-status", agent: "pi",
      seq: expect.any(Number), tokens: { pi_task_mark: "📖", pi_subagents: "🤖 2 subagents running" },
    });
    await reporter.dispose();
    expect(send.mock.calls.at(-1)?.[0].tokens).toEqual({ pi_task_mark: null, pi_subagents: null });
    reporter.publish("working", 1);
    await reporter.dispose();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends every change immediately without a queue and gives cleanup the highest sequence", async () => {
    const finishes: Array<() => void> = [];
    const send = vi.fn((_params: MetadataParams) => new Promise<void>((resolve) => { finishes.push(resolve); }));
    const reporter = new SidebarReporter("w1:p3", vi.fn(), send);
    reporter.publish("working", 1);
    reporter.publish("sleeping", 2);
    reporter.publish("review", 3);
    expect(send).toHaveBeenCalledTimes(3);
    const disposed = reporter.dispose();
    expect(send).toHaveBeenCalledTimes(4);
    const seqs = send.mock.calls.map(([params]) => params.seq);
    expect(seqs).toEqual([seqs[0], seqs[0]! + 1, seqs[0]! + 2, seqs[0]! + 3]);
    finishes[3]!();
    await disposed;
    // Earlier requests may complete later; ordering is enforced by Herdr, not a client queue.
    finishes.slice(0, 3).forEach((finish) => finish());
    await flush();
  });

  it("reports every failure including cleanup, with no automatic retry", async () => {
    const error = new Error("socket unavailable");
    const send = vi.fn(async (_params: MetadataParams) => { throw error; });
    const warn = vi.fn();
    const reporter = new SidebarReporter("w1:p3", warn, send);
    reporter.publish("sleeping", 0);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    reporter.publish("working", 0);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(error);
    expect(send.mock.calls[1]?.[0].tokens).toEqual({ pi_task_mark: "🚀", pi_subagents: null });
    await reporter.dispose();
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
