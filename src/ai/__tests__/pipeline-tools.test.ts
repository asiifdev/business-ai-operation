import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../db/client';
import { approvals, clients, tasks } from '../../db/schema';
import { decideApproval, listPendingApprovals } from '../../domain/action-center/approvals';
import { makeOrg } from '../../domain/ai/__tests__/support';
import type { Ctx } from '../../domain/ctx';
import { createLead, getLead, moveLead } from '../../domain/pipeline/leads';
import { askAssistant } from '../assistant';
import { FakeProvider, callTools, say } from '../fake-provider';
import { buildAssistantRegistry } from '../tools/catalog';

afterAll(async () => {
  await pg.end();
});

const run = async (ctx: Ctx, name: string, args: Record<string, unknown> = {}) => {
  const tool = buildAssistantRegistry().get(name)!;
  return (await (tool.run as (c: Ctx, a: unknown) => Promise<Record<string, unknown>>)(ctx, tool.args.parse(args))) as Record<string, any>;
};
const ask = (ctx: Ctx, provider: FakeProvider, text: string) =>
  askAssistant(db, ctx, { request: { messages: [{ role: 'user', content: text }] }, organizationName: 'Orbit Studio', locale: 'id', provider });

async function wonLead(ctx: Ctx, name = 'Toko Sinar') {
  const { id } = await createLead(ctx, { name, estimatedValue: 5_000_000, contactName: 'Bu Sinta' });
  for (const stage of ['exploring', 'proposal', 'won'] as const) await moveLead(ctx, id, stage);
  return id;
}

describe('pipeline tools (BRD-M07: list_leads, get_pipeline_summary, convert_lead_to_client)', () => {
  it('list_leads and get_pipeline_summary read the same numbers as the board, drafts apart', async () => {
    const o = await makeOrg();
    await createLead(o.ownerCtx, { name: 'Klinik Sehat', estimatedValue: 2_000_000 });
    await createLead({ ...o.ownerCtx, actor: 'ai:run-1', aiRunId: 'run-1' }, { name: 'Dari Rekaman', estimatedValue: 8_000_000 });
    const list = await run(o.staffCtx, 'list_leads');
    expect(list.jumlah).toBe(2);
    expect(list.lead.find((l: { nama: string }) => l.nama === 'Dari Rekaman')).toMatchObject({ drafAI: true, tahap: 'baru' });
    const summary = await run(o.staffCtx, 'get_pipeline_summary');
    expect(summary.nilaiPipelineTerbuka.angka).toBe(2_000_000);
    expect(summary.drafAI).toBe(1);
  });

  it('the assistant only proposes the conversion; it happens once a manager approves', async () => {
    const o = await makeOrg();
    const leadId = await wonLead(o.ownerCtx);
    const fake = new FakeProvider({ chat: [callTools([{ name: 'convert_lead_to_client', args: { leadId } }]), say('Saya sudah mengajukan persetujuan untuk menjadikan Toko Sinar klien.')] });
    const reply = await ask(o.ownerCtx, fake, 'Jadikan Toko Sinar klien');
    expect(reply.pendingApprovals).toHaveLength(1);
    // Nothing changed yet.
    expect((await getLead(o.ownerCtx, leadId)).convertedClientId).toBeNull();

    const [card] = await listPendingApprovals(o.ownerCtx);
    expect(card).toMatchObject({ tool: 'convert_lead_to_client', canDecide: true, target: { kind: 'lead', leadId, name: 'Toko Sinar', stage: 'won', converted: false } });
    const result = await decideApproval(o.adminCtx, card.id, { decision: 'approve' });
    expect(result.executed).toBe(true);

    const lead = await getLead(o.ownerCtx, leadId);
    expect(lead.convertedClientId).not.toBeNull();
    const [client] = await db.select().from(clients).where(and(eq(clients.orgId, o.orgId), eq(clients.id, lead.convertedClientId!)));
    expect(client).toMatchObject({ name: 'Toko Sinar', contactName: 'Bu Sinta' });
    expect((await db.select().from(tasks).where(and(eq(tasks.orgId, o.orgId), eq(tasks.clientId, client.id)))).length).toBeGreaterThan(0);
  });

  it('is not offered to staff, and refuses a lead that is not won when approved', async () => {
    const o = await makeOrg();
    expect(buildAssistantRegistry().get('convert_lead_to_client')?.tier).toBe('act');
    const fake = new FakeProvider({ chat: [say('Halo')] });
    await ask(o.staffCtx, fake, 'Halo');
    expect(fake.chatCalls[0].tools?.map((t) => t.name)).not.toContain('convert_lead_to_client');

    const { id } = await createLead(o.ownerCtx, { name: 'Belum Menang' });
    const propose = new FakeProvider({ chat: [callTools([{ name: 'convert_lead_to_client', args: { leadId: id } }]), say('Diajukan.')] });
    await ask(o.ownerCtx, propose, 'Jadikan Belum Menang klien');
    const [row] = await db.select().from(approvals).where(and(eq(approvals.orgId, o.orgId), eq(approvals.tool, 'convert_lead_to_client')));
    const result = await decideApproval(o.ownerCtx, row.id, { decision: 'approve' });
    expect(result.executed).toBe(false);
    expect((await getLead(o.ownerCtx, id)).convertedClientId).toBeNull();
  });
});
