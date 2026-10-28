/** Window event a page fires after it changed what needs attention; the app frame then reloads its pills and bell. */
export const ATTENTION_REFRESH = 'attention:refresh';

export function refreshAttention(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ATTENTION_REFRESH));
}
