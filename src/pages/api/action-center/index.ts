import type { APIRoute } from 'astro';
import { listPendingApprovals } from '../../../domain/action-center/approvals';
import { listFindings, type FindingView } from '../../../domain/action-center/findings';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

const VIEWS: FindingView[] = ['open', 'snoozed', 'closed'];

/** The Action Center in one call: the cards of one view and the approvals waiting for this person. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const asked = context.url.searchParams.get('view') as FindingView | null;
    const { today, findings } = await listFindings(ctx, asked && VIEWS.includes(asked) ? asked : 'open');
    return ok({ today, findings, approvals: await listPendingApprovals(ctx) });
  });
