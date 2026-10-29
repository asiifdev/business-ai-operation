import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { connections, deployments } from '../../db/schema';
import { recordAudit } from '../audit/service';
import { automationOnce } from '../automation/once';

/**
 * Deliveries from the platform's GitHub App (D-058). A webhook body is DATA, not an instruction (CR-12): it can only move
 * observations ("this branch is now at this commit", "this installation was removed") that the rest of the system reads;
 * it never starts a run. The organization comes from the installation id, looked up in OUR table, never from the payload's
 * own claims about who it belongs to (BR-M17-01). A delivery id is acted on once (BR-M17-12).
 */
const installation = z.object({ id: z.number().int() });
const pushSchema = z.object({
  ref: z.string(),
  after: z.string().regex(/^[0-9a-f]{40,64}$/),
  deleted: z.boolean().optional(),
  repository: z.object({ full_name: z.string() }),
  installation,
});
const installationSchema = z.object({ action: z.string(), installation });

export type WebhookOutcome = 'ignored' | 'duplicate' | 'push' | 'installation' | 'ping' | 'unknown_installation';

const BRANCH = /^refs\/heads\/(.+)$/;

export async function handleGithubWebhook(event: string, deliveryId: string, payload: unknown, now: Date = new Date()): Promise<WebhookOutcome> {
  if (event === 'ping') return 'ping';
  if (event !== 'push' && event !== 'installation') return 'ignored';

  const parsed = event === 'push' ? pushSchema.safeParse(payload) : installationSchema.safeParse(payload);
  if (!parsed.success) return 'ignored';
  const installationId = parsed.data.installation.id;

  const [conn] = await db.select({ id: connections.id, orgId: connections.orgId }).from(connections).where(and(eq(connections.kind, 'github'), sql`${connections.config}->>'installationId' = ${String(installationId)}`)).limit(1);
  if (!conn) return 'unknown_installation';

  return db.transaction(async (tx) => {
    const once = await automationOnce(tx, conn.orgId, 'github_webhook', deliveryId, async () => {
      if (event === 'push') {
        const p = parsed.data as z.infer<typeof pushSchema>;
        const branch = BRANCH.exec(p.ref)?.[1];
        if (!branch || p.deleted) return 'ignored' as const;
        // Only this organization's deployments of this repo and branch; the rest of the tip is read by the drift check.
        await tx
          .update(deployments)
          .set({ latestCommit: p.after, codeCheckedAt: now, behindBy: sql`case when ${deployments.deployedCommit} = ${p.after} then 0 else null end` })
          .where(and(eq(deployments.orgId, conn.orgId), sql`lower(${deployments.repo}) = ${p.repository.full_name.toLowerCase()}`, eq(deployments.branch, branch)));
        return 'push' as const;
      }
      const action = (parsed.data as z.infer<typeof installationSchema>).action;
      const next = action === 'deleted' ? { testStatus: 'failed' as const, testMessage: 'not_found' } : action === 'suspend' ? { testStatus: 'failed' as const, testMessage: 'unauthorized' } : action === 'unsuspend' ? { testStatus: 'untested' as const, testMessage: null } : null;
      if (!next) return 'ignored' as const;
      await tx.update(connections).set({ ...next, testedAt: now }).where(and(eq(connections.orgId, conn.orgId), eq(connections.id, conn.id)));
      await recordAudit(tx, { orgId: conn.orgId, actor: 'system:github' }, { action: 'connection.github_event', entityType: 'connection', entityId: conn.id, summary: { event: action } });
      return 'installation' as const;
    });
    return once.ran ? once.result : ('duplicate' as const);
  });
}
