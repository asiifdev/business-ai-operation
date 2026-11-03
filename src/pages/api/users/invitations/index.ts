import type { APIRoute } from 'astro';
import { listInvitations } from '../../../../domain/users/invitations';
import { handle, ok, requireCtx } from '../../../../lib/api';

export const prerender = false;

/**
 * `GET /api/users/invitations`: the invitations shown on the users page (D-096): still waiting (an expired one marked),
 * and those accepted in the last 30 days. Same permission as the users list.
 */
export const GET: APIRoute = (context) => handle(async () => ok({ invitations: await listInvitations(requireCtx(context)) }));
