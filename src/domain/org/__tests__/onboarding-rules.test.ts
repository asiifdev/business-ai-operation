import { describe, expect, it } from 'vitest';
import { computeOnboarding, ONBOARDING_STEPS, profileIsFilled, REQUIRED_STEPS, type OnboardingFacts } from '../onboarding-rules';

const empty: OnboardingFacts = { profileFilled: false, bankFilled: false, productWithPackage: false, hasClient: false, activeUsers: 1, telegramLinked: false };
const status = (s: ReturnType<typeof computeOnboarding>, step: string) => s.steps.find((x) => x.step === step)!.status;

describe('onboarding state (D-095)', () => {
  it('starts with everything to do, nothing ready, and the first step next', () => {
    const s = computeOnboarding(empty, {}, null);
    expect(s.steps.map((x) => x.step)).toEqual([...ONBOARDING_STEPS]);
    expect(s.steps.every((x) => x.status === 'todo')).toBe(true);
    expect(s).toMatchObject({ percent: 0, ready: false, next: 'profile', completedAt: null });
  });

  it('reads done from real data, so a skipped step becomes done once the data exists', () => {
    const skipped = computeOnboarding(empty, { skipped: ['client'] }, null);
    expect(status(skipped, 'client')).toBe('skipped');
    const later = computeOnboarding({ ...empty, hasClient: true }, { skipped: ['client'] }, null);
    expect(status(later, 'client')).toBe('done');
  });

  it('counts the assistant step only after it was confirmed by hand', () => {
    expect(status(computeOnboarding(empty, {}, null), 'assistant')).toBe('todo');
    expect(status(computeOnboarding(empty, { confirmed: ['assistant'] }, null), 'assistant')).toBe('done');
  });

  it('is ready only when every needed step is done; skipping a needed step does not make it ready', () => {
    const needed = { ...empty, profileFilled: true, bankFilled: true, productWithPackage: true };
    expect(computeOnboarding(needed, {}, null).ready).toBe(true);
    expect(computeOnboarding({ ...needed, productWithPackage: false }, { skipped: ['product'] }, null).ready).toBe(false);
    expect(REQUIRED_STEPS).toEqual(['profile', 'finance', 'product']);
  });

  it('needs a second active person for the team step, and skips skipped steps when choosing the next one', () => {
    expect(status(computeOnboarding({ ...empty, activeUsers: 2 }, {}, null), 'team')).toBe('done');
    const s = computeOnboarding({ ...empty, profileFilled: true }, { skipped: ['finance'] }, null);
    expect(s.next).toBe('assistant');
    expect(s.percent).toBe(Math.round((1 / ONBOARDING_STEPS.length) * 100));
  });

  it('reports when the wizard was closed', () => {
    expect(computeOnboarding(empty, {}, new Date('2026-11-03T01:00:00Z')).completedAt).toBe('2026-11-03T01:00:00.000Z');
  });

  it('counts a profile as filled only with a business field and a description', () => {
    expect(profileIsFilled({ industry: 'Software', description: 'Studio' })).toBe(true);
    expect(profileIsFilled({ industry: 'Software', description: '  ' })).toBe(false);
    expect(profileIsFilled({ industry: null, description: 'Studio' })).toBe(false);
  });
});
