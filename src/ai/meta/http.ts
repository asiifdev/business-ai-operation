import { AiProviderError, type AiErrorKind } from '../errors';
import type { CallMeta } from '../types';

export interface MetaHttpOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Total tries including the first. Meta suggests 3 to 5. */
  maxAttempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  /** Longest wait we sit through for a retry. Longer `Retry-After` values are handed back to the caller (jobs). */
  maxWaitMs?: number;
}

export interface HttpRequest {
  path: string;
  json?: unknown;
  form?: FormData;
  /** Muse Image reports a plain 500 as not retryable, unlike the text models. */
  retry500?: boolean;
  /** Overrides the default number of tries. Speech-to-text asks for one retry only. */
  maxAttempts?: number;
}

export interface HttpResult<T> {
  body: T;
  meta: Pick<CallMeta, 'requestId' | 'rateLimit' | 'attempts'>;
}

const RETRYABLE = new Set([429, 503]);

/**
 * One POST to Meta Model API with the retry rules from the error-handling page: 429, 503 (and 500 for text) with
 * exponential backoff plus jitter, honouring `Retry-After` (BR-M07-13). 504 is never retried as-is. The key only ever
 * goes into the `Authorization` header and never into an error message.
 */
export class MetaHttp {
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly baseDelayMs: number;
  private readonly maxWaitMs: number;

  constructor(private readonly options: MetaHttpOptions) {
    if (!options.apiKey) throw new AiProviderError('config', 'MODEL_API_KEY is not set');
    this.doFetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.baseDelayMs = options.baseDelayMs ?? 800;
    this.maxWaitMs = options.maxWaitMs ?? 90_000;
  }

  async post<T>(request: HttpRequest): Promise<HttpResult<T>> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}${request.path}`;
    const retry500 = request.retry500 ?? true;
    const maxAttempts = request.maxAttempts ?? this.maxAttempts;
    let lastError: AiProviderError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.send(url, request);
      } catch (cause) {
        if (cause instanceof AiProviderError) throw cause;
        // Network failure: treated like a transient server problem.
        lastError = new AiProviderError('unavailable', 'Could not reach Meta Model API');
        if (attempt === maxAttempts) throw lastError;
        await this.sleep(this.backoff(attempt, 0));
        continue;
      }

      if (response.ok) {
        let body: T;
        try {
          body = (await response.json()) as T;
        } catch {
          throw new AiProviderError('invalid_output', 'Meta Model API returned a body that is not JSON', { status: response.status });
        }
        return { body, meta: { ...this.readMeta(response), attempts: attempt } };
      }

      const error = await this.toError(response);
      const retryable = RETRYABLE.has(response.status) || (response.status === 500 && retry500);
      if (!retryable) throw error;
      lastError = error;
      if (attempt === maxAttempts) throw error;
      const retryAfterMs = error.details.retryAfterMs ?? 0;
      if (retryAfterMs > this.maxWaitMs) throw error;
      await this.sleep(this.backoff(attempt, retryAfterMs));
    }
    throw lastError ?? new AiProviderError('unavailable', 'Meta Model API request failed');
  }

  private async send(url: string, request: HttpRequest): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.options.apiKey}` };
    let body: BodyInit | undefined;
    if (request.form) {
      body = request.form;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(request.json ?? {});
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.doFetch(url, { method: 'POST', headers, body, signal: controller.signal });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        throw new AiProviderError('timeout', `Meta Model API did not answer within ${this.timeoutMs} ms`);
      }
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Doubles from the base delay, adds 0 to 1 s of jitter, and never goes below what `Retry-After` asked for. */
  private backoff(attempt: number, retryAfterMs: number): number {
    const exponential = this.baseDelayMs * 2 ** (attempt - 1);
    return Math.max(retryAfterMs, exponential + this.random() * 1000);
  }

  private readMeta(response: Response): Pick<CallMeta, 'requestId' | 'rateLimit'> {
    const rateLimit: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith('x-ratelimit-')) rateLimit[key.toLowerCase()] = value;
    });
    return { requestId: response.headers.get('x-request-id') ?? undefined, rateLimit };
  }

  private async toError(response: Response): Promise<AiProviderError> {
    let message = '';
    let code: string | null = null;
    let param: string | null = null;
    const text = await response.text().catch(() => '');
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; code?: string | null; param?: string | null } };
      message = parsed.error?.message ?? '';
      code = parsed.error?.code ?? null;
      param = parsed.error?.param ?? null;
    } catch {
      // 404 for unknown paths has no body at all, and a few endpoints answer in plain text.
      message = text.slice(0, 200);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    const status = response.status;
    return new AiProviderError(kindFor(status, code), `Meta Model API ${status}${code ? ` (${code})` : ''}: ${message || 'no message'}`.slice(0, 400), {
      status,
      code,
      param,
      retryAfterMs,
    });
  }
}

function kindFor(status: number, code: string | null): AiErrorKind {
  if (status === 400) return code === 'content_policy_violation' ? 'content_policy' : 'bad_request';
  if (status === 401 || status === 402 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}
