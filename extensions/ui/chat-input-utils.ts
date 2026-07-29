// Adapted from adrianapan/pikit's MIT-licensed chat-input extension.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ChatInputConfig } from "./chat-input-config.js";
import {
  BLINK_ART,
  BLINK_MAX_DURATION_MS,
  BLINK_MIN_DURATION_MS,
  COMPANION_ARTS,
  DIP_INTERVAL_MS,
  DIR_STEPS_MAX,
  DIR_STEPS_MIN,
  DOUBLE_BLINK_GAP_MAX_MS,
  DOUBLE_BLINK_GAP_MIN_MS,
  EARS_MAX_DURATION_MS,
  EARS_MIN_DURATION_MS,
  EARS_TO_FULL_CHANCE,
  EARS_TO_NONE_CHANCE,
  EDGE_BIAS_STRENGTH,
  EDGE_PAUSE_MAX_MS,
  EDGE_PAUSE_MIN_MS,
  EXPR_BLINK_CHANCE,
  EXPR_DOUBLE_BLINK_CHANCE,
  EXPR_MAX_DURATION_MS,
  EXPR_MIN_DURATION_MS,
  FACE_DRIFT_MAX_INTERVAL_MS,
  FACE_DRIFT_MIN_INTERVAL_MS,
  FACE_DRIFT_RANGE,
  FACE_MAX_DURATION_MS,
  FACE_MIN_DURATION_MS,
  FULL_MAX_DURATION_MS,
  FULL_MIN_DURATION_MS,
  FULL_TO_EARS_CHANCE,
  FULL_TO_NONE_CHANCE,
  NONE_MAX_DURATION_MS,
  NONE_MIN_DURATION_MS,
  RISE_INTERVAL_MS,
  SLOW_TRANSITION_CHANCE,
  SLOW_TRANSITION_MULT_MAX,
  SLOW_TRANSITION_MULT_MIN,
  STARE_CHANCE,
  STARE_MAX_DURATION_MS,
  STARE_MIN_DURATION_MS,
  WOBBLE_MAX_INTERVAL_MS,
  WOBBLE_MIN_INTERVAL_MS,
  WOBBLE_RANGE,
} from "./chat-input-config.js";

