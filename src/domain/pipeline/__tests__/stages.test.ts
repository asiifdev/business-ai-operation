import { describe, expect, it } from 'vitest';
import { allowedMoves, canMove, daysInStage, isFinalStage, isStagnant, pipelineValue, type Stage } from '../stages';

const day = 86_400_000;
const now = new Date('2026-10-28T03:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * day);
const lead = (over: Partial<Parameters<typeof isStagnant>[0]> = {}) => ({ stage: 'exploring' as Stage, isDraft: false, archivedAt: null, stageChangedAt: ago(0), ...over });

describe('stage moves (BR-M04-01, -02)', () => {
  it('moves one step forward, any number back, or to Lost', () => {
    expect(allowedMoves('new')).toEqual(['exploring', 'lost']);
    expect(allowedMoves('exploring')).toEqual(['new', 'proposal', 'lost']);
    expect(allowedMoves('proposal')).toEqual(['new', 'exploring', 'negotiation', 'won', 'lost']);
    expect(allowedMoves('negotiation')).toEqual(['new', 'exploring', 'proposal', 'won', 'lost']);
  });

  it('refuses to jump to Won from New or Exploring, or to skip a stage', () => {
    expect(canMove('new', 'won')).toBe(false);
    expect(canMove('exploring', 'won')).toBe(false);
    expect(canMove('new', 'proposal')).toBe(false);
    expect(canMove('proposal', 'won')).toBe(true);
  });

  it('treats Won and Lost as final: nothing moves out of them', () => {
    expect(allowedMoves('won')).toEqual([]);
    expect(allowedMoves('lost')).toEqual([]);
    expect(isFinalStage('won')).toBe(true);
    expect(isFinalStage('negotiation')).toBe(false);
  });
});

describe('stagnant (BR-M04-08)', () => {
  it('is derived from how long the lead stayed in its stage', () => {
    expect(isStagnant(lead({ stageChangedAt: ago(14) }), 14, now)).toBe(false);
    expect(isStagnant(lead({ stageChangedAt: ago(15) }), 14, now)).toBe(true);
    expect(isStagnant(lead({ stageChangedAt: ago(15) }), 30, now)).toBe(false);
  });

  it('never flags a closed lead, an AI draft, or an archived lead', () => {
    const old = { stageChangedAt: ago(90) };
    expect(isStagnant(lead({ ...old, stage: 'won' }), 14, now)).toBe(false);
    expect(isStagnant(lead({ ...old, stage: 'lost' }), 14, now)).toBe(false);
    expect(isStagnant(lead({ ...old, isDraft: true }), 14, now)).toBe(false);
    expect(isStagnant(lead({ ...old, archivedAt: ago(1) }), 14, now)).toBe(false);
  });

  it('counts whole days in a stage', () => {
    expect(daysInStage(ago(3.9), now)).toBe(3);
    expect(daysInStage(new Date(now.getTime() + day), now)).toBe(0);
  });
});

describe('pipeline value (BR-M04-06, -07)', () => {
  const l = (stage: Stage, estimatedValue: number | null, over = {}) => ({ stage, isDraft: false, archivedAt: null, estimatedValue, ...over });

  it('adds up open, accepted, unarchived leads only', () => {
    expect(
      pipelineValue([
        l('new', 1_000_000),
        l('proposal', 2_500_000),
        l('won', 9_000_000),
        l('lost', 9_000_000),
        l('negotiation', 700_000, { isDraft: true }),
        l('exploring', 400_000, { archivedAt: new Date() }),
        l('exploring', null),
      ]),
    ).toBe(3_500_000);
  });
});
