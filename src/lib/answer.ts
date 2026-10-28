/**
 * Turns an assistant answer into plain blocks the interface can render as text, with no HTML involved: paragraphs,
 * bullet lists and **bold** runs. Anything else stays literal text, so a model cannot inject markup (BR-M07-09).
 */
export type Run = { text: string; bold: boolean; code?: boolean };
export type Block = { kind: 'p'; runs: Run[] } | { kind: 'ul'; items: Run[][] };

export function parseRuns(line: string): Run[] {
  const runs: Run[] = [];
  // `code` spans are cut out first so a ** inside them stays literal; the rest is split on ** for bold.
  line.split(/(`[^`]+`)/).forEach((part) => {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) runs.push({ text: part.slice(1, -1), bold: false, code: true });
    else part.split('**').forEach((text, i) => text !== '' && runs.push({ text, bold: i % 2 === 1 }));
  });
  return runs;
}

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') continue;
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(parseRuns(bullet[1]));
      else blocks.push({ kind: 'ul', items: [parseRuns(bullet[1])] });
    } else {
      blocks.push({ kind: 'p', runs: parseRuns(line.trim()) });
    }
  }
  return blocks;
}
