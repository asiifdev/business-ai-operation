import { useEffect, useRef, useState } from 'react';
import type { AssistantReply } from '../../ai/assistant';
import { useLocale, useT } from '../../lib/use-t';

export type Turn =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; reply: AssistantReply }
  | { id: number; kind: 'error'; text: string; retry: string };

export const MAX_LENGTH = 2000;
/** The conversation follows the person from page to page in this tab (the side panel and the full page share it). */
const STORE = 'orbyte.assistant.thread';
/** Fired by `askAssistant`; the app shell opens the side panel and asks. */
export const ASK_EVENT = 'orbyte:ask';

/** Open the assistant from anywhere in the app, optionally with a question to ask right away. */
export function askAssistant(question?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<{ question?: string }>(ASK_EVENT, { detail: { question } }));
}

function readStored(): Turn[] {
  try {
    const raw = sessionStorage.getItem(STORE);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Turn[]) : [];
  } catch {
    return [];
  }
}

function store(turns: Turn[]) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-30)));
  } catch {
    /* Storage can be blocked; the conversation then lasts as long as the page. */
  }
}

/**
 * The conversation with the assistant: its turns, the pending question and the call to `/api/ai/chat`. Every answer comes
 * from the server, which only answers about the organization (D-049); this hook only carries the words back and forth.
 */
export function useAssistant() {
  const t = useT();
  const locale = useLocale();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const turnsRef = useRef<Turn[]>([]);

  // Read after hydration so the server and the first browser render agree.
  useEffect(() => {
    const stored = readStored();
    turnsRef.current = stored;
    setTurns(stored);
  }, []);

  function update(next: Turn[]) {
    turnsRef.current = next;
    setTurns(next);
    store(next);
  }

  const nextId = () => turnsRef.current.reduce((max, turn) => Math.max(max, turn.id), 0) + 1;

  async function ask(raw: string, history: Turn[] = turnsRef.current) {
    const question = raw.trim().slice(0, MAX_LENGTH);
    if (!question || busyRef.current) return;
    const withQuestion: Turn[] = [...history, { id: nextId(), kind: 'user', text: question }];
    update(withQuestion);
    busyRef.current = true;
    setBusy(true);
    const all: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const turn of withQuestion) {
      if (turn.kind === 'user') all.push({ role: 'user', content: turn.text });
      else if (turn.kind === 'assistant') {
        const text = turn.reply.text ?? turn.reply.message;
        if (text) all.push({ role: 'assistant', content: text });
      }
    }
    const messages = all.slice(-10);
    try {
      const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ messages, locale }) });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) update([...withQuestion, { id: nextId(), kind: 'assistant', reply: body.data as AssistantReply }]);
      else update([...withQuestion, { id: nextId(), kind: 'error', text: res.status === 429 ? t('rateLimited') : t('genericError'), retry: question }]);
    } catch {
      update([...withQuestion, { id: nextId(), kind: 'error', text: t('genericError'), retry: question }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** Ask the failed question again, dropping the error and the question it answered. */
  function retry(turn: Extract<Turn, { kind: 'error' }>) {
    const history = turnsRef.current.filter((x) => x.id !== turn.id).slice(0, -1);
    void ask(turn.retry, history);
  }

  return { turns, busy, ask: (q: string) => void ask(q), retry, clear: () => update([]) };
}
