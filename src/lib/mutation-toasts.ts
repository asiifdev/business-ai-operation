import type { MessageKey } from './i18n';

/** Records the app's own screens create, change and act on. Chat, sign-in and background polling stay silent. */
const ENTITIES = 'clients|products|packages|deployments|leads|tasks|invoices|subscriptions|documents|users|flows|connections|meetings|approvals|findings|marketing|settings';
const COLLECTION = new RegExp(`^/api/(?:${ENTITIES})(?:/[a-z-]+)?$`);
const ONE = new RegExp(`^/api/(?:${ENTITIES})/[^/]+$`);
const ACTION = new RegExp(`^/api/(?:${ENTITIES})/[^/]+/[a-z-]+$`);
const CONTENT = new RegExp(`^/api/(?:${ENTITIES})/[^/]+/content$`);

/**
 * The message for a call that just succeeded, or null when it needs none. Decided from the method and path alone, so one
 * place covers every screen; a screen that has something more specific to say raises its own toast and is listed in
 * `OWN_TOAST`.
 */
export function mutationToastKey(method: string, url: string, data?: unknown): MessageKey | null {
  if (method === 'GET') return null;
  // Some endpoints answer 200 with `ok: false` for a refusal the person should read (quota, safety filter, figures the data does not hold): not a success.
  if (data && typeof data === 'object' && (data as { ok?: unknown }).ok === false) return null;
  // A save that reports it changed nothing (`changed: []`) must not say "saved".
  if (data && typeof data === 'object' && Array.isArray((data as { changed?: unknown }).changed) && (data as { changed: unknown[] }).changed.length === 0) return null;
  // An undo the system refused (the record was edited since) is not a success.
  if (data && typeof data === 'object' && (data as { undone?: unknown }).undone === false) return null;
  const path = url.split('?')[0]!;
  if (OWN_TOAST.some((re) => re.test(path))) return null;
  if (method === 'DELETE' && SETTINGS.test(path)) return 'toastDeleted';
  if (SAVES.test(path)) return 'toastSaved';
  if (method === 'DELETE') return ONE.test(path) || CONTENT.test(path) ? 'toastDeleted' : null;
  if (method === 'PATCH' || method === 'PUT') return ONE.test(path) ? 'toastSaved' : null;
  if (method === 'POST') {
    if (ACTION.test(path)) return 'toastDone';
    return COLLECTION.test(path) ? 'toastCreated' : null;
  }
  return null;
}

/** Settings screens save with POST or PUT to a fixed path; that is a save, not a create. */
const SAVES = /^\/api\/(?:settings|profile|ai\/budgets)(?:\/|$)/;

/** Records removed from a settings screen (a service on the company profile, its logo). */
const SETTINGS = /^\/api\/settings\//;

/** Calls whose screen already says something specific. */
const OWN_TOAST: RegExp[] = [/^\/api\/runs\//];
