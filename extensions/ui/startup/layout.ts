import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export interface StartupKeys { model: string; thinking: string; version?: string }

const PI_ART = [
  "██████╗ ██╗",
  "██╔══██╗██║",
  "██████╔╝██║",
  "██╔═══╝ ██║",
  "╚═╝     ╚═╝",
];

function fit(text: string, width: number): string {
  const clipped = truncateToWidth(text, width);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function center(text: string, width: number): string {
  const clipped = truncateToWidth(text, width);
  const padding = Math.max(0, width - visibleWidth(clipped));
  return " ".repeat(Math.floor(padding / 2)) + clipped + " ".repeat(Math.ceil(padding / 2));
}

export function renderStartup(theme: Theme, termWidth: number, keys: StartupKeys): string[] {
  if (termWidth < 44) return [];
  const fg = (token: string, text: string) => {
    try { return theme.fg(token as any, text); } catch { return text; }
  };
  const inner = termWidth - 2;
  const tips = [
    ` ${fg("muted", "/")} commands`,
    ` ${fg("muted", "!")} run bash`,
    ` ${fg("muted", keys.model)} model`,
    ` ${fg("muted", keys.thinking)} thinking`,
  ];
  let rows: string[];
  if (termWidth >= 76) {
    const artWidth = 20;
    const statusWidth = 24;
    const tipsWidth = inner - artWidth - statusWidth;
    const art = ["", ...PI_ART.map((line) => center(fg("accent", line), artWidth))];
    const status = ["", center(fg("text", "Personal UI loaded"), statusWidth), ...Array(4).fill(" ".repeat(statusWidth))];
    const hints = ["", ...tips, ""];
    rows = Array.from({ length: 6 }, (_, index) =>
      fit(art[index] ?? "", artWidth) + fit(status[index] ?? "", statusWidth) + fit(hints[index] ?? "", tipsWidth));
  } else {
    rows = [
      "",
      ...PI_ART.map((line) => center(fg("accent", line), inner)),
      center(fg("text", "Personal UI loaded"), inner),
      "",
      ...tips.map((line) => fit(line, inner)),
    ];
  }
  const title = ` pi.dev agent${keys.version ? ` v${keys.version}` : ""} `;
  const titleWidth = Math.min(inner, visibleWidth(title));
  const top = fg("borderAccent", `┌${truncateToWidth(title, titleWidth)}${"─".repeat(Math.max(0, inner - titleWidth))}┐`);
  const bottom = fg("borderAccent", `└${"─".repeat(inner)}┘`);
  return [top, ...rows.map((row) => `${fg("borderAccent", "│")}${fit(row, inner)}${fg("borderAccent", "│")}`), bottom];
}
