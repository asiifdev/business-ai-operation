import { describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { createRateLimiter } from '../rate-limit';

describe('rate limiter', () => {
  it('allows up to max calls per window, then blocks, then resets after the window', () => {
    const clock = fixedClock('2026-11-01T08:00:00Z');
    const limiter = createRateLimiter(clock);
    const call = () => limiter.allow('ip-1', 3, 60_000);
    expect([call(), call(), call(), call()]).toEqual([true, true, true, false]);
    clock.set('2026-11-01T08:00:30Z');
    expect(call()).toBe(false);
    clock.set('2026-11-01T08:01:01Z');
    expect(call()).toBe(true);
  });

  it('counts each key separately', () => {
    const limiter = createRateLimiter(fixedClock('2026-11-01T08:00:00Z'));
    expect(limiter.allow('a', 1, 1000)).toBe(true);
    expect(limiter.allow('a', 1, 1000)).toBe(false);
    expect(limiter.allow('b', 1, 1000)).toBe(true);
  });
});
