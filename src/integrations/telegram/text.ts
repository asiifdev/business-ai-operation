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
