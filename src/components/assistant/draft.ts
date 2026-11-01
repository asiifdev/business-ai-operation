/**
 * What the person has typed in the assistant's box but not sent. Kept in this tab's session storage so moving to another page
 * (the panel is built again there) does not lose it. Cleared when the message is sent.
 */
const KEY = 'orbyte.assistant.draft';

export function readDraft(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeDraft(text: string): void {
  try {
    if (text) sessionStorage.setItem(KEY, text);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* Storage can be blocked: the draft then lives only until the page changes. */
  }
}
