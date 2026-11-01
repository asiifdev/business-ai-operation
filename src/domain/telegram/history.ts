export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const MAX_MESSAGES = 6;
const MAX_CONTENT = 1500;

/** A Telegram conversation carries on while its last message is younger than this; after that a new one begins (D-092). */
export const TELEGRAM_QUIET_MS = 30 * 60_000;

const textOf = (body: unknown): string => {
  const text = (body as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text.trim() : '';
};

/**
 * The last few turns of a stored conversation (D-092), oldest first, as the model takes them. The conversation itself is
 * kept in `assistant_messages`, so a restart of the server no longer loses it. Errors and empty replies are left out, and
 * the history always starts with the person.
 */
export function toHistory(stored: ReadonlyArray<{ kind: string; body: unknown }>): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  for (const m of stored) {
    if (m.kind !== 'user' && m.kind !== 'assistant') continue;
    const content = textOf(m.body);
    if (content) messages.push({ role: m.kind, content: content.slice(0, MAX_CONTENT) });
  }
  const recent = messages.slice(-MAX_MESSAGES);
  while (recent[0]?.role === 'assistant') recent.shift();
  return recent;
}
