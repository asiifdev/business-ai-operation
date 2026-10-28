import { describe, expect, it } from 'vitest';
import { LiveTranscript } from '../live';

const feed = (t: LiveTranscript, events: Array<Record<string, unknown>>) => events.map((e) => t.handle(e));

describe('LiveTranscript', () => {
  it('shows partials as captions, then the completed turn with its speaker and times', () => {
    const t = new LiveTranscript();
    const out = feed(t, [
      { type: 'speechStart', turnId: 1, audioProcessedMs: 1200 },
      { type: 'transcript', transcript: 'terima kasih', final: false, audioProcessedMs: 2000 },
      { type: 'speaker', label: 'A', audioProcessedMs: 2100 },
      { type: 'speechEnd', turnId: 1, audioProcessedMs: 3600 },
      { type: 'speechComplete', turnId: 1, transcript: 'Terima kasih sudah hadir.', audioProcessedMs: 3700 },
    ]);
    expect(out[1]).toEqual({ type: 'partial', turnId: 1, speaker: null, text: 'terima kasih' });
    expect(out[4]).toEqual({ type: 'final', turnId: 1, speaker: 'A', text: 'Terima kasih sudah hadir.', startMs: 1200, endMs: 3600 });
    expect(t.turns()).toEqual([{ seq: 1, speaker: 'A', startMs: 1200, endMs: 3600, text: 'Terima kasih sudah hadir.' }]);
    expect(t.audioMs).toBe(3700);
  });

  it('keys turns by id when they overlap, and keeps them in time order', () => {
    const t = new LiveTranscript();
    feed(t, [
      { type: 'speechStart', turnId: 1, audioProcessedMs: 1000 },
      { type: 'speechEnd', turnId: 1, audioProcessedMs: 2000 },
      { type: 'speechStart', turnId: 2, audioProcessedMs: 2100 },
      { type: 'speechComplete', turnId: 2, transcript: 'Kedua.', audioProcessedMs: 3000 },
      { type: 'speechComplete', turnId: 1, transcript: 'Pertama.', audioProcessedMs: 3100 },
    ]);
    expect(t.turns().map((x) => x.text)).toEqual(['Pertama.', 'Kedua.']);
  });

  it('keeps the last partial of a turn that never completed, and drops empty ones', () => {
    const t = new LiveTranscript();
    feed(t, [
      { type: 'speechStart', turnId: 1, audioProcessedMs: 500 },
      { type: 'transcript', transcript: 'masih bicara', final: false, audioProcessedMs: 900 },
      { type: 'speechStart', turnId: 2, audioProcessedMs: 1000 },
      { type: 'transcript', transcript: '   ', final: false, audioProcessedMs: 1100 },
    ]);
    expect(t.turns()).toMatchObject([{ seq: 1, text: 'masih bicara' }]);
  });

  it('does not lose words when a partial arrives before any start event', () => {
    const t = new LiveTranscript();
    feed(t, [{ type: 'transcript', transcript: 'halo semua', final: false, audioProcessedMs: 700 }]);
    expect(t.turns()).toMatchObject([{ text: 'halo semua' }]);
  });

  it('ignores unknown events and malformed values', () => {
    const t = new LiveTranscript();
    expect(feed(t, [{ type: 'audioProgress', audioProcessedMs: 80 }, { type: 'mystery' }, { type: 'speechComplete', turnId: 'x', transcript: 5 }])).toEqual([null, null, null]);
    expect(t.turns()).toEqual([]);
  });
});
