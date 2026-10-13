import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { markdownBlocks, type CopyBlock } from "./markdown.js";

export interface HistoryMessage {
  role: "user" | "assistant";
  source: string;
}

/** Only persisted main-branch message text, in chronological order. */
export function copyHistory(entries: SessionEntry[]): HistoryMessage[] {
  return entries.flatMap((entry): HistoryMessage[] => {
    if (entry.type !== "message") return [];
    const message = entry.message;
    if (message.role !== "user" && message.role !== "assistant") return [];
    if (message.role === "assistant" && message.stopReason !== "stop" &&
      message.stopReason !== "length" && message.stopReason !== "toolUse") return [];
    const source = typeof message.content === "string" ? message.content :
      message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    return source ? [{ role: message.role, source }] : [];
  });
}

/** Scanning is lazy: visiting one message never scans the rest of the branch. */
export class CopyHistory {
  private readonly cache = new Map<number, CopyBlock[]>();
  readonly initialIndex: number;
  constructor(readonly messages: HistoryMessage[]) {
    let index = messages.length - 1;
    for (let i = index; i >= 0; i--) {
      if (messages[i].role === "assistant") { index = i; break; }
    }
    this.initialIndex = index;
  }
  blocks(index: number): CopyBlock[] {
    let blocks = this.cache.get(index);
    if (!blocks) {
      const message = this.messages[index];
      blocks = message.role === "assistant" ? markdownBlocks(message.source) :
        [{ kind: "whole", label: "Whole user message (text)", start: 0, end: message.source.length }];
      this.cache.set(index, blocks);
    }
    return blocks;
  }
}
