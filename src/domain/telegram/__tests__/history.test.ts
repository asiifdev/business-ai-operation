import { describe, expect, it } from 'vitest';
import { ChatHistory } from '../history';

const clockAt = (iso: string) => {
  let now = new Date(iso);
  return { now: () => now, set: (v: string) => void (now = new Date(v)) };
};

describe('ChatHistory', () => {
  it('gives a follow-up its context, oldest first, per person', () => {
    const clock = clockAt('2026-10-29T04:00:00Z');
    const h = new ChatHistory(clock);
    h.remember('u1', 'halo', 'Halo!');
    h.remember('u1', 'ada project baru', 'Boleh, detailnya?');
    expect(h.recent('u1')).toEqual([
      { role: 'user', content: 'halo' },
      { role: 'assistant', content: 'Halo!' },
      { role: 'user', content: 'ada project baru' },
      { role: 'assistant', content: 'Boleh, detailnya?' },
    ]);
    expect(h.recent('u2')).toEqual([]);
  });

  it('keeps only the latest turns and always starts with the person', () => {
    const h = new ChatHistory(clockAt('2026-10-29T04:00:00Z'));
    for (let i = 1; i <= 5; i++) h.remember('u1', `q${i}`, `a${i}`);
    const recent = h.recent('u1');
    expect(recent).toHaveLength(6);
    expect(recent[0]).toEqual({ role: 'user', content: 'q3' });
    expect(recent.at(-1)).toEqual({ role: 'assistant', content: 'a5' });
  });

  it('forgets a conversation that went quiet for 30 minutes', () => {
    const clock = clockAt('2026-10-29T04:00:00Z');
    const h = new ChatHistory(clock);
    h.remember('u1', 'halo', 'Halo!');
    clock.set('2026-10-29T04:29:00Z');
    expect(h.recent('u1')).toHaveLength(2);
    clock.set('2026-10-29T05:00:00Z');
    expect(h.recent('u1')).toEqual([]);
  });
});
