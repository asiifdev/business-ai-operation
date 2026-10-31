import { useEffect, useRef, useState } from 'react';
import type { AssistantReply } from '../../ai/assistant';
import { useLocale, useT } from '../../lib/use-t';
import type { Chip } from './attachments';

export type Turn =
  | { id: number; kind: 'user'; text: string; at?: string; attachments?: Chip[] }
  | { id: number; kind: 'assistant'; reply: AssistantReply; at?: string }
  | { id: number; kind: 'error'; text: string; retry: string; attachments?: Chip[] };

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export const MAX_LENGTH = 2000;
/** Which conversation is open in this tab: the side panel and the full page both carry on with it. The words live on the server (D-078). */
const CURRENT = 'orbyte.assistant.session';
/** Fired by `askAssistant`; the app shell opens the side panel and asks. */
export const ASK_EVENT = 'orbyte:ask';

/** Set on the page by the assistant panel while it is mounted, so a form knows whether there is an assistant to ask. */
export const assistantAvailable = () => typeof document !== 'undefined' && document.documentElement.dataset.assistant === 'on';

/** Open the assistant from anywhere in the app, optionally with a question to ask right away. */
export function askAssistant(question?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<{ question?: string }>(ASK_EVENT, { detail: { question } }));
}

function readCurrent(): string | null {
  try {
    return sessionStorage.getItem(CURRENT);
  } catch {
    return null;
  }
}

function storeCurrent(id: string | null) {
  try {
    if (id) sessionStorage.setItem(CURRENT, id);
    else sessionStorage.removeItem(CURRENT);
  } catch {
    /* Storage can be blocked; the conversation is still kept on the server and in the history. */
  }
}

type StoredMessage = { seq: number; kind: 'user' | 'assistant' | 'error'; body: unknown; createdAt: string };

/** What the server stored, as the turns the conversation shows. */
function toTurns(messages: StoredMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.kind === 'user') {
      const body = m.body as { text?: string; attachments?: Array<{ id: string; name: string; kind: string }> };
      turns.push({ id: m.seq, kind: 'user', text: body.text ?? '', at: m.createdAt, attachments: body.attachments?.map((a) => ({ key: a.id, id: a.id, name: a.name, kind: a.kind, status: 'ready' as const })) });
    }
    else if (m.kind === 'assistant') turns.push({ id: m.seq, kind: 'assistant', reply: m.body as AssistantReply, at: m.createdAt });
  }
  return turns;
}

async function call<T>(method: 'GET' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    return res.ok && json?.ok ? (json.data as T) : null;
  } catch {
    return null;
  }
}

/**
 * The conversation with the assistant: its turns, the open session and the call to `/api/ai/chat`. Every answer comes from
 * the server, which only answers about the organization (D-049) and keeps the conversation for its owner (D-078); this hook
 * carries the words back and forth and lists, opens, renames and deletes the person's earlier conversations.
 */
export function useAssistant() {
  const t = useT();
  const locale = useLocale();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const busyRef = useRef(false);
  const turnsRef = useRef<Turn[]>([]);
  const sessionRef = useRef<string | null>(null);

  function setTurnsNow(next: Turn[]) {
    turnsRef.current = next;
    setTurns(next);
  }

  function setSession(id: string | null) {
    sessionRef.current = id;
    setSessionId(id);
    storeCurrent(id);
  }

  async function open(id: string): Promise<boolean> {
    setOpening(true);
    const data = await call<{ id: string; title: string; messages: StoredMessage[] }>('GET', `/api/assistant/sessions/${id}`);
    setOpening(false);
    if (!data) return false;
    setTurnsNow(toTurns(data.messages));
    setSession(data.id);
    setTitle(data.title);
    return true;
  }

  // Read after hydration so the server and the first browser render agree; the open conversation is fetched, not guessed.
  useEffect(() => {
    const id = readCurrent();
    if (id) void open(id).then((ok) => ok || setSession(null));
  }, []);

  const nextId = () => turnsRef.current.reduce((max, turn) => Math.max(max, turn.id), 0) + 1;

  async function ask(raw: string, history: Turn[] = turnsRef.current, attachments: Chip[] = []) {
    const question = raw.trim().slice(0, MAX_LENGTH);
    if (!question || busyRef.current) return;
    const withQuestion: Turn[] = [...history, { id: nextId(), kind: 'user', text: question, at: new Date().toISOString(), ...(attachments.length ? { attachments } : {}) }];
    setTurnsNow(withQuestion);
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
      const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ messages, locale, sessionId: sessionRef.current ?? undefined, attachmentIds: attachments.flatMap((a) => (a.id ? [a.id] : [])) }) });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        const { sessionId: saved, ...reply } = body.data as AssistantReply & { sessionId?: string };
        setTurnsNow([...withQuestion, { id: nextId(), kind: 'assistant', reply: reply as AssistantReply, at: new Date().toISOString() }]);
        if (saved) {
          // A conversation that just began is titled after its first question, as the server does.
          if (saved !== sessionRef.current) setTitle(question.replace(/\s+/g, ' ').trim().slice(0, 80));
          setSession(saved);
        }
        setSessions(null); // the list is stale now: it is fetched again when it is next opened
      } else setTurnsNow([...withQuestion, { id: nextId(), kind: 'error', text: res.status === 429 ? t('rateLimited') : t('genericError'), retry: question, attachments }]);
    } catch {
      setTurnsNow([...withQuestion, { id: nextId(), kind: 'error', text: t('genericError'), retry: question, attachments }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** Ask the failed question again, dropping the error and the question it answered. */
  function retry(turn: Extract<Turn, { kind: 'error' }>) {
    const history = turnsRef.current.filter((x) => x.id !== turn.id).slice(0, -1);
    void ask(turn.retry, history, turn.attachments ?? []);
  }

  /** Ask the last question again as a new turn, keeping the earlier answer in the conversation. */
  function askAgain(question: string) {
    void ask(question);
  }

  async function loadSessions(q = '') {
    const data = await call<{ sessions: SessionSummary[] }>('GET', `/api/assistant/sessions${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
    setSessions(data?.sessions ?? []);
  }

  async function rename(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (!(await call('PATCH', `/api/assistant/sessions/${id}`, { title: trimmed }))) return;
    if (sessionRef.current === id) setTitle(trimmed);
    setSessions((list) => list?.map((s) => (s.id === id ? { ...s, title: trimmed } : s)) ?? null);
  }

  async function remove(id: string) {
    if (!(await call('DELETE', `/api/assistant/sessions/${id}`))) return;
    setSessions((list) => list?.filter((s) => s.id !== id) ?? null);
    if (sessionRef.current === id) newChat();
  }

  function newChat() {
    setTurnsNow([]);
    setSession(null);
    setTitle(null);
  }

  return {
    turns,
    busy,
    opening,
    sessionId,
    title,
    sessions,
    ask: (q: string, attachments?: Chip[]) => void ask(q, undefined, attachments),
    askAgain,
    retry,
    newChat,
    clear: newChat,
    open,
    loadSessions,
    rename,
    remove,
  };
}
