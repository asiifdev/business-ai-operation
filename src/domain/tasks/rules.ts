import { addDays, daysBetween } from '../billing/dates';

export const TASK_KINDS = ['task', 'bug', 'feature', 'maintenance'] as const;
export const TASK_STATUSES = ['open', 'in_progress', 'done'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Where a task may go from a status (BR-M05-01). Default awaiting the owner's decision (D-046): work can start, stop or
 * finish from any open status, and a finished task can be reopened. There is no "blocked" or "waiting" status yet
 * (BRD-M05 section 11 question 2).
 */
const MOVES: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ['in_progress', 'done'],
  in_progress: ['open', 'done'],
  done: ['open'],
};

export const allowedStatusMoves = (from: TaskStatus): TaskStatus[] => [...MOVES[from]];
export const canMoveStatus = (from: TaskStatus, to: TaskStatus): boolean => MOVES[from].includes(to);

/** Days until the default due date of a Bug or Maintenance task without one, per priority (BR-M05-04, default). */
export const DEFAULT_DUE_DAYS: Record<TaskPriority, number> = { urgent: 1, high: 3, medium: 7, low: 14 };

/** Kinds that get a default due date when none is given (BR-M05-04). */
const KINDS_WITH_DEFAULT_DUE: ReadonlySet<TaskKind> = new Set(['bug', 'maintenance']);

/** The due date a new task gets: the one given, or for a Bug/Maintenance without one, today plus the priority's days. */
export function defaultDueDate(kind: TaskKind, priority: TaskPriority, today: string, given: string | null | undefined): string | null {
  if (given) return given;
  return KINDS_WITH_DEFAULT_DUE.has(kind) ? addDays(today, DEFAULT_DUE_DAYS[priority]) : null;
}

export interface LateInput {
  status: TaskStatus;
  dueDate: string | null;
  isDraft: boolean;
}

/**
 * Late = due date before today and not done (BR-M05-03). A draft is not real work yet, so it is never late (ERD section
 * 5). Derived from the clock every time; never stored (CR-01).
 */
export const isLate = (task: LateInput, today: string): boolean => !task.isDraft && task.status !== 'done' && task.dueDate !== null && task.dueDate < today;

/** Whole days past the due date, 0 when not late. */
export const daysLate = (task: LateInput, today: string): number => (isLate(task, today) ? daysBetween(task.dueDate!, today) : 0);

/** Open work for counts: accepted and not done (BR-M05-05: drafts do not count). */
export const isOpenWork = (task: { status: TaskStatus; isDraft: boolean }): boolean => !task.isDraft && task.status !== 'done';

// Similar tasks (BRD-M05 section 4 step 5). Plain word overlap, no embeddings: the Meta Model API has none (PRD M05).

const STOPWORDS = new Set(
  (
    'yang di ke dari dan atau untuk pada dengan ini itu ada tidak bisa saat sudah belum akan agar karena juga lagi masih jadi oleh dalam ' +
    'the a an and or to of in on for at with is are be not it this that from by as when can cannot'
  ).split(' '),
);

/**
 * A very light Indonesian stem: drops one common verb prefix so "terkirim" and "dikirim" meet at "kirim". Only when a
 * real word is left, and the same mapping applies to both sides, so an odd stem still compares fairly.
 */
const PREFIXES = ['ter', 'ber', 'di', 'me', 'ke'];
const stem = (w: string): string => {
  const p = PREFIXES.find((x) => w.startsWith(x) && w.length - x.length >= 4);
  return p ? w.slice(p.length) : w;
};

/** Stemmed, lower-cased words of at least 3 letters, without common filler words. */
export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(stem(w));
  }
  return out;
}

/**
 * Share of the smaller word set found in the other, 0 to 1. Short titles are the norm, so dividing by the smaller set
 * (not the union) keeps two short reports of one problem close; a one-word set counts as two so it cannot score 1 alone.
 */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.max(Math.min(a.size, b.size), 2);
}

/** How alike two tasks read: half from the titles, half from title and description together. */
export function similarity(a: { title: string; description?: string | null }, b: { title: string; description?: string | null }): number {
  const title = overlap(words(a.title), words(b.title));
  const all = overlap(words(`${a.title} ${a.description ?? ''}`), words(`${b.title} ${b.description ?? ''}`));
  return (title + all) / 2;
}

/** Below this a pair is not offered as similar. Tuned on the seed data; a suggestion only, a person decides. */
export const SIMILAR_THRESHOLD = 0.3;
