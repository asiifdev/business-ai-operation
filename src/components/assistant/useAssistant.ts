import type { AgentProgress } from '../../ai/progress';
import { readStream } from './read-stream';
import { useEffect, useSyncExternalStore } from 'react';
import type { AssistantReply } from '../../ai/assistant';
import { useLocale, useT } from '../../lib/use-t';
import type { MessageKey } from '../../lib/i18n';
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
/** How often another view of a conversation that is still being answered asks the server whether the answer arrived (D-090). */
const WATCH_MS = 1500;

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

interface State {
  turns: Turn[];
  busy: boolean;
  /** What the assistant is really doing now (a tool, a search, writing the answer); null when idle. */
  progress: AgentProgress | null;
  /** True until the conversation that should be open has been fetched, so the page never shows an empty chat that fills in later. */
  opening: boolean;
  sessionId: string | null;
  title: string | null;
  sessions: SessionSummary[] | null;
}

type Words = { t: (key: MessageKey, vars?: Record<string, string | number>) => string; locale: string };

/**
 * One conversation state for the whole tab (D-090). The side panel and the full page are two views of the same store, so a
 * question asked in one is already there in the other, with its progress, instead of each keeping its own copy.
 */
let state: State = { turns: [], busy: false, progress: null, opening: true, sessionId: null, title: null, sessions: null };
const listeners = new Set<() => void>();
const SERVER_STATE = state;
let watching: string | null = null;
let initial: Promise<void> | null = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

function setSession(id: string | null) {
  set({ sessionId: id });
  storeCurrent(id);
}

const nextId = () => state.turns.reduce((max, turn) => Math.max(max, turn.id), 0) + 1;

/** Another view is still answering this conversation: wait for the answer to be stored, then show it. */
function watch(id: string) {
  watching = id;
  set({ busy: true, progress: { step: 'think', round: 1 } });
  const tick = async () => {
    if (watching !== id) return;
    const data = await call<{ messages: StoredMessage[]; pending: boolean }>('GET', `/api/assistant/sessions/${id}`);
    if (watching !== id) return;
    if (data && !data.pending) {
      watching = null;
      set({ turns: withDangling(toTurns(data.messages), data.messages), busy: false, progress: null, sessions: null });
      return;
    }
    window.setTimeout(() => void tick(), WATCH_MS);
  };
  window.setTimeout(() => void tick(), WATCH_MS);
}

/** A question the server kept but never answered (the answer failed, or the server restarted): offer to ask it again. */
function withDangling(turns: Turn[], messages: StoredMessage[]): Turn[] {
  const last = turns.at(-1);
  if (last?.kind !== 'user') return turns;
  return [...turns, { id: (messages.at(-1)?.seq ?? last.id) + 1, kind: 'error', text: '', retry: last.text, attachments: last.attachments }];
}

async function open(id: string): Promise<boolean> {
  watching = null;
  set({ opening: true });
  const data = await call<{ id: string; title: string; messages: StoredMessage[]; pending: boolean }>('GET', `/api/assistant/sessions/${id}`);
  if (!data) {
    set({ opening: false });
    return false;
  }
  set({ turns: data.pending ? toTurns(data.messages) : withDangling(toTurns(data.messages), data.messages), title: data.title, opening: false, busy: false, progress: null });
  setSession(data.id);
  if (data.pending) watch(data.id);
  return true;
}

/** The first view to mount opens the conversation this tab had open; the full page also falls back to the latest one. */
async function ensureLoaded(resumeLatest: boolean) {
  initial ??= (async () => {
    const id = readCurrent();
    if (id && (await open(id))) return;
    setSession(null);
    set({ opening: false });
  })();
  await initial;
  if (resumeLatest && !state.sessionId && state.turns.length === 0 && !state.busy) {
    set({ opening: true });
    const data = await call<{ sessions: SessionSummary[] }>('GET', '/api/assistant/sessions?limit=1');
    set({ sessions: null });
    const latest = data?.sessions[0];
    if (latest && !state.sessionId && state.turns.length === 0 && !state.busy && (await open(latest.id))) return;
    set({ opening: false });
  }
}

