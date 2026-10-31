import type { AgentProgress } from '../../ai/progress';

/** Reads the NDJSON answer: progress lines go to `onProgress`; the result is shaped like the plain JSON reply (`{ ok, data }`). */
export async function readStream(res: Response, onProgress: (e: AgentProgress) => void): Promise<{ ok: boolean; data?: unknown } | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { ok: boolean; data?: unknown } | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    let msg: { event?: string; data?: unknown; step?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.event === 'progress' && (msg.step === 'think' || msg.step === 'tool')) onProgress(msg as unknown as AgentProgress);
    else if (msg.event === 'done') result = { ok: true, data: msg.data };
    else if (msg.event === 'error') result = { ok: false };
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) take(line);
    if (done) break;
  }
  take(buffer);
  return result;
}
