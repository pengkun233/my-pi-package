import { describe, expect, it, vi } from "vitest";
import { installHeader } from "../extensions/ui/startup/index.js";

describe("startup adapter", () => {
  it("is TUI-only and exposes a renderable header factory", () => {
    const noUi = { hasUI: false, mode: "print", ui: { setHeader: vi.fn() } } as any;
    installHeader(noUi);
    expect(noUi.ui.setHeader).not.toHaveBeenCalled();

    let factory: any;
    const tui = { hasUI: true, mode: "tui", ui: { setHeader: (value: any) => { factory = value; } } } as any;
    installHeader(tui);
    expect(factory).toBeTypeOf("function");
    const component = factory({}, { fg: (_token: string, text: string) => text });
    expect(component.render(82).join("\n")).toContain("Personal UI loaded");
  });
});
