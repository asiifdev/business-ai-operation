import { AiProviderError } from './errors';
import type { Usage } from './types';

/**
 * Prices in micro-USD per token (so USD per million tokens, numerically). Source: docs/02 §2, dev.meta.ai pricing page,
 * read 2026-10-28. Check against the real invoice before trusting budgets (BRD-M07 §11.3).
 */
interface TokenPrice {
  input: number;
  cachedInput: number;
  output: number;
}

const TOKEN_PRICES: Record<string, TokenPrice> = {
  'muse-spark-1.3': { input: 1.25, cachedInput: 0.15, output: 4.25 },
  'muse-spark-1.3-contributor': { input: 0.1, cachedInput: 0.002, output: 0.2 },
  'muse-wonder-1.0': { input: 4, cachedInput: 0.2, output: 20 },
};

/** USD 0.18 per hour of audio = 50 micro-USD per second. */
const STT_MICRO_PER_SECOND = 50;
/** USD 0.01 per generated image. */
const IMAGE_MICRO = 10_000;

/** USD 2.50 per 1,000 web searches (docs/02). */
const SEARCH_MICRO = 2_500;

export function webSearchCostMicroUsd(searches: number): number {
  return searches * SEARCH_MICRO;
}

/**
 * Cost of one chat call in whole micro-USD, rounded up so the budget never under-counts.
 * Reasoning tokens are already inside `outputTokens` and are billed like visible output.
 */
export function chatCostMicroUsd(model: string, usage: Usage): number {
  const price = TOKEN_PRICES[model];
  if (!price) throw new AiProviderError('config', `No price configured for model "${model}"`);
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  return Math.ceil(fresh * price.input + cached * price.cachedInput + usage.outputTokens * price.output);
}

export function transcribeCostMicroUsd(durationMs: number): number {
  return Math.ceil(durationMs / 1000) * STT_MICRO_PER_SECOND;
}

export function imageCostMicroUsd(images: number): number {
  return images * IMAGE_MICRO;
}

export function isContributorModel(model: string): boolean {
  return model.endsWith('-contributor');
}
