import type { Clock } from '../../lib/clock';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_MESSAGES = 6;
const MAX_CONTENT = 1500;
const TTL_MS = 30 * 60_000;

/**
 * The last few turns of each person's Telegram conversation, so a follow-up question has its context. Kept in memory
 * only and forgotten after 30 minutes without a message: the words people type are not stored (BR-M15-06), so a restart
 * simply starts a fresh conversation.
 */
export class ChatHistory {
  private readonly byUser = new Map<string, { at: number; messages: HistoryMessage[] }>();

  constructor(private readonly clock: Clock) {}

  /** What came before, oldest first. Empty when the conversation went quiet. */
  recent(userId: string): HistoryMessage[] {
    const entry = this.byUser.get(userId);
    if (!entry) return [];
    if (this.clock.now().getTime() - entry.at > TTL_MS) {
      this.byUser.delete(userId);
      return [];
    }
    return [...entry.messages];
  }

  /** Adds one finished exchange and keeps only the latest turns, always starting with the person's message. */
  remember(userId: string, question: string, answer: string): void {
    const messages = [...this.recent(userId), { role: 'user' as const, content: question.slice(0, MAX_CONTENT) }, { role: 'assistant' as const, content: answer.slice(0, MAX_CONTENT) }].slice(-MAX_MESSAGES);
    this.byUser.set(userId, { at: this.clock.now().getTime(), messages });
  }

  forget(userId: string): void {
    this.byUser.delete(userId);
  }
}
