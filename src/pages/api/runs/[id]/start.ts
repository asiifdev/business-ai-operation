import type { APIRoute } from 'astro';
import { decideApproval } from '../../../../domain/action-center/approvals';
import { getRun } from '../../../../domain/flows/service';
import { DomainError } from '../../../../domain/errors';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/**
 * `POST /api/runs/:id/start`: the person approves the plan on the run page. It goes through the SAME approval as the
 * assistant's proposal and Telegram (`decideApproval`), so there is one record of who allowed what (CR-06).
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const run = await getRun(ctx, param(context, 'id'));
    if (!run.approvalId) throw new DomainError('invalid_state', 'the run has no approval');
    return ok(await decideApproval(ctx, run.approvalId, { decision: 'approve' }));
  });
