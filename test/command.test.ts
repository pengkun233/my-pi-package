import { describe, expect, it, vi } from "vitest";
import { registerAckCommand } from "../extensions/ui/command.js";

describe("ack command", () => {
  it("delegates acknowledgement without registering UI toggles", async () => {
    const registered = new Map<string, any>();
    const pi: any = { registerCommand: (name: string, options: any) => registered.set(name, options) };
    const controller: any = { acknowledge: vi.fn() };
    const ctx: any = {};

    registerAckCommand(pi, controller);
    await registered.get("ack").handler("", ctx);

    expect([...registered.keys()]).toEqual(["ack"]);
    expect(controller.acknowledge).toHaveBeenCalledWith(ctx);
  });
});
