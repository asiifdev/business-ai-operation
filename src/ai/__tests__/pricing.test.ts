import { describe, expect, it } from 'vitest';
import { AiProviderError } from '../errors';
import { chatCostMicroUsd, imageCostMicroUsd, isContributorModel, transcribeCostMicroUsd } from '../pricing';

const usage = (inputTokens: number, outputTokens: number, cachedTokens = 0) => ({ inputTokens, outputTokens, cachedTokens, reasoningTokens: 0 });

describe('pricing', () => {
  it('charges fresh input, cached input and output at their own rates', () => {
    // 800 fresh at 1.25 + 200 cached at 0.15 + 1000 output at 4.25 = 1000 + 30 + 4250
    expect(chatCostMicroUsd('muse-spark-1.3', usage(1000, 1000, 200))).toBe(5280);
  });

  it('rounds up to a whole micro-USD so a budget never under-counts', () => {
    expect(chatCostMicroUsd('muse-spark-1.3', usage(1, 0))).toBe(2); // 1.25 -> 2
  });

  it('never counts more cached tokens than input tokens', () => {
    expect(chatCostMicroUsd('muse-spark-1.3', usage(10, 0, 999))).toBe(Math.ceil(10 * 0.15));
  });

  it('refuses a model it has no price for instead of costing zero', () => {
    expect(() => chatCostMicroUsd('muse-unknown', usage(1, 1))).toThrow(AiProviderError);
  });

  it('prices speech by whole seconds and images per image', () => {
    expect(transcribeCostMicroUsd(22_000)).toBe(1100); // 22 s * 50
    expect(transcribeCostMicroUsd(22_001)).toBe(1150);
    expect(imageCostMicroUsd(3)).toBe(30_000);
  });

  it('recognises contributor models', () => {
    expect(isContributorModel('muse-spark-1.3-contributor')).toBe(true);
    expect(isContributorModel('muse-spark-1.3')).toBe(false);
  });
});
