import { describe, expect, it, vi } from "vitest";
import { GitStatusCache, type GitStatusRunner } from "../extensions/ui/footer/git-status.js";
import { FooterService } from "../extensions/ui/footer/index.js";

describe("git footer invalidation", () => {
  it("queues an invalidation that arrives while refresh is pending", () => {
    const callbacks: Array<(error: Error | null, stdout: string) => void> = [];
    const runner: GitStatusRunner = (_file, _args, _options, callback) => { callbacks.push(callback); };
    const redraw = vi.fn();
    const cache = new GitStatusCache("/tmp", redraw, runner);
    cache.refresh();
    cache.invalidate();
    expect(callbacks).toHaveLength(1);
    callbacks[0](null, "## main\n");
    expect(callbacks).toHaveLength(2);
    callbacks[1](null, "## next\n M file\n");
    expect(cache.get()).toEqual({ branch: "next", dirty: true });
    expect(redraw).toHaveBeenCalledTimes(2);
  });

  it("invalidates on branch observation and every bash/user-bash result", () => {
    let branchChanged!: () => void;
    let factory: any;
    const service = new FooterService({
      cwd: "/tmp", ui: { setFooter: (value: any) => { factory = value; } },
      sessionManager: { getBranch: () => [] },
    } as any, () => true);
    service.install();
    const component = factory(
      { requestRender: vi.fn() },
      { fg: (_token: string, value: string) => value },
      { getGitBranch: () => null, onBranchChange: (callback: () => void) => { branchChanged = callback; return vi.fn(); } },
    );
    const invalidate = vi.fn();
    (service as any).cache = { get: () => ({ dirty: false }), invalidate, dispose: vi.fn() };
    branchChanged();
    service.onToolResult({ toolName: "bash", input: { command: "echo harmless" } });
    service.onUserBash({ command: "echo harmless" });
    expect(invalidate).toHaveBeenCalledTimes(3);
    component.dispose();
    service.dispose();
  });
});
