export const VERBS = ["Thinking", "Reasoning", "Working", "Exploring", "Composing"] as const;
export function pickVerb(previous?: string): string {
  const choices = VERBS.filter((verb) => verb !== previous);
  return choices[Math.floor(Math.random() * choices.length)] ?? VERBS[0];
}
