import { afterEach, describe, expect, it, vi } from 'vitest';
import { botUsername } from '../telegram';

afterEach(() => {
  delete process.env.TELEGRAM_BOT_USERNAME;
  vi.unstubAllGlobals();
});

describe('botUsername', () => {
  it('answers from TELEGRAM_BOT_USERNAME without asking Telegram, so linking never waits on the network', async () => {
    process.env.TELEGRAM_BOT_USERNAME = ' @orbyte_bot ';
    const fetchSpy = vi.fn(() => Promise.reject(new Error('the network must not be used')));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await botUsername()).toBe('orbyte_bot');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
