import { createConnection } from "node:net";

export interface MetadataParams {
  pane_id: string;
  source: string;
  agent: "pi";
  seq: number;
  tokens: Record<string, string | null>;
}

/** One bounded NDJSON request to the socket inherited from the calling Herdr pane. */
export async function reportMetadata(params: MetadataParams): Promise<void> {
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (!socketPath) throw new Error("HERDR_SOCKET_PATH is not set");
  const path = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  const id = `pi-sidebar-${params.seq}`;

  return new Promise<void>((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Herdr metadata request timed out")), 2000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(JSON.stringify({ id, method: "pane.report_metadata", params }) + "\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (response?.id !== id) throw new Error("Unexpected Herdr response id");
        if (response.error) throw new Error(response.error.message || "Herdr metadata report failed");
        if (!response.result) throw new Error("Invalid Herdr metadata response");
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.once("error", finish);
    socket.once("close", () => finish(new Error("Herdr socket closed before response")));
  });
}
