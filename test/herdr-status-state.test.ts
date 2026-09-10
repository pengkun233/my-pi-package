import { describe, expect, it } from "vitest";
import { MARK_ICONS, nextMark, subagentLabel } from "../extensions/herdr-status/state.js";

describe("Herdr sidebar task marks", () => {
  it("uses icons only before pi", () => {
    expect(Object.values(MARK_ICONS).map((icon) => `${icon} pi`)).toEqual(["🚀 pi", "💤 pi", "📖 pi"]);
  });

  it("leaves work for review, then cycles review and sleep", () => {
    expect(nextMark("working")).toBe("review");
    expect(nextMark("review")).toBe("sleeping");
    expect(nextMark("sleeping")).toBe("review");
  });

  it("formats only positive running counts with correct plurals", () => {
    expect(subagentLabel(1)).toBe("🤖 1 subagent running");
    expect(subagentLabel(2)).toBe("🤖 2 subagents running");
    for (const count of [0, -1, 1.5, NaN, Infinity]) expect(subagentLabel(count)).toBe("");
  });
});
