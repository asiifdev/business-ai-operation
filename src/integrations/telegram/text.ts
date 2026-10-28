import { parseAnswer, type Block, type Run } from '../../lib/answer';

/** Telegram caps a message at 4096 characters and a caption at 1024. Stay a little under to leave room for markup. */
export const MAX_MESSAGE = 4000;
export const MAX_CAPTION = 1000;

/** Everything that is not a tag must be escaped in HTML parse mode: only `<`, `>` and `&` (Bot API, formatting options). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** For a value placed inside an attribute such as `<a href="…">`. */
export function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/**
 * Splits long text into parts that fit one message, preferring paragraph and line breaks. Plain text only: splitting
 * inside a tag would break the markup, so tag-bearing text must be kept short or chunked before it is formatted.
 */
export function chunkText(text: string, limit = MAX_MESSAGE): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}


const runHtml = (run: Run): string => (run.code ? `<code>${escapeHtml(run.text)}</code>` : run.bold ? `<b>${escapeHtml(run.text)}</b>` : escapeHtml(run.text));
const runsHtml = (runs: Run[]): string => runs.map(runHtml).join('');
const runsPlain = (runs: Run[]): string => runs.map((r) => r.text).join('');

function blockHtml(block: Block): string {
  return block.kind === 'p' ? runsHtml(block.runs) : block.items.map((item) => `• ${runsHtml(item)}`).join('\n');
}

/**
 * An assistant answer as Telegram HTML parts: the same subset the web renders (paragraphs, bullets, **bold**, `code`)
 * becomes `<b>`, `<code>` and "•" lines, and everything else stays escaped literal text. Parts are cut between blocks so a
 * tag is never split; a single block longer than a message falls back to plain text, chunked.
 */
export function answerToTelegramParts(text: string, limit = MAX_MESSAGE): string[] {
  const parts: string[] = [];
  let current = '';
  const flush = () => {
    if (current) parts.push(current);
    current = '';
  };
  for (const block of parseAnswer(text)) {
    const html = blockHtml(block);
    if (html.length > limit) {
      flush();
      const plain = block.kind === 'p' ? runsPlain(block.runs) : block.items.map((item) => `• ${runsPlain(item)}`).join('\n');
      for (const piece of chunkText(plain, limit)) parts.push(escapeHtml(piece));
    } else if (current && current.length + 2 + html.length > limit) {
      flush();
      current = html;
    } else {
      current = current ? `${current}\n\n${html}` : html;
    }
  }
  flush();
  return parts;
}
