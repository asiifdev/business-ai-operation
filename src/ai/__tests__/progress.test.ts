import { describe, expect, it } from 'vitest';
import { progressDetail } from '../progress';
import { progressLabel } from '../../components/assistant/progress-label';
import { readStream } from '../../components/assistant/read-stream';
import { translate } from '../../lib/i18n';

const id = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('id', key, vars);

describe('progressDetail', () => {
  it('shows the search words and the site name, and nothing else', () => {
    expect(progressDetail('search_web', { query: 'kafe di Bandung' })).toBe('kafe di Bandung');
    expect(progressDetail('search_web', { query: 'x'.repeat(300) })).toHaveLength(80);
    expect(progressDetail('read_website', { url: 'https://www.kopikenangan.com/kontak?x=1' })).toBe('kopikenangan.com');
    expect(progressDetail('read_website', { url: 'bukan url' })).toBeUndefined();
    expect(progressDetail('list_clients', { q: 'rahasia' })).toBeUndefined();
    expect(progressDetail('search_web', null)).toBeUndefined();
  });
});

describe('progressLabel', () => {
  it('names the real step in plain words', () => {
    expect(progressLabel(null, id)).toBe('Mencari di data Anda…');
    expect(progressLabel({ step: 'think', round: 1 }, id)).toBe('Memahami pertanyaan Anda…');
    expect(progressLabel({ step: 'think', round: 2 }, id)).toBe('Menyusun jawaban…');
    expect(progressLabel({ step: 'tool', name: 'search_web', detail: 'kafe di Bandung' }, id)).toBe('Mencari di web: kafe di Bandung');
    expect(progressLabel({ step: 'tool', name: 'search_web' }, id)).toBe('Mencari di web…');
    expect(progressLabel({ step: 'tool', name: 'read_website', detail: 'kopikenangan.com' }, id)).toBe('Membaca situs kopikenangan.com');
    expect(progressLabel({ step: 'tool', name: 'get_attachment' }, id)).toBe('Membaca lampiran Anda…');
    expect(progressLabel({ step: 'tool', name: 'create_client' }, id)).toBe('Menyiapkan perubahan…');
    expect(progressLabel({ step: 'tool', name: 'list_invoices' }, id)).toBe('Memeriksa data Anda…');
  });
});

const response = (chunks: string[]) => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }));

describe('readStream', () => {
  it('reports progress as it arrives, also when a line is split across chunks, and returns the final answer', async () => {
    const seen: unknown[] = [];
    const line1 = JSON.stringify({ event: 'progress', step: 'tool', name: 'search_web', detail: 'kafe' });
    const done = JSON.stringify({ event: 'done', data: { text: 'Halo', sessionId: 's1' } });
    const out = await readStream(response([line1.slice(0, 20), `${line1.slice(20)}\nnot json\n`, `${done}\n`]), (e) => seen.push(e));
    expect(seen).toEqual([{ event: 'progress', step: 'tool', name: 'search_web', detail: 'kafe' }]);
    expect(out).toEqual({ ok: true, data: { text: 'Halo', sessionId: 's1' } });
  });

  it('turns an error line into a failure, and a stream without a result into null', async () => {
    expect(await readStream(response([`${JSON.stringify({ event: 'error', code: 'internal' })}\n`]), () => undefined)).toEqual({ ok: false });
    expect(await readStream(response([`${JSON.stringify({ event: 'progress', step: 'think', round: 1 })}\n`]), () => undefined)).toBeNull();
  });
});
