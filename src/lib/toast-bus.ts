export type ToastTone = 'success' | 'danger' | 'neutral';
export interface ToastItem { id: number; text: string; tone: ToastTone }

export const TOAST_EVENT = 'orbyte:toast';
const CARRY_KEY = 'orbyte:toast:carry';
/** A toast carried across a page change is shown only if the change happened this recently. */
const CARRY_MS = 4000;
let nextId = 1;

type Carried = ToastItem & { at: number };

function readCarried(): Carried[] {
  try {
    const raw = window.sessionStorage.getItem(CARRY_KEY);
    return raw ? (JSON.parse(raw) as Carried[]) : [];
  } catch {
    return [];
  }
}

function writeCarried(list: Carried[]) {
  try {
    if (list.length) window.sessionStorage.setItem(CARRY_KEY, JSON.stringify(list));
    else window.sessionStorage.removeItem(CARRY_KEY);
  } catch {
    // Storage can be blocked; the toast then only shows on the page it was raised on.
  }
}

/**
 * Short feedback after an action. Anyone can call it; the one `Toaster` in the app shell shows it. With `carry`, the toast
 * also survives a page change that follows straight away (a delete that sends the person back to the list).
 */
export function toast(text: string, tone: ToastTone = 'success', opts: { carry?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  const item: ToastItem = { id: nextId++, text, tone };
  if (opts.carry) writeCarried([...readCarried(), { ...item, at: Date.now() }]);
  window.dispatchEvent(new CustomEvent<ToastItem>(TOAST_EVENT, { detail: item }));
}

/** The page that raised a carried toast is still open if this runs a moment later; then the carry is not needed. */
export function dropCarried(id: number) {
  writeCarried(readCarried().filter((x) => x.id !== id));
}

/** Toasts raised just before this page loaded. Reading them clears them, so a reload does not show them again. */
export function takeCarried(): ToastItem[] {
  if (typeof window === 'undefined') return [];
  const list = readCarried();
  if (list.length === 0) return [];
  writeCarried([]);
  const now = Date.now();
  return list.filter((x) => now - x.at < CARRY_MS).map(({ at: _at, ...item }) => ({ ...item, id: nextId++ }));
}
