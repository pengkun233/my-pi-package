import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportMetadata, type MetadataParams } from "../extensions/herdr-status/socket.js";

const params: MetadataParams = {
  pane_id: "w1:p3", source: "my-pi-package:herdr-status", agent: "pi", seq: 1,
  tokens: { pi_task_mark: "📖", pi_subagents: null },
};
const cleanups: Array<() => Promise<void>> = [];
async function server(onRequest: (request: any, socket: Socket) => void) {
  const dir = await mkdtemp(join(tmpdir(), "pi-herdr-"));
  const path = join(dir, "rpc.sock");
  const sockets = new Set<Socket>();
  const listener = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\n")) onRequest(JSON.parse(data.split("\n")[0]!), socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(path, resolve);
  });
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  vi.stubEnv("HERDR_SOCKET_PATH", path);
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllEnvs();
});

describe("Herdr local socket transport", () => {
  it("sends newline-delimited metadata and accepts a fragmented success response", async () => {
    let received: any;
    await server((request, socket) => {
      received = request;
      const response = JSON.stringify({ id: request.id, result: { type: "ok" } }) + "\n";
      socket.write(response.slice(0, 10));
      setImmediate(() => socket.end(response.slice(10)));
    });
    await reportMetadata(params);
    expect(received.method).toBe("pane.report_metadata");
    expect(received.params).toEqual(params);
    expect(received.params).not.toHaveProperty("ttl_ms");
  });

  it("surfaces server errors", async () => {
    await server((request, socket) => socket.end(JSON.stringify({
      id: request.id, error: { code: "not_found", message: "pane missing" },
    }) + "\n"));
    await expect(reportMetadata(params)).rejects.toThrow("pane missing");
  });

  it("rejects malformed responses", async () => {
    await server((_request, socket) => socket.end("not json\n"));
    await expect(reportMetadata(params)).rejects.toThrow();
  });

  it("rejects a connection closed without a complete response", async () => {
    await server((_request, socket) => socket.end());
    await expect(reportMetadata(params)).rejects.toThrow(/closed/i);
  });

  it("times out when the server never responds", async () => {
    await server(() => {});
    await expect(reportMetadata(params)).rejects.toThrow(/timed out/i);
  });

  it("surfaces connection errors without falling back to the CLI", async () => {
    vi.stubEnv("HERDR_SOCKET_PATH", "/nonexistent/pi-herdr-test.sock");
    await expect(reportMetadata(params)).rejects.toThrow();
  });
});
