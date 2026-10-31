/**
 * What the assistant is really doing right now, told to the person while they wait. The agent emits one of these before each
 * step; the web chat streams them (`/api/ai/chat`), so the indicator shows the real work instead of one fixed line.
 */
export type AgentProgress =
  /** The model is reading the question or, after tools ran, writing the answer. */
  | { step: 'think'; round: number }
  /** A tool is about to run. `detail` is a short, human fact about it: the search words or the site being read. */
  | { step: 'tool'; name: string; detail?: string };

/** A short detail worth showing for a tool call, taken from its already validated arguments. Never long, never a secret. */
export function progressDetail(name: string, args: unknown): string | undefined {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  if (name === 'search_web' && typeof a.query === 'string') return a.query.slice(0, 80);
  if (name === 'read_website' && typeof a.url === 'string') {
    try {
      return new URL(a.url).hostname.replace(/^www\./, '').slice(0, 80);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
