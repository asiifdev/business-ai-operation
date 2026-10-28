import type { MessageKey } from './i18n';

/** What a failed API call carries: the HTTP status, the error code and, for validation, the names of the bad fields. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: string[] = [],
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** Calls our own JSON API. Resolves with `data`, or throws `ApiError`. Never sends anything but JSON. */
export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok || !parsed?.ok) throw new ApiError(res.status, parsed?.error?.code ?? 'internal', parsed?.error?.fields ?? []);
  return parsed.data as T;
}

/** Sends a form with a file (multipart) to our API. Same answer shape and errors as `api`. */
export async function upload<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: form });
  const parsed = await res.json().catch(() => null);
  if (!res.ok || !parsed?.ok) throw new ApiError(res.status, parsed?.error?.code ?? 'internal', parsed?.error?.fields ?? []);
  return parsed.data as T;
}

const CODE_TEXT: Record<string, MessageKey> = {
  forbidden: 'errForbidden',
  not_found: 'errNotFound',
  invalid_state: 'errInvalidState',
  validation: 'errValidation',
  duplicate: 'errDuplicate',
  rate_limited: 'rateLimited',
  expired: 'errExpired',
  already_decided: 'errAlreadyDecided',
};

/** A message in the person's language for a failed call. Unknown failures get the generic one. */
export function errorKey(error: unknown): MessageKey {
  return error instanceof ApiError ? (CODE_TEXT[error.code] ?? 'genericError') : 'genericError';
}

/** Field names the server rejected, as a lookup: `{ name: true }`. */
export const badFields = (error: unknown): Record<string, true> =>
  error instanceof ApiError ? Object.fromEntries(error.fields.map((f) => [f, true as const])) : {};
