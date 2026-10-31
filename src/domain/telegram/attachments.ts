/**
 * Files a person sent to the bot for the assistant to read (D-083): PDF, Word, Excel, PowerPoint, text, video, or a photo
 * sent with `/baca`. Each is read once into an assistant attachment; only its id is kept here, per chat and in memory like
 * the chat history. The ids stay usable for a few minutes so a follow-up question still has the file.
 */
const TTL_MS = 10 * 60_000;
/** Same as the web: at most this many wait for a question. */
const MAX_WAITING = 6;

export class PendingAttachments {
  private readonly byChat = new Map<number, { ids: string[]; at: number }>();

  private live(chatId: number, now: Date) {
    const entry = this.byChat.get(chatId);
    if (!entry) return null;
    if (now.getTime() - entry.at > TTL_MS) {
      this.byChat.delete(chatId);
      return null;
    }
    return entry;
  }

  /** Remembers an attachment id (the newest {@link MAX_WAITING} stay). Returns how many are kept now. */
  add(chatId: number, id: string, now: Date): number {
    for (const [chat, e] of this.byChat) if (now.getTime() - e.at > TTL_MS) this.byChat.delete(chat);
    const ids = [...(this.live(chatId, now)?.ids ?? []), id].slice(-MAX_WAITING);
    this.byChat.set(chatId, { ids, at: now.getTime() });
    return ids.length;
  }

  /** The ids of this chat that are still fresh; asking about them does not use them up. */
  ids(chatId: number, now: Date): string[] {
    return this.live(chatId, now)?.ids ?? [];
  }

  forget(chatId: number) {
    this.byChat.delete(chatId);
  }
}

export const pendingAttachments = new PendingAttachments();

/** A photo whose caption starts with `/baca` is to be read, not turned into a picture. Returns the words after it, or null. */
export function readCaption(caption: string | undefined): string | null {
  const m = /^\/(?:baca|read)(?:@\w+)?\b\s*([\s\S]*)$/i.exec(caption?.trim() ?? '');
  return m ? m[1].trim() : null;
}