const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\[0?m/g;
export const plainText = (line: string): string => line.replace(ANSI_RE, "");

function isHexColor(color: string): boolean {
  return color.startsWith("#");
}

function hexToAnsi(hex: string): string {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return "";
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `\x1b[38;2;${red};${green};${blue}m`;
}

export function applyColor(theme: Theme, color: string, text: string): string {
  if (isHexColor(color)) return `${hexToAnsi(color)}${text}\x1b[0m`;
  return theme.fg(color as ThemeColor, text);
}

export interface BoxColors {
  border(text: string): string;
  accent(text: string): string;
}

export interface InputStyles {
  normal: BoxColors;
  bash: BoxColors;
}

export function selectInputStyle(
  config: Readonly<ChatInputConfig>,
  styles: InputStyles,
  bash: boolean,
): { colors: BoxColors; prefix: string } {
  return { colors: bash ? styles.bash : styles.normal, prefix: config.prefix };
}

function scrollText(line: string): string | undefined {
  const plain = plainText(line);
  if (!plain.startsWith("─")) return undefined;
  return plain.match(/((?:↑|↓)\s*\d+\s*more)/)?.[1];
}

function borderLike(line: string): boolean {
  const plain = plainText(line);
  return plain.replace(/─/g, "").length === 0 || scrollText(line) !== undefined;
}

function borderLine(
  width: number,
  colors: BoxColors,
  boxed: boolean,
  top: boolean,
  indicator?: string,
): string {
  const available = boxed ? width - 2 : width;
  const middle = indicator ? `── ${indicator} ` : "";
  const rule = middle + "─".repeat(Math.max(0, available - visibleWidth(middle)));
  if (!boxed) return colors.border(rule);
  return colors.border(top ? "┌" : "└") + colors.border(rule) + colors.border(top ? "┐" : "┘");
}

export function chatInputContentWidth(
  width: number,
  prefix: string,
  config: Readonly<ChatInputConfig>,
): number {
  const prefixWidth = Math.max(1, visibleWidth(prefix));
  return config.boxedView
    ? width - 2 - config.boxPadX * 3 - prefixWidth
    : width - config.boxPadX * 2 - prefixWidth;
}

export function canRenderChatInput(
  stock: string[],
  width: number,
  prefix: string,
  config: Readonly<ChatInputConfig>,
): boolean {
  const padMultiplier = config.boxedView ? 3 : 1;
  if (width < 5 + config.boxPadX * padMultiplier || stock.length < 2) return false;
  if (chatInputContentWidth(width, prefix, config) < 1) return false;
  const available = config.boxedView ? width - 2 : width;
  return stock.every((line) => {
    const indicator = scrollText(line);
    return !indicator || visibleWidth(`── ${indicator} `) <= available;
  });
}

/** Decorate the stock CustomEditor output with the upstream boxed or unboxed layout. */
export function renderChatInputLines(
  stock: string[],
  width: number,
  prefix: string,
  colors: BoxColors,
  config: Readonly<ChatInputConfig>,
  companionLines: string[] = [],
): string[] {
  if (!canRenderChatInput(stock, width, prefix, config)) return stock;

  const contentWidth = chatInputContentWidth(width, prefix, config);
  const prefixWidth = Math.max(1, visibleWidth(prefix));
  const first = stock.findIndex(borderLike);
  let last = -1;
  for (let index = stock.length - 1; index >= 0; index--) {
    if (borderLike(stock[index]!)) {
      last = index;
      break;
    }
  }

  const top = borderLine(width, colors, config.boxedView, true, first >= 0 ? scrollText(stock[first]!) : undefined);
  const bottom = borderLine(
    width,
    colors,
    config.boxedView,
    false,
    last >= 0 && last !== first ? scrollText(stock[last]!) : undefined,
  );

  const leftPad = " ".repeat(config.boxPadX);
  const body: string[] = [];
  let firstBody = true;
  for (let index = 0; index < stock.length; index++) {
    if (index === first || index === last) continue;
    if (last >= 0 && index > last) continue;
    const line = stock[index]!;
    const linePadding = " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));
    const marker = firstBody
      ? colors.accent(prefix) + " ".repeat(Math.max(0, prefixWidth - visibleWidth(prefix)))
      : " ".repeat(prefixWidth);
    if (config.boxedView) {
      body.push(`${colors.border("│")}${leftPad}${marker}${leftPad}${line}${linePadding}${leftPad}${colors.border("│")}`);
    } else {
      body.push(`${leftPad}${marker}${leftPad}${line}${linePadding}`);
    }
    firstBody = false;
  }

  const menu: string[] = [];
  if (last >= 0) {
    for (let index = last + 1; index < stock.length; index++) {
      const line = stock[index]!;
      const indent = " ".repeat(config.extraMenuIndent);
      const padding = " ".repeat(Math.max(0, width - visibleWidth(line) - config.extraMenuIndent));
      menu.push(indent + line + padding);
    }
  }
  const gap = Array.from({ length: config.menuGap }, () => "");
  return [...companionLines, top, ...body, bottom, ...gap, ...menu];
}

/** Compatibility helper retained for callers of the previous simplified renderer. */
export function boxEditorLines(stock: string[], width: number, prefix: string, colors: BoxColors): string[] {
  return renderChatInputLines(stock, width, prefix, colors, {
    boxedView: true,
    boxPadX: 1,
    menuGap: 0,
    extraMenuIndent: 1,
    borderColor: "border",
    prefix: "❯",
    prefixColor: "accent",
    companion: { enabled: true, color: "accent" },
    companionTopPadding: 3,
  });
}

export interface CompanionState {
  lines: string[];
  extraPad: number;
}

type Phase = "face" | "ears" | "full" | "none";
const TICK_MS = 100;
const randomBetween = (min: number, max: number): number => min + Math.random() * (max - min);

export class CompanionAnimator {
  private phase: Phase = "face";
  private phaseEntered = 0;
  private phaseDuration = 0;
  private exprIdx = 0;
  private lastExprChange = 0;
  private exprDuration = 0;
  private isBlinking = false;
  private blinkUntil = 0;
  private doubleBlinkPending = false;
  private doubleBlinkGap = false;
  private gapUntil = 0;
  private offset = 0;
  private lastOffsetChange = 0;
  private wobbleInterval = 0;
  private dirDelta = 0;
  private dirSteps = 0;
  private edgePauseUntil = 0;
  private lastFaceDrift = 0;
  private faceDriftInterval = 0;
  private transitionFromLines = 2;
  private transitionRemaining = 0;
  private transitionTotal = 0;

  tick(now: number): void {
    if (this.phaseEntered === 0) {
      this.phaseEntered = now;
      this.phaseDuration = randomBetween(FACE_MIN_DURATION_MS, FACE_MAX_DURATION_MS);
      this.exprIdx = this.pickNextExpr();
      this.lastExprChange = now;
      this.exprDuration = this.randExprDuration();
      this.lastFaceDrift = now;
      this.faceDriftInterval = randomBetween(FACE_DRIFT_MIN_INTERVAL_MS, FACE_DRIFT_MAX_INTERVAL_MS);
      return;
    }
    if (this.transitionRemaining > 0) this.transitionRemaining--;
    const elapsed = now - this.phaseEntered;
    if (this.phase === "face" || this.phase === "full") this.tickExpression(now);
    switch (this.phase) {
      case "face": this.tickFace(now, elapsed); break;
      case "ears": this.tickEars(now, elapsed); break;
      case "full": this.tickFull(now, elapsed); break;
      case "none": this.tickNone(elapsed); break;
    }
  }

  private tickExpression(now: number): void {
    if (this.doubleBlinkGap && now >= this.gapUntil) {
      this.doubleBlinkGap = false;
      this.isBlinking = true;
      this.blinkUntil = now + randomBetween(BLINK_MIN_DURATION_MS, BLINK_MAX_DURATION_MS);
      return;
    }
    if (this.isBlinking && now >= this.blinkUntil) {
      this.isBlinking = false;
      if (this.doubleBlinkPending) {
        this.doubleBlinkPending = false;
        this.doubleBlinkGap = true;
        this.gapUntil = now + randomBetween(DOUBLE_BLINK_GAP_MIN_MS, DOUBLE_BLINK_GAP_MAX_MS);
      } else {
        this.exprIdx = this.pickNextExpr();
        this.exprDuration = this.randExprDuration();
        this.lastExprChange = now;
      }
      return;
    }
    if (!this.isBlinking && !this.doubleBlinkGap && now - this.lastExprChange >= this.exprDuration) {
      const roll = Math.random();
      this.lastExprChange = now;
      if (roll < EXPR_BLINK_CHANCE) {
        this.isBlinking = true;
        this.blinkUntil = now + randomBetween(BLINK_MIN_DURATION_MS, BLINK_MAX_DURATION_MS);
      } else if (roll < EXPR_BLINK_CHANCE + EXPR_DOUBLE_BLINK_CHANCE) {
        this.isBlinking = true;
        this.blinkUntil = now + randomBetween(BLINK_MIN_DURATION_MS, BLINK_MAX_DURATION_MS);
        this.doubleBlinkPending = true;
      } else {
        this.exprIdx = this.pickNextExpr();
        this.exprDuration = this.randExprDuration();
      }
    }
  }

  private tickFace(now: number, elapsed: number): void {
    if (now - this.lastFaceDrift >= this.faceDriftInterval) {
      const delta = Math.random() < 0.5 ? -1 : 1;
      this.offset = Math.max(-FACE_DRIFT_RANGE, Math.min(FACE_DRIFT_RANGE, this.offset + delta));
      this.lastFaceDrift = now;
      this.faceDriftInterval = randomBetween(FACE_DRIFT_MIN_INTERVAL_MS, FACE_DRIFT_MAX_INTERVAL_MS);
    }
    if (elapsed < this.phaseDuration) return;
    const roll = Math.random();
    if (roll < TICK_MS / DIP_INTERVAL_MS) this.enterEars(now);
    else if (roll < TICK_MS / DIP_INTERVAL_MS + TICK_MS / RISE_INTERVAL_MS) this.enterFull(now);
  }

  private tickEars(now: number, elapsed: number): void {
    if (now < this.edgePauseUntil) {
      if (elapsed >= this.phaseDuration) this.finishEars(now);
      return;
    }
    if (now - this.lastOffsetChange >= this.wobbleInterval) {
      if (this.dirSteps <= 0) this.startRun();
      const next = this.offset + this.dirDelta;
      if (next > WOBBLE_RANGE || next < -WOBBLE_RANGE) {
        this.offset = this.dirDelta > 0 ? WOBBLE_RANGE : -WOBBLE_RANGE;
        this.edgePauseUntil = now + randomBetween(EDGE_PAUSE_MIN_MS, EDGE_PAUSE_MAX_MS);
        this.dirSteps = 0;
      } else {
        this.offset = next;
        this.dirSteps--;
      }
      this.lastOffsetChange = now;
      this.wobbleInterval = randomBetween(WOBBLE_MIN_INTERVAL_MS, WOBBLE_MAX_INTERVAL_MS);
    }
    if (elapsed >= this.phaseDuration) this.finishEars(now);
  }

  private startRun(): void {
    if (this.offset >= WOBBLE_RANGE) this.dirDelta = -1;
    else if (this.offset <= -WOBBLE_RANGE) this.dirDelta = 1;
    else {
      const awayChance = 0.5 + Math.abs(this.offset) / WOBBLE_RANGE * EDGE_BIAS_STRENGTH;
      if (Math.random() < awayChance) this.dirDelta = this.offset > 0 ? -1 : 1;
      else this.dirDelta = this.offset > 0 ? 1 : -1;
    }
    this.dirSteps = DIR_STEPS_MIN + Math.floor(Math.random() * (DIR_STEPS_MAX - DIR_STEPS_MIN + 1));
  }

  private finishEars(now: number): void {
    const roll = Math.random();
    if (roll < EARS_TO_NONE_CHANCE) this.enterNone(now);
    else if (roll < EARS_TO_NONE_CHANCE + EARS_TO_FULL_CHANCE) this.enterFull(now);
    else this.enterFace(now);
  }

  private tickFull(now: number, elapsed: number): void {
    if (elapsed < this.phaseDuration) return;
    const roll = Math.random();
    if (roll < FULL_TO_EARS_CHANCE) this.enterEars(now);
    else if (roll < FULL_TO_EARS_CHANCE + FULL_TO_NONE_CHANCE) this.enterNone(now);
    else this.enterFace(now);
  }

  private tickNone(elapsed: number): void {
    if (elapsed >= this.phaseDuration) this.enterFace(Date.now());
  }

  private enterEars(now: number): void {
    this.switchPhase("ears", now);
    this.phaseDuration = randomBetween(EARS_MIN_DURATION_MS, EARS_MAX_DURATION_MS);
    this.lastOffsetChange = now;
    this.wobbleInterval = randomBetween(WOBBLE_MIN_INTERVAL_MS, WOBBLE_MAX_INTERVAL_MS);
    this.dirSteps = 0;
    this.edgePauseUntil = 0;
  }

  private enterFull(now: number): void {
    this.switchPhase("full", now);
    this.phaseDuration = randomBetween(FULL_MIN_DURATION_MS, FULL_MAX_DURATION_MS);
  }

  private enterFace(now: number): void {
    this.switchPhase("face", now);
    this.phaseDuration = randomBetween(FACE_MIN_DURATION_MS, FACE_MAX_DURATION_MS);
    this.lastFaceDrift = now;
    this.faceDriftInterval = randomBetween(FACE_DRIFT_MIN_INTERVAL_MS, FACE_DRIFT_MAX_INTERVAL_MS);
  }

  private enterNone(now: number): void {
    this.switchPhase("none", now);
    this.phaseDuration = randomBetween(NONE_MIN_DURATION_MS, NONE_MAX_DURATION_MS);
  }

  private switchPhase(phase: Phase, now: number): void {
    this.transitionFromLines = this.visibleLineCount();
    this.phase = phase;
    this.phaseEntered = now;
    const difference = Math.abs(this.visibleLineCount() - this.transitionFromLines);
    const slow = difference > 0 && Math.random() < SLOW_TRANSITION_CHANCE;
    const multiplier = slow
      ? SLOW_TRANSITION_MULT_MIN + Math.floor(Math.random() * (SLOW_TRANSITION_MULT_MAX - SLOW_TRANSITION_MULT_MIN + 1))
      : 1;
    this.transitionRemaining = difference * multiplier;
    this.transitionTotal = this.transitionRemaining;
  }

  private visibleLineCount(): number {
    switch (this.phase) {
      case "none": return 0;
      case "ears": return 1;
      case "face": return 2;
      case "full": return 3;
    }
  }

  private pickNextExpr(): number {
    if (COMPANION_ARTS.length <= 1) return 0;
    let next: number;
    do next = Math.floor(Math.random() * COMPANION_ARTS.length);
    while (next === this.exprIdx);
    return next;
  }

  private randExprDuration(): number {
    return Math.random() < STARE_CHANCE
      ? randomBetween(STARE_MIN_DURATION_MS, STARE_MAX_DURATION_MS)
      : randomBetween(EXPR_MIN_DURATION_MS, EXPR_MAX_DURATION_MS);
  }

  getState(): CompanionState {
    const art = COMPANION_ARTS[this.exprIdx]!;
    const targetLines = this.visibleLineCount();
    let lineCount = targetLines;
    if (this.transitionRemaining > 0 && this.transitionTotal > 0) {
      const progress = 1 - this.transitionRemaining / this.transitionTotal;
      lineCount = Math.round(this.transitionFromLines + progress * (targetLines - this.transitionFromLines));
    }
    const blink = this.isBlinking && !this.doubleBlinkGap && (this.phase === "face" || this.phase === "full");
    const lines: string[] = [];
    if (lineCount >= 1) lines.push(art[0]);
    if (lineCount >= 2) lines.push(blink ? BLINK_ART[1] : art[1]);
    if (lineCount >= 3) lines.push(blink ? BLINK_ART[2] : art[2]);
    return { lines, extraPad: this.offset };
  }
}
