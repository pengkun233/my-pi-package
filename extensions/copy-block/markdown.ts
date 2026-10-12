export interface CopyBlock {
  label: string;
  kind: "whole" | "section" | "code" | "quote";
  start: number;
  end: number;
}

interface Line { text: string; start: number; end: number }
function lines(source: string): Line[] {
  const result: Line[] = [];
  const re = /[^\n]*\n|[^\n]+$/g;
  for (const match of source.matchAll(re)) {
    result.push({ text: match[0].replace(/\r?\n$/, ""), start: match.index!, end: match.index! + match[0].length });
  }
  return result;
}

/** Ranges always point into the original source, never into rendered Markdown. */
export function markdownBlocks(source: string): CopyBlock[] {
  const result: CopyBlock[] = [{ kind: "whole", label: "Whole response (Markdown)", start: 0, end: source.length }];
  const rows = lines(source);
  const headings: { index: number; level: number; label: string }[] = [];
  let code = 0, quote = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(row.text);
    if (fence && !(fence[2][0] === "`" && fence[3].includes("`"))) {
      const marker = fence[2][0], length = fence[2].length;
      let j = i + 1;
      const closing = new RegExp("^ {0,3}" + marker + "{" + length + ",}[ \\t]*$");
      while (j < rows.length && !closing.test(rows[j].text)) j++;
      result.push({ kind: "code", label: `Code ${++code} ${fence[3].trim()}`.trim(), start: row.end, end: j < rows.length ? rows[j].start : source.length });
      i = j;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(row.text);
    if (heading) headings.push({ index: i, level: heading[1].length, label: heading[2] });
    else if (i + 1 < rows.length && row.text.trim() && /^ {0,3}(=+|-+)[ \t]*$/.test(rows[i + 1].text)) {
      headings.push({ index: i, level: rows[i + 1].text.trim()[0] === "=" ? 1 : 2, label: row.text.trim() });
      i++;
    }
    if (/^ {0,3}>/.test(row.text)) {
      let j = i + 1;
      while (j < rows.length && /^ {0,3}>/.test(rows[j].text)) j++;
      result.push({ kind: "quote", label: `Quote ${++quote} (Markdown)`, start: row.start, end: rows[j - 1].end });
      i = j - 1;
    }
  }
  for (let h = 0; h < headings.length; h++) {
    const heading = headings[h];
    const next = headings.slice(h + 1).find((candidate) => candidate.level <= heading.level);
    result.push({ kind: "section", label: `Section: ${heading.label}`, start: rows[heading.index].start, end: next ? rows[next.index].start : source.length });
  }
  return [result[0], ...result.slice(1).sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind))];
}
