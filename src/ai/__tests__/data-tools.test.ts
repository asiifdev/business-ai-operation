import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../db/client';
import { approvals, clients, leads } from '../../db/schema';
import { decideApproval } from '../../domain/action-center/approvals';
import { makeOrg } from '../../domain/ai/__tests__/support';
import type { Ctx } from '../../domain/ctx';
import { createLead } from '../../domain/pipeline/leads';
import { askAssistant } from '../assistant';
import { FakeProvider, callTools, say } from '../fake-provider';
import { buildActionRegistry, DATA_ACT_TOOLS } from '../tools/actions';
import { buildAssistantRegistry } from '../tools/catalog';

afterAll(async () => {
  await pg.end();
});

const ask = (ctx: Ctx, provider: FakeProvider, text: string) =>
  askAssistant(db, ctx, { request: { messages: [{ role: 'user', content: text }] }, organizationName: 'Orbit Studio', locale: 'id', provider });

describe('data tools (D-077): the assistant adds and changes records only after a person approved', () => {
  it('registers every data tool as an act tool, in the assistant and in the registry approvals are decided from', () => {
    const assistant = buildAssistantRegistry();
    const decisions = buildActionRegistry();
    for (const tool of DATA_ACT_TOOLS) {
      expect(tool.tier, tool.name).toBe('act');
      expect(assistant.get(tool.name), tool.name).toBeDefined();
      expect(decisions.get(tool.name), tool.name).toBeDefined();
    }
    expect(assistant.get('mark_invoice_sent')?.tier).toBe('act');
  });

  it('turns create_client into a pending approval and creates nothing until it is approved', async () => {
    const o = await makeOrg();
    const fake = new FakeProvider({ chat: [callTools([{ name: 'create_client', args: { name: 'Toko Baru Jaya', contactName: 'Pak Budi' } }]), say('Saya ajukan penambahan klien.')] });
    const reply = await ask(o.ownerCtx, fake, 'Tambahkan klien Toko Baru Jaya');
    expect(reply.pendingApprovals).toHaveLength(1);
    expect(await db.select().from(clients).where(and(eq(clients.orgId, o.orgId), eq(clients.name, 'Toko Baru Jaya')))).toHaveLength(0);

    const [row] = await db.select().from(approvals).where(and(eq(approvals.orgId, o.orgId), eq(approvals.tool, 'create_client')));
    expect((await decideApproval(o.ownerCtx, row.id, { decision: 'approve' })).executed).toBe(true);
    expect(await db.select().from(clients).where(and(eq(clients.orgId, o.orgId), eq(clients.name, 'Toko Baru Jaya')))).toHaveLength(1);
  });

  it('does not create the client when the approval is rejected', async () => {
    const o = await makeOrg();
    const fake = new FakeProvider({ chat: [callTools([{ name: 'create_client', args: { name: 'Ditolak PT' } }]), say('Diajukan.')] });
    await ask(o.ownerCtx, fake, 'Tambahkan klien Ditolak PT');
    const [row] = await db.select().from(approvals).where(and(eq(approvals.orgId, o.orgId), eq(approvals.tool, 'create_client')));
    expect((await decideApproval(o.ownerCtx, row.id, { decision: 'reject' })).executed).toBe(false);
    expect(await db.select().from(clients).where(and(eq(clients.orgId, o.orgId), eq(clients.name, 'Ditolak PT')))).toHaveLength(0);
  });

  it('refuses a duplicate client at approval time and the approval ends rejected with the reason', async () => {
    const o = await makeOrg();
    for (const name of ['Sama Persis', 'Sama Persis']) {
      const fake = new FakeProvider({ chat: [callTools([{ name: 'create_client', args: { name } }]), say('Diajukan.')] });
      await ask(o.ownerCtx, fake, `Tambahkan ${name}`);
    }
    const rows = await db.select().from(approvals).where(and(eq(approvals.orgId, o.orgId), eq(approvals.tool, 'create_client')));
    expect(rows).toHaveLength(2);
    expect((await decideApproval(o.ownerCtx, rows[0].id, { decision: 'approve' })).executed).toBe(true);
    expect((await decideApproval(o.ownerCtx, rows[1].id, { decision: 'approve' })).executed).toBe(false);
    expect(await db.select().from(clients).where(and(eq(clients.orgId, o.orgId), eq(clients.name, 'Sama Persis')))).toHaveLength(1);
  });

  it('makes draft_lead a draft that stays out of the pipeline until a person accepts it', async () => {
    const o = await makeOrg();
    const fake = new FakeProvider({ chat: [callTools([{ name: 'draft_lead', args: { name: 'Calon Baru', estimatedValue: 3_000_000 } }]), say('Draf lead dibuat.')] });
    await ask(o.ownerCtx, fake, 'Catat calon klien Calon Baru');
    const [lead] = await db.select().from(leads).where(and(eq(leads.orgId, o.orgId), eq(leads.name, 'Calon Baru')));
    expect(lead.isDraft).toBe(true);
  });

  it('moves a lead through move_lead only after approval, as the approver (the service refuses an AI actor)', async () => {
    const o = await makeOrg();
    const { id } = await createLead(o.ownerCtx, { name: 'Pindah Tahap' });
    const fake = new FakeProvider({ chat: [callTools([{ name: 'move_lead', args: { leadId: id, to: 'exploring' } }]), say('Diajukan.')] });
    await ask(o.ownerCtx, fake, 'Pindahkan Pindah Tahap ke penjajakan');
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].stage).toBe('new');
    const [row] = await db.select().from(approvals).where(and(eq(approvals.orgId, o.orgId), eq(approvals.tool, 'move_lead')));
    expect((await decideApproval(o.ownerCtx, row.id, { decision: 'approve' })).executed).toBe(true);
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].stage).toBe('exploring');
  });

  it('tells the model why a tool was refused so it can explain and advise', async () => {
    const o = await makeOrg();
    const fake = new FakeProvider({ chat: [callTools([{ name: 'draft_lead', args: { name: 'X' } }]), say('Nama terlalu pendek, mau pakai nama lengkap?')] });
    await ask(o.ownerCtx, fake, 'Catat calon klien X');
    const message = (fake.chatCalls[1].messages.at(-1) as { content: string }).content;
    expect(JSON.parse(message)).toMatchObject({ error: 'argumen_tidak_valid' });
    expect(JSON.parse(message).rincian[0]).toContain('name');
  });
});
