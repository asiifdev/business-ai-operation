import type { Usage } from './types';

export type AiErrorKind =
  /** 401, 402, 403: key, billing, or access. Not retryable, and worth an alert. */
  | 'auth'
  /** 400: our request is wrong. Never retry unchanged. */
  | 'bad_request'
  /** 400 `content_policy_violation`: show a friendly message, do not retry. */
  | 'content_policy'
  | 'not_found'
  | 'too_large'
  | 'rate_limited'
  /** 500 and 503 after the retries ran out. */
  | 'unavailable'
  /** 504 or a client-side timeout. */
  | 'timeout'
  /** The call worked but gave nothing usable (null answer, cut off by the token limit). BR-M07 / D-019. */
  | 'empty'
  | 'invalid_output'
  /** Misconfiguration found before any request (missing key, contributor model on real data). */
  | 'config'
  /** The daily budget for this feature is spent (BR-M07-07). */
  | 'budget';

/** Failure from the AI layer. `message` is safe to log; it never contains the API key or request headers. */
export class AiProviderError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
    public readonly details: {
      status?: number;
      code?: string | null;
      param?: string | null;
      retryAfterMs?: number;
      /** Tokens the failed call still used, so `ai_runs` records the real cost even when the answer is unusable. */
      usage?: Usage;
    } = {},
  ) {
    super(message);
    this.name = 'AiProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'unavailable';
  }
}
