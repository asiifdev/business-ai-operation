import { describe, expect, it } from 'vitest';
import { toHistory } from '../history';

const user = (text: string) => ({ kind: 'user', body: { text } });
const reply = (text: string) => ({ kind: 'assistant', body: { ok: true, text, sources: [] } });

describe('toHistory', () => {
  it('gives a follow-up its context from the stored conversation, oldest first', () => {
    expect(toHistory([user('halo'), reply('Halo!'), user('ada project baru'), reply('Boleh, detailnya?')])).toEqual([
      { role: 'user', content: 'halo' },
      { role: 'assistant', content: 'Halo!' },
      { role: 'user', content: 'ada project baru' },
      { role: 'assistant', content: 'Boleh, detailnya?' },
    ]);
  });

  it('keeps only the latest turns and always starts with the person', () => {
    const stored = [1, 2, 3, 4, 5].flatMap((i) => [user(`q${i}`), reply(`a${i}`)]);
    const recent = toHistory(stored);
    expect(recent).toHaveLength(6);
    expect(recent[0]).toEqual({ role: 'user', content: 'q3' });
    expect(recent.at(-1)).toEqual({ role: 'assistant', content: 'a5' });
    // cut so it would start with a reply: the reply goes
    expect(toHistory([reply('a0'), ...stored.slice(-5)])[0]).toEqual({ role: 'user', content: 'q4' });
  });

  it('leaves out errors and replies without text', () => {
    expect(toHistory([user('q1'), { kind: 'error', body: { text: 'gagal' } }, { kind: 'assistant', body: { ok: false, message: 'anggaran habis' } }, user('q2')])).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
    ]);
  });
});
