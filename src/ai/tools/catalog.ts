import { and, desc, eq, gt, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { approvals, auditLog, users } from '../../db/schema';
import { getAiOverview } from '../../domain/ai/service';
import { can } from '../../domain/permissions';
import { formatUsd } from '../../lib/usd';
import { ToolRegistry, defineTool } from './registry';

export { formatUsd };

/** Entity types the audit trail keeps for the Owner only (PRD §3, `audit.read_financial`). */
const FINANCIAL_ENTITIES = ['invoice', 'payment', 'subscription'];

const who = (actor: string) => (actor.startsWith('ai:') ? 'AI' : actor.startsWith('system:') ? 'sistem' : 'pengguna');

/**
 * Tools the assistant has today, each over a real table of the organization. Business data (clients, invoices, leads)
 * joins this list as M02 to M05 are built; every tool takes the organization and the person from the session, never from
 * the model (BR-M01-01). The assistant may only answer from what these return.
 */
export function buildAssistantRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(
    defineTool({
      name: 'get_ai_usage',
      description: 'Shows today\'s AI spending, daily cap, remaining budget and number of runs for each AI feature of this organization.',
      tier: 'read',
      permission: 'ai.usage.read',
      args: z.object({}),
      run: async (ctx) => {
        const overview = await getAiOverview(db, ctx);
        const features = overview.features.map((f) => ({
          fitur: f.feature,
          batasHarian: formatUsd(f.limitMicroUsd),
          terpakai: formatUsd(f.spentMicroUsd),
          sisa: formatUsd(f.remainingMicroUsd),
          jumlahRun: f.runsToday,
          anggaranHabis: f.exhausted,
        }));
        return { tanggal: ctx.clock.now().toISOString().slice(0, 10), fitur: features, totalTerpakai: formatUsd(overview.features.reduce((a, f) => a + f.spentMicroUsd, 0)) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_team_members',
      description: 'Lists the people in this organization with their role and whether they are active, with a count per role.',
      tier: 'read',
      permission: 'user.read',
      args: z.object({ activeOnly: z.boolean().default(true) }),
      run: async (ctx, args) => {
        const rows = await db
          .select({ name: users.name, role: users.role, isActive: users.isActive })
          .from(users)
          .where(and(eq(users.orgId, ctx.orgId), args.activeOnly ? eq(users.isActive, true) : undefined))
          .orderBy(users.createdAt);
        const perPeran: Record<string, number> = {};
        for (const r of rows) perPeran[r.role] = (perPeran[r.role] ?? 0) + 1;
        return { jumlah: rows.length, perPeran, anggota: rows.map((r) => ({ nama: r.name, peran: r.role, aktif: r.isActive })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_recent_activity',
      description: 'Lists the latest entries of the organization audit trail: when, who or what acted (user, AI or system), the action and the kind of record.',
      tier: 'read',
      permission: 'audit.read',
      args: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
      run: async (ctx, args) => {
        const hideFinancial = !can(ctx.role, 'audit.read_financial');
        const rows = await db
          .select({ at: auditLog.createdAt, actor: auditLog.actor, action: auditLog.action, entityType: auditLog.entityType })
          .from(auditLog)
          .where(and(eq(auditLog.orgId, ctx.orgId), hideFinancial ? notInArray(auditLog.entityType, FINANCIAL_ENTITIES) : undefined))
          .orderBy(desc(auditLog.createdAt))
          .limit(args.limit);
        return { jumlah: rows.length, aktivitas: rows.map((r) => ({ waktu: r.at.toISOString(), pelaku: who(r.actor), aksi: r.action, jenis: r.entityType })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'list_pending_approvals',
      description: 'Lists risky actions proposed by the AI that are still waiting for a human decision, with the tool, the reason and when the request expires.',
      tier: 'read',
      permission: 'finding.read_nonfinancial',
      args: z.object({}),
      run: async (ctx) => {
        const own = !can(ctx.role, 'approval.finance.decide');
        const rows = await db
          .select({ tool: approvals.tool, rationale: approvals.rationale, expiresAt: approvals.expiresAt, forName: users.name })
          .from(approvals)
          .leftJoin(users, and(eq(users.orgId, approvals.orgId), eq(users.id, approvals.requestedFor)))
          .where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.status, 'pending'), gt(approvals.expiresAt, ctx.clock.now()), own ? eq(approvals.requestedFor, ctx.userId) : undefined))
          .orderBy(approvals.expiresAt)
          .limit(20);
        return { jumlah: rows.length, daftar: rows.map((r) => ({ alat: r.tool, alasan: r.rationale, diminta_untuk: r.forName, kedaluwarsa: r.expiresAt.toISOString() })) };
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'describe_capabilities',
      description: 'Describes what this assistant can do: the tools available to the current user and what each one reads. Use it for questions about the assistant itself.',
      tier: 'read',
      permission: 'assistant.use',
      args: z.object({}),
      run: async (ctx) => ({
        alat: registry
          .list()
          .filter((t) => can(ctx.role, t.permission) && t.name !== 'report_out_of_scope')
          .map((t) => ({ nama: t.name, jenis: t.tier, fungsi: t.description })),
        catatan: 'Asisten hanya menjawab dari hasil alat di atas. Data bisnis lain (klien, invoice, lead) tersedia setelah modulnya dibangun.',
      }),
    }),
  );

  registry.register(
    defineTool({
      name: 'report_out_of_scope',
      description: 'Call this when no other tool can answer the question (general knowledge, chit-chat, anything not about this organization data). Never answer such a question yourself.',
      tier: 'read',
      permission: 'assistant.use',
      args: z.object({ reason: z.string().trim().min(1).max(200) }),
      run: async () => ({ outOfScope: true }),
    }),
  );

  return registry;
}
