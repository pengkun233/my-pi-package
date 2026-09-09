import { describe, expect, it } from "vitest";
import { MARK_ICONS, nextMark, restoreMark, STATE_ENTRY, subagentLabel } from "../extensions/herdr-status/state.js";

describe("Herdr sidebar task marks", () => {
  it("uses icons only before pi", () => {
    expect(Object.values(MARK_ICONS).map((icon) => `${icon} pi`)).toEqual(["🚀 pi", "💤 pi", "📖 pi"]);
  });

  it("leaves work for sleep, then cycles sleep and review", () => {
    expect(nextMark("working")).toBe("sleeping");
    expect(nextMark("sleeping")).toBe("review");
    expect(nextMark("review")).toBe("sleeping");
  });

  it("formats only positive running counts with correct plurals", () => {
    expect(subagentLabel(1)).toBe("🤖 1 subagent running");
    expect(subagentLabel(2)).toBe("🤖 2 subagents running");
    for (const count of [0, -1, 1.5, NaN, Infinity]) expect(subagentLabel(count)).toBe("");
  });

  it("restores the last valid session mark without interpreting conversation content", () => {
    expect(restoreMark([])).toBe("sleeping");
    expect(restoreMark([
      { type: "custom", customType: STATE_ENTRY, data: { mark: "working" } },
      { type: "custom", customType: STATE_ENTRY, data: { mark: "review" } },
      { type: "custom", customType: "other", data: { mark: "sleeping" } },
      { type: "custom", customType: STATE_ENTRY, data: { mark: "bad" } },
      { type: "custom", customType: STATE_ENTRY, data: null },
      { type: "message" },
    ])).toBe("review");
  });
});
