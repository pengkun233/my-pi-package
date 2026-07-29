import type { MemoryScope } from "./core.ts";

export function singularScope(value: "global" | "project" | "all" | undefined, action: string): MemoryScope {
	if (value === "all") throw new Error(`scope=all is not valid for action=${action}; choose global or project`);
	return value === "global" ? "global" : "project";
}

export function parseRememberArgs(args: string): { scope: MemoryScope; text: string } {
	const trimmed = args.trim();
	const globalMatch = trimmed.match(/^--global(?:\s+|$)/);
	if (!globalMatch) return { scope: "project", text: trimmed };
	return { scope: "global", text: trimmed.slice(globalMatch[0].length).trim() };
}
