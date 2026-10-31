import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { buildActionRegistry } from '../../../ai/tools/actions';
import { askAssistant } from '../../../ai/assistant';
import { FakeProvider, callTools, say } from '../../../ai/fake-provider';
import { db, pg } from '../../../db/client';
import { approvals, auditLog, clients, leads } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import type { Ctx } from '../../ctx';
import { DomainError } from '../../errors';
import { createLead, updateLead } from '../../pipeline/leads';
import { createClient, updateClient } from '../../portfolio/clients';
import { ACT_RISK, getAutonomy, mayAutoRun, setAutonomy, undoApproval } from '../autonomy';

afterAll(async () => {
  await pg.end();
});

const ask = (ctx: Ctx, provider: FakeProvider, text = 'tolong kerjakan') =>
  askAssistant(db, ctx, { request: { messages: [{ role: 'user', content: text }] }, organizationName: 'Orbit Studio', locale: 'id', provider });

describe('autonomy rules (D-082)', () => {
  it('gives every act tool a risk, and money, locking and servers always wait for a click', () => {
    for (const tool of buildActionRegistry().list()) expect(ACT_RISK[tool.name], tool.name).toBeDefined();
    for (const level of ['careful', 'balanced', 'autonomous'] as const) {
      for (const tool of ['create_subscription', 'mark_invoice_sent', 'finalize_document', 'start_flow_run']) expect(mayAutoRun(level, tool)).toBe(false);
    }
    expect(mayAutoRun('careful', 'update_client')).toBe(false);
    expect(mayAutoRun('balanced', 'update_client')).toBe(true);
    expect(mayAutoRun('balanced', 'convert_lead_to_client')).toBe(false);
    expect(mayAutoRun('autonomous', 'convert_lead_to_client')).toBe(true);
    expect(mayAutoRun('autonomous', 'a_tool_nobody_rated')).toBe(false);
  });

  it('is balanced by default, and only the Owner changes it (audited)', async () => {
    const o = await makeOrg();
    expect(await getAutonomy(o.orgId)).toBe('balanced');
    await expect(setAutonomy(o.adminCtx, { level: 'careful' })).rejects.toBeInstanceOf(DomainError);
    expect(await setAutonomy(o.ownerCtx, { level: 'careful' })).toEqual({ level: 'careful', changed: true });
    expect((await setAutonomy(o.ownerCtx, { level: 'careful' })).changed).toBe(false);
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'org.ai_autonomy_changed')));
    expect(rows).toHaveLength(1);
  });
});

