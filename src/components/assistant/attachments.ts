import { ApiError, api, upload } from '../../lib/api-client';

/** One thing the person is giving the assistant, from the moment it is picked until the message is sent (D-083). */
export interface Chip {
  key: string;
  name: string;
  status: 'reading' | 'ready' | 'error';
  /** Set once the server has read it. */
  id?: string;
  kind?: string;
  /** Why it could not be used: a `reason` from the server, or `generic`. */
  error?: string;
}

/** The kinds the picker offers. The server decides from the file's own bytes, so this only narrows the list shown to the person. */
export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.html';

type Outcome = { ok: true; attachment: { id: string; name: string; kind: string } } | { ok: false; reason: string };

export async function readFile(file: File): Promise<Outcome> {
  const form = new FormData();
  form.append('file', file);
  try {
    return await upload<Outcome>('/api/assistant/attachments', form);
  } catch (error) {
    return { ok: false, reason: error instanceof ApiError && error.code === 'rate_limited' ? 'rate' : 'generic' };
  }
}

export async function readLink(url: string): Promise<Outcome> {
  try {
    return await api<Outcome>('POST', '/api/assistant/attachments', { url });
  } catch (error) {
    return { ok: false, reason: error instanceof ApiError && error.code === 'rate_limited' ? 'rate' : 'url' };
  }
}

export async function dropAttachment(id: string): Promise<void> {
  try {
    await api('DELETE', `/api/assistant/attachments/${id}`);
  } catch {
    /* A leftover one is removed by the server after a day. */
  }
}
