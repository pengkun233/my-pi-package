import { describe, expect, it } from "vitest";
import { MARK_ICONS, nextMark, displayMark } from "../extensions/herdr-status/state.js";

describe("Herdr sidebar task marks", () => {
  it("uses icons only before pi", () => {
    expect(Object.values(MARK_ICONS).map((icon) => `${icon} pi`)).toEqual(["🚀 pi", "💤 pi", "📖 pi", "✅ pi"]);
  });

  it("leaves work for review, then cycles review and sleep", () => {
    expect(nextMark("working")).toBe("review");
    expect(nextMark("done")).toBe("review");
    expect(nextMark("review")).toBe("sleeping");
    expect(nextMark("sleeping")).toBe("review");
  });

  it("temporarily overrides every mark while any subagent is running", () => {
    for (const mark of ["working", "sleeping", "review", "done"] as const) {
      for (const count of [1, 2, 100]) expect(displayMark(mark, count)).toBe("🤖");
      for (const count of [0, -1, 1.5, NaN, Infinity]) {
        expect(displayMark(mark, count)).toBe(MARK_ICONS[mark]);
      }
    }
  });
});