async function ask(raw: string, words: Words, history?: Turn[], attachments: Chip[] = []) {
  const question = raw.trim().slice(0, MAX_LENGTH);
  if (!question || state.busy) return;
  // A question asked while the open conversation is still being fetched waits for it, so it lands in the right conversation.
  if (initial) await initial;
  if (state.busy) return;
  history ??= state.turns;
  watching = null;
  const withQuestion: Turn[] = [...history, { id: history.reduce((max, turn) => Math.max(max, turn.id), 0) + 1, kind: 'user', text: question, at: new Date().toISOString(), ...(attachments.length ? { attachments } : {}) }];
  set({ turns: withQuestion, busy: true, progress: { step: 'think', round: 1 } });
  const all: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const turn of withQuestion) {
    if (turn.kind === 'user') all.push({ role: 'user', content: turn.text });
    else if (turn.kind === 'assistant') {
      const text = turn.reply.text ?? turn.reply.message;
      if (text) all.push({ role: 'assistant', content: text });
    }
  }
  const messages = all.slice(-10);
  const failed = (text: string) => set({ turns: [...withQuestion, { id: nextId() + 1, kind: 'error', text, retry: question, attachments }] });
  try {
    const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ messages, locale: words.locale, stream: true, sessionId: state.sessionId ?? undefined, attachmentIds: attachments.flatMap((a) => (a.id ? [a.id] : [])) }) });
    const streamed = res.ok && (res.headers.get('content-type') ?? '').includes('ndjson');
    // A streamed answer sends the conversation's id first, then progress lines and one `done` (or `error`) line; anything else is the plain JSON reply.
    const body = streamed
      ? await readStream(res, (p) => set({ progress: p }), (id) => {
          // A conversation that just began is titled after its first question, as the server does.
          if (id !== state.sessionId) set({ title: question.replace(/\s+/g, ' ').trim().slice(0, 80) });
          setSession(id);
        })
      : await res.json().catch(() => null);
    if (res.ok && body?.ok) {
      const { sessionId: saved, ...reply } = body.data as AssistantReply & { sessionId?: string };
      set({ turns: [...withQuestion, { id: nextId() + 1, kind: 'assistant', reply: reply as AssistantReply, at: new Date().toISOString() }] });
      if (saved) {
        if (saved !== state.sessionId) set({ title: question.replace(/\s+/g, ' ').trim().slice(0, 80) });
        setSession(saved);
      }
      set({ sessions: null }); // the list is stale now: it is fetched again when it is next opened
    } else failed(res.status === 429 ? words.t('rateLimited') : words.t('genericError'));
  } catch {
    failed(words.t('genericError'));
  } finally {
    set({ busy: false, progress: null });
  }
}

async function loadSessions(q = '') {
  const data = await call<{ sessions: SessionSummary[] }>('GET', `/api/assistant/sessions${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  set({ sessions: data?.sessions ?? [] });
}

async function rename(id: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) return;
  if (!(await call('PATCH', `/api/assistant/sessions/${id}`, { title: trimmed }))) return;
  if (state.sessionId === id) set({ title: trimmed });
  set({ sessions: state.sessions?.map((s) => (s.id === id ? { ...s, title: trimmed } : s)) ?? null });
}

function newChat() {
  watching = null;
  set({ turns: [], title: null, busy: false, progress: null });
  setSession(null);
}

async function remove(id: string) {
  if (!(await call('DELETE', `/api/assistant/sessions/${id}`))) return;
  set({ sessions: state.sessions?.filter((s) => s.id !== id) ?? null });
  if (state.sessionId === id) newChat();
}

/**
 * The conversation with the assistant: its turns, the open session and the call to `/api/ai/chat`. Every answer comes from
 * the server, which only answers about the organization (D-049) and keeps the conversation for its owner (D-078); this hook
 * carries the words back and forth and lists, opens, renames and deletes the person's earlier conversations. State is shared
 * by every component in the tab that uses it (D-090). `resumeLatest`: with nothing open, carry on with the latest conversation.
 */
export function useAssistant(options: { resumeLatest?: boolean } = {}) {
  const t = useT();
  const locale = useLocale();
  const snapshot = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  const resume = options.resumeLatest === true;
  // Read after hydration so the server and the first browser render agree; the open conversation is fetched, not guessed.
  useEffect(() => void ensureLoaded(resume), []);
  const words: Words = { t, locale };

  return {
    ...snapshot,
    ask: (q: string, attachments?: Chip[]) => void ask(q, words, undefined, attachments),
    askAgain: (question: string) => void ask(question, words),
    /** Ask the failed question again, dropping the error and the question it answered. */
    retry: (turn: Extract<Turn, { kind: 'error' }>) => {
      const history = state.turns.filter((x) => x.id !== turn.id).slice(0, -1);
      void ask(turn.retry, words, history, turn.attachments ?? []);
    },
    newChat,
    clear: newChat,
    open: (id: string) => open(id),
    loadSessions,
    rename,
    remove,
  };
}
