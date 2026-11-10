import { describe, expect, it, vi } from "vitest";
import openaiFast, { FAST_MODEL_IDS, FAST_STATE_TYPE, FAST_STATUS_ID, supportsFastMode } from "../extensions/openai-fast/index.js";

const openai = { provider: "openai", api: "openai-responses", id: "gpt-6.1-sol" };
const codex = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-6.1-sol" };

function harness(branch: any[] = [], model: any = openai) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const appendEntry = vi.fn((customType: string, data: unknown) => branch.push({ type: "custom", customType, data }));
  const ctx: any = {
    hasUI: true, model,
    sessionManager: { getBranch: () => branch },
    ui: { setStatus: vi.fn(), notify: vi.fn() },
  };
  const pi: any = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    appendEntry,
  };
  openaiFast(pi);
  return {
    ctx, branch, appendEntry, pi,
    command: (args = "") => commands.get("fast").handler(args, ctx),
    completions: (prefix: string) => commands.get("fast").getArgumentCompletions(prefix),
    emit: (event: string) => handlers.get(event)!({}, ctx),
    request: (payload: unknown) => handlers.get("before_provider_request")!({ payload }, ctx),
  };
}

function state(enabled: unknown) {
  return { type: "custom", customType: FAST_STATE_TYPE, data: { enabled } };
}

describe("OpenAI Fast mode", () => {
  it("starts off, toggles with /fast, publishes footer state and saves no model-facing messages", async () => {
    const h = harness();
    const payload = { model: openai.id, input: [], stream: true, store: false };
    h.emit("session_start");
    expect(h.ctx.ui.setStatus).toHaveBeenLastCalledWith(FAST_STATUS_ID, undefined);
    expect(h.request(payload)).toBeUndefined();
    await h.command();
    expect(h.ctx.ui.setStatus).toHaveBeenLastCalledWith(FAST_STATUS_ID, "Fast");
    expect(h.appendEntry).toHaveBeenLastCalledWith(FAST_STATE_TYPE, { enabled: true });
    expect(h.request(payload)).toEqual({ ...payload, service_tier: "priority" });
    expect(payload).not.toHaveProperty("service_tier");
    expect(h.pi).not.toHaveProperty("registerProvider");
    expect(h.pi).not.toHaveProperty("setModel");
    await h.command();
    expect(h.ctx.ui.setStatus).toHaveBeenLastCalledWith(FAST_STATUS_ID, undefined);
    expect(h.appendEntry).toHaveBeenLastCalledWith(FAST_STATE_TYPE, { enabled: false });
    expect(h.request(payload)).toBeUndefined();
  });

  it("supports explicit on/off/status without duplicate state entries or changes to the model", async () => {
    const h = harness();
    await h.command(" ON ");
    await h.command("on");
    await h.command("status");
    expect(h.appendEntry).toHaveBeenCalledTimes(1);
    expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("Fast 已开启"), "info");
    expect(h.ctx.model).toBe(openai);
    await h.command("off");
    await h.command("off");
    expect(h.appendEntry).toHaveBeenCalledTimes(2);
    expect(h.ctx.ui.notify).toHaveBeenLastCalledWith("Fast 已关闭", "info");
  });

  it("reports invalid arguments and offers only the supported completions", async () => {
    const h = harness();
    await h.command("on extra");
    expect(h.appendEntry).not.toHaveBeenCalled();
    expect(h.ctx.ui.notify).toHaveBeenLastCalledWith("用法：/fast [on|off|status]", "warning");
    expect(h.completions("o").map((item: any) => item.value)).toEqual(["on", "off"]);
    expect(h.completions("stat")).toEqual([{ value: "status", label: "status" }]);
    expect(h.completions("invalid")).toBeNull();
  });

  it("uses the supported existing provider/API pairs, including legacy Codex", async () => {
    for (const model of [openai, codex]) {
      const h = harness([], model);
      await h.command("on");
      const payload = { model: model.id, tools: [{ type: "function", name: "test" }], reasoning: { effort: "high" }, service_tier: "flex" };
      expect(h.request(payload)).toEqual({ ...payload, service_tier: "priority" });
      expect(payload.service_tier).toBe("flex");
    }
    for (const id of FAST_MODEL_IDS) expect(supportsFastMode({ ...openai, id })).toBe(true);
  });

  it.each([
    undefined,
    { ...openai, id: "future-model" },
    { ...openai, provider: "openrouter" },
    { ...openai, provider: "openai-codex-fast" },
    { ...openai, api: "openai-completions" },
    { ...codex, api: "openai-responses" },
  ])("does not patch unsupported model/provider/API %j", async (model) => {
    const h = harness();
    h.ctx.model = model;
    await h.command("on");
    expect(h.request({ model: openai.id })).toBeUndefined();
    expect(h.ctx.ui.setStatus).toHaveBeenLastCalledWith(FAST_STATUS_ID, "Fast (N/A)");
    expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("当前模型不支持"), "warning");
    h.ctx.model = openai;
    h.emit("model_select");
    expect(h.ctx.ui.setStatus).toHaveBeenLastCalledWith(FAST_STATUS_ID, "Fast");
    expect(h.request({ model: openai.id })).toEqual({ model: openai.id, service_tier: "priority" });
  });

  it.each([null, undefined, [], "payload", 1, {}, { model: "different-model" }])("leaves unknown or mismatched payloads unchanged: %j", async (payload) => {
    const h = harness();
    await h.command("on");
    expect(h.request(payload)).toBeUndefined();
  });

  it("restores the latest valid current-branch state on reload/resume/fork and tree navigation", async () => {
    const h = harness([state(true), { type: "custom", customType: "another-extension", data: { enabled: false } }, state("false")]);
    h.emit("session_start");
    expect(h.request({ model: openai.id })).toHaveProperty("service_tier", "priority");
    // A replacement runtime reads the same persisted branch, without inheriting closures.
    const resumed = harness(h.branch);
    resumed.emit("session_start");
    expect(resumed.request({ model: openai.id })).toHaveProperty("service_tier", "priority");
    h.branch.push(state(false));
    h.emit("session_tree");
    expect(h.request({ model: openai.id })).toBeUndefined();
    h.branch.splice(0, h.branch.length, state(true));
    h.emit("session_tree");
    expect(h.request({ model: openai.id })).toHaveProperty("service_tier", "priority");
    h.branch.length = 0;
    h.emit("session_tree");
    expect(h.request({ model: openai.id })).toBeUndefined();
    expect(h.appendEntry).not.toHaveBeenCalled();
  });

  it("clears the footer on shutdown and keeps new sessions off", async () => {
    const h = harness();
    await h.command("on");
    h.emit("session_shutdown");
    expect(h.ctx.ui.setStatus).toHaveBeenLastCalledWith(FAST_STATUS_ID, undefined);
    expect(h.request({ model: openai.id })).toBeUndefined();
    const fresh = harness();
    fresh.emit("session_start");
    expect(fresh.request({ model: openai.id })).toBeUndefined();
  });

  it("works headlessly without calling UI or resolving credentials", async () => {
    const h = harness();
    h.ctx.hasUI = false;
    h.emit("session_start");
    await h.command("on");
    h.emit("model_select");
    expect(h.request({ model: openai.id })).toHaveProperty("service_tier", "priority");
    h.emit("session_shutdown");
    expect(h.ctx.ui.notify).not.toHaveBeenCalled();
    expect(h.ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(h.pi).not.toHaveProperty("modelRegistry");
  });
});