describe('the assistant acts by itself for the person who asked (D-082)', () => {
  it('runs a low-risk action at once as that person, audits it, and keeps the approval row', async () => {
    const o = await makeOrg();
    const reply = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'create_client', args: { name: 'Toko Otomatis' } }]), say('Klien ditambahkan.')] }));
    expect(reply.pendingApprovals).toHaveLength(0);
    expect(reply.autoRan).toHaveLength(1);
    expect(reply.autoRan[0]).toMatchObject({ tool: 'create_client', executed: true, undoable: true });
    expect(await db.select().from(clients).where(and(eq(clients.orgId, o.orgId), eq(clients.name, 'Toko Otomatis')))).toHaveLength(1);

    const [row] = await db.select().from(approvals).where(and(eq(approvals.orgId, o.orgId), eq(approvals.tool, 'create_client')));
    expect(row).toMatchObject({ status: 'approved', autoRun: true, decidedBy: o.ownerCtx.userId });
    expect(row.executedAt).not.toBeNull();
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'approval.auto_executed')));
    expect(audit).toHaveLength(1);
  });

  it('does nothing by itself when careful', async () => {
    const o = await makeOrg();
    await setAutonomy(o.ownerCtx, { level: 'careful' });
    const reply = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'create_client', args: { name: 'Menunggu Klik' } }]), say('Diajukan.')] }));
    expect(reply.autoRan).toHaveLength(0);
    expect(reply.pendingApprovals).toHaveLength(1);
    expect(await db.select().from(clients).where(and(eq(clients.orgId, o.orgId), eq(clients.name, 'Menunggu Klik')))).toHaveLength(0);
  });

  it('still waits for a click on a high-risk action, even when autonomous', async () => {
    const o = await makeOrg();
    await setAutonomy(o.ownerCtx, { level: 'autonomous' });
    const { id: clientId } = await createClient(o.ownerCtx, { name: 'Klien Langganan' });
    const reply = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'create_subscription', args: { clientId, packageId: 'pkg-x' } }]), say('Diajukan.')] }));
    expect(reply.autoRan).toHaveLength(0);
    expect(reply.pendingApprovals).toHaveLength(1);
  });

  it('refuses to run by itself once the run has read text from the company profile (somebody else\'s words)', async () => {
    const o = await makeOrg();
    const reply = await ask(
      o.ownerCtx,
      new FakeProvider({ chat: [callTools([{ name: 'get_company_profile', args: {} }]), callTools([{ name: 'create_client', args: { name: 'Dari Teks Asing' } }]), say('Diajukan.')] }),
    );
    expect(reply.autoRan).toHaveLength(0);
    expect(reply.pendingApprovals).toHaveLength(1);
  });

  it('fails closed: after reading product descriptions (free text) nothing runs by itself, but after the client list it does', async () => {
    const o = await makeOrg();
    const viaProducts = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'list_products', args: {} }]), callTools([{ name: 'create_client', args: { name: 'Setelah Produk' } }]), say('Diajukan.')] }));
    expect(viaProducts.autoRan).toHaveLength(0);
    expect(viaProducts.pendingApprovals).toHaveLength(1);
    const viaClients = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'list_clients', args: {} }]), callTools([{ name: 'create_client', args: { name: 'Setelah Daftar Klien' } }]), say('Ditambah.')] }));
    expect(viaClients.autoRan).toHaveLength(1);
  });

  it('takes an edit back, and refuses when a person changed the record afterwards', async () => {
    const o = await makeOrg();
    const { id } = await createClient(o.ownerCtx, { name: 'Klien Asli', phone: '0811' });
    const reply = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'update_client', args: { clientId: id, phone: '0899' } }]), say('Diubah.')] }));
    expect(reply.autoRan[0]).toMatchObject({ executed: true, undoable: true });
    const approvalId = reply.autoRan[0].id;
    expect((await db.select().from(clients).where(eq(clients.id, id)))[0].phone).toBe('0899');

    expect(await undoApproval(o.ownerCtx, approvalId)).toEqual({ undone: true });
    expect((await db.select().from(clients).where(eq(clients.id, id)))[0].phone).toBe('0811');
    expect(await undoApproval(o.ownerCtx, approvalId)).toEqual({ undone: false, reason: 'already_undone' });

    const second = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'update_client', args: { clientId: id, phone: '0877' } }]), say('Diubah.')] }));
    await updateClient(o.ownerCtx, id, { phone: '0866' }); // a person edits after the assistant
    expect(await undoApproval(o.ownerCtx, second.autoRan[0].id)).toEqual({ undone: false, reason: 'changed_since' });
    expect((await db.select().from(clients).where(eq(clients.id, id)))[0].phone).toBe('0866');
  });

  it('takes back a lead move and archives a client the assistant added, never deleting it', async () => {
    const o = await makeOrg();
    const { id } = await createLead(o.ownerCtx, { name: 'Lead Pindah' });
    const moved = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'move_lead', args: { leadId: id, to: 'exploring' } }]), say('Dipindah.')] }));
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].stage).toBe('exploring');
    expect(await undoApproval(o.ownerCtx, moved.autoRan[0].id)).toEqual({ undone: true });
    expect((await db.select().from(leads).where(eq(leads.id, id)))[0].stage).toBe('new');

    const added = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'create_client', args: { name: 'Klien Salah' } }]), say('Ditambah.')] }));
    expect(await undoApproval(o.ownerCtx, added.autoRan[0].id)).toEqual({ undone: true });
    const [kept] = await db.select().from(clients).where(and(eq(clients.orgId, o.orgId), eq(clients.name, 'Klien Salah')));
    expect(kept.archivedAt).not.toBeNull();
  });

  it('keeps one organization\'s approvals away from another\'s and from other people\'s undo', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const { id } = await createLead(a.ownerCtx, { name: 'Milik A' });
    const r = await ask(a.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'update_lead', args: { leadId: id, name: 'Milik A Baru' } }]), say('Diubah.')] }));
    await expect(undoApproval(b.ownerCtx, r.autoRan[0].id)).rejects.toMatchObject({ code: 'not_found' });
    await updateLead(a.ownerCtx, id, { name: 'Milik A Baru' }); // unrelated edit with the same value changes nothing
    expect(await undoApproval(a.ownerCtx, r.autoRan[0].id)).toEqual({ undone: true });
  });

  it('a manual approval (not automatic) cannot be undone through the button', async () => {
    const o = await makeOrg();
    await setAutonomy(o.ownerCtx, { level: 'careful' });
    const reply = await ask(o.ownerCtx, new FakeProvider({ chat: [callTools([{ name: 'create_client', args: { name: 'Manual Saja' } }]), say('Diajukan.')] }));
    expect(await undoApproval(o.ownerCtx, reply.pendingApprovals[0].id)).toEqual({ undone: false, reason: 'nothing_to_undo' });
  });
});
