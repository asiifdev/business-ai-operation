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
export function mutationToastKey(method: string, url: string): MessageKey | null {
  if (method === 'GET') return null;
  const path = url.split('?')[0]!;
  if (OWN_TOAST.some((re) => re.test(path))) return null;
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

/** Calls whose screen already says something specific. */
const OWN_TOAST: RegExp[] = [/^\/api\/runs\//];
