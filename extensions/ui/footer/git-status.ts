import { execFile } from "node:child_process";

export type GitStatusRunner = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number },
  callback: (error: Error | null, stdout: string) => void,
) => unknown;

export interface GitStatus {
  branch?: string;
  dirty: boolean;
}

export class GitStatusCache {
  private value: GitStatus = { dirty: false };
  private pending = false;
  private invalidatedWhilePending = false;
  private disposed = false;

  constructor(
    private readonly cwd: string,
    private readonly redraw: () => void,
    private readonly run: GitStatusRunner = execFile as GitStatusRunner,
  ) {}

  get(): GitStatus { return this.value; }

  refresh(): void {
    if (this.disposed) return;
    if (this.pending) {
      this.invalidatedWhilePending = true;
      return;
    }
    this.pending = true;
    this.invalidatedWhilePending = false;
    this.run("git", ["status", "--porcelain=v1", "--branch"], { cwd: this.cwd, timeout: 500 }, (error, stdout) => {
      this.pending = false;
      if (this.disposed) return;
      if (error) {
        this.value = { dirty: false };
      } else {
        const lines = stdout.split("\n").filter(Boolean);
        const heading = lines.shift() ?? "";
        const detail = heading.startsWith("## ") ? heading.slice(3) : "";
        const branch = detail.startsWith("No commits yet on ")
          ? detail.slice("No commits yet on ".length)
          : detail.split("...")[0]?.trim().split(/\s+/)[0];
        this.value = { branch: branch || undefined, dirty: lines.length > 0 };
      }
      this.redraw();
      if (this.invalidatedWhilePending) this.refresh();
    });
  }

  invalidate(): void { this.refresh(); }
  dispose(): void { this.disposed = true; }
}
