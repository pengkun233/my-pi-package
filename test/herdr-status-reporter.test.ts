import { describe, expect, it, vi } from "vitest";
import { SidebarReporter } from "../extensions/herdr-status/reporter.js";

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("Herdr metadata reporting", () => {
  it("targets only the calling pane and never reports actual agent state or title", async () => {
    const exec = vi.fn(async (_command: string, _args: string[], _options: { timeout: number }) => ({ code: 0 }));
    const reporter = new SidebarReporter("w1:p3", exec, vi.fn());
    reporter.publish("review", 2);
    await flush();
    expect(exec.mock.calls[0]).toEqual([
      "herdr",
      ["pane", "report-metadata", "w1:p3", "--source", "my-pi-package:herdr-status", "--agent", "pi",
        "--seq", expect.any(String), "--ttl-ms", "45000", "--token", "pi_task_mark=📖",
        "--token", "pi_subagents=🤖 2 subagents running"],
      { timeout: 2000 },
    ]);
    await reporter.dispose();
    expect(exec.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      "--clear-token", "pi_task_mark", "--clear-token", "pi_subagents",
    ]));
    reporter.publish("working", 1);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("coalesces quick changes, serializes shutdown after in-flight reports", async () => {
    let finish!: (value: { code: number }) => void;
    const exec = vi.fn((_command: string, _args: string[], _options: { timeout: number }) => new Promise<{ code: number }>((resolve) => { finish = resolve; }));
    const reporter = new SidebarReporter("w1:p3", exec, vi.fn());
    reporter.publish("working", 1);
    reporter.publish("sleeping", 2);
    reporter.publish("review", 3);
    expect(exec).toHaveBeenCalledTimes(1);
    finish({ code: 0 });
    await flush();
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1]?.[1]).toContain("pi_task_mark=📖");
    expect(exec.mock.calls[1]?.[1]).toContain("pi_subagents=🤖 3 subagents running");
    const disposed = reporter.dispose();
    finish({ code: 0 });
    await flush();
    expect(exec).toHaveBeenCalledTimes(3);
    finish({ code: 0 });
    await disposed;
    await reporter.dispose();
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it("warns once on failure, retries on the next report, clears a zero count", async () => {
    const exec = vi.fn(async (_command: string, _args: string[], _options: { timeout: number }) => ({ code: 1 }));
    const warn = vi.fn();
    const reporter = new SidebarReporter("w1:p3", exec, warn);
    reporter.publish("sleeping", 0);
    await flush();
    reporter.publish("working", 0);
    await flush();
    expect(exec).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[1]?.[1]).toContain("pi_task_mark=🚀");
    expect(exec.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["--clear-token", "pi_subagents"]));
    await reporter.dispose();
  });
});
