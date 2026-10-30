import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, clients, tasks } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import type { Ctx } from '../../ctx';
import { createClient } from '../../portfolio/clients';
import { acceptLeadDraft, convertLeadToClient, createLead, getLead, getLeadFormOptions, getPipelineSummary, listLeads, listStagnantLeads, moveLead, reopenLead, setLeadArchived, updateLead } from '../leads';

afterAll(async () => {
  await pg.end();
});

const aiCtx = (ctx: Ctx): Ctx => ({ ...ctx, actor: 'ai:run-1', aiRunId: 'run-1' });

/** Walks a lead from New to Negotiation so it can be won. */
async function toNegotiation(ctx: Ctx, id: string) {
  for (const stage of ['exploring', 'proposal', 'negotiation'] as const) await moveLead(ctx, id, stage);
}

describe('moving leads (BRD-M04 section 10)', () => {
  it('moves a lead through the stages and records each move', async () => {
    const o = await makeOrg();
    const { id } = await createLead(o.ownerCtx, { name: 'Toko Sinar', estimatedValue: 5_000_000 });
    await moveLead(o.ownerCtx, id, 'exploring');
    expect((await getLead(o.ownerCtx, id)).stage).toBe('exploring');
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.entityId, id), eq(auditLog.action, 'lead.stage_changed')));
    expect(audit).toHaveLength(1);
    expect(audit[0].summary).toMatchObject({ from: 'new', to: 'exploring' });
  });

  it('refuses an invalid transition and leaves the lead where it was', async () => {
    const o = await makeOrg();
    const { id } = await createLead(o.ownerCtx, { name: 'Toko Sinar' });
    await expect(moveLead(o.ownerCtx, id, 'won')).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(moveLead(o.ownerCtx, id, 'proposal')).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await getLead(o.ownerCtx, id)).stage).toBe('new');
  });

  it('refuses Lost without a reason, and keeps the reason once given', async () => {
    const o = await makeOrg();
    const { id } = await createLead(o.ownerCtx, { name: 'Toko Sinar' });
    await expect(moveLead(o.ownerCtx, id, 'lost')).rejects.toMatchObject({ code: 'validation' });
    await expect(moveLead(o.ownerCtx, id, 'lost', { lostReason: '   ' })).rejects.toMatchObject({ code: 'validation' });
    await moveLead(o.ownerCtx, id, 'lost', { lostReason: 'Anggaran belum ada' });
    const lead = await getLead(o.ownerCtx, id);
    expect(lead).toMatchObject({ stage: 'lost', lostReason: 'Anggaran belum ada', nextStages: [] });
  });

  it('reopens a closed lead only for a manager, with a note', async () => {
    const o = await makeOrg();
    const { id } = await createLead(o.ownerCtx, { name: 'Toko Sinar' });
    await moveLead(o.ownerCtx, id, 'lost', { lostReason: 'Harga' });
    await expect(reopenLead(o.ownerCtx, id, { note: '' })).rejects.toMatchObject({ code: 'validation' });
    await expect(reopenLead(o.staffCtx, id, { note: 'coba lagi' })).rejects.toMatchObject({ code: 'forbidden' });
    await reopenLead(o.adminCtx, id, { note: 'Klien menghubungi lagi', to: 'exploring' });
    expect(await getLead(o.ownerCtx, id)).toMatchObject({ stage: 'exploring', lostReason: null });
    await expect(reopenLead(o.ownerCtx, id, { note: 'x' })).rejects.toMatchObject({ code: 'invalid_state' }); // not closed any more
  });

  it('lets staff move only the leads assigned to them, and never close one', async () => {
    const o = await makeOrg();
    const mine = (await createLead(o.ownerCtx, { name: 'Milik Staf', assignedTo: o.staffCtx.userId })).id;
    const other = (await createLead(o.ownerCtx, { name: 'Bukan Milik Staf' })).id;
    await moveLead(o.staffCtx, mine, 'exploring');
    await expect(moveLead(o.staffCtx, other, 'exploring')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(moveLead(o.staffCtx, mine, 'lost', { lostReason: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
    await updateLead(o.staffCtx, mine, { needsSummary: 'Butuh kasir' });
    await expect(updateLead(o.staffCtx, mine, { assignedTo: null })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createLead(o.staffCtx, { name: 'Baru' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await listLeads(o.staffCtx)).toHaveLength(2); // staff can see the whole pipeline
  });

  it('assigns a lead only to an active person of the same organization', async () => {
    const o = await makeOrg();
    const other = await makeOrg();
    await expect(createLead(o.ownerCtx, { name: 'Salah orang', assignedTo: other.ownerCtx.userId })).rejects.toMatchObject({ code: 'validation' });
    const { id } = await createLead(o.ownerCtx, { name: 'Benar', assignedTo: o.staffCtx.userId });
    expect((await getLead(o.ownerCtx, id)).assigneeName).toEqual(expect.any(String));
    await expect(updateLead(o.ownerCtx, id, { assignedTo: other.ownerCtx.userId })).rejects.toMatchObject({ code: 'validation' });
    expect((await getLeadFormOptions(o.ownerCtx)).assignees.map((a) => a.id)).toContain(o.staffCtx.userId);
    expect((await getLeadFormOptions(o.staffCtx)).assignees).toEqual([]);
  });

  it('does not let an AI run move a lead, only suggest', async () => {
    const o = await makeOrg();
    const { id } = await createLead(o.ownerCtx, { name: 'Toko Sinar' });
    await expect(moveLead(aiCtx(o.ownerCtx), id, 'exploring')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('AI drafts and pipeline value (BR-M04-06, -07)', () => {
  it('keeps an AI lead out of the pipeline value until a person accepts it', async () => {
    const o = await makeOrg();
    await createLead(o.ownerCtx, { name: 'Manual', estimatedValue: 2_000_000 });
    const draft = await createLead(aiCtx(o.ownerCtx), { name: 'Dari Rekaman', estimatedValue: 8_000_000 });

    expect((await getLead(o.ownerCtx, draft.id)).isDraft).toBe(true);
    expect(await getPipelineSummary(o.ownerCtx)).toMatchObject({ value: 2_000_000, drafts: 1 });
    await expect(moveLead(o.ownerCtx, draft.id, 'exploring')).rejects.toMatchObject({ code: 'invalid_state' });

    await acceptLeadDraft(o.ownerCtx, draft.id);
    expect(await getPipelineSummary(o.ownerCtx)).toMatchObject({ value: 10_000_000, drafts: 0 });
    await moveLead(o.ownerCtx, draft.id, 'exploring');
  });

  it('counts only open stages and drops archived leads', async () => {
    const o = await makeOrg();
    await createLead(o.ownerCtx, { name: 'Lead Aktif', estimatedValue: 1_000_000 });
    const b = (await createLead(o.ownerCtx, { name: 'Lead Batal', estimatedValue: 4_000_000 })).id;
    const c = (await createLead(o.ownerCtx, { name: 'Lead Arsip', estimatedValue: 3_000_000 })).id;
    await moveLead(o.ownerCtx, b, 'lost', { lostReason: 'Batal' });
    await setLeadArchived(o.ownerCtx, c, true);
    const summary = await getPipelineSummary(o.ownerCtx);
    expect(summary.value).toBe(1_000_000);
    expect(summary.perStage.find((s) => s.stage === 'new')).toEqual({ stage: 'new', count: 1, value: 1_000_000 });
  });

  it('rejects a negative or fractional estimated value', async () => {
    const o = await makeOrg();
    await expect(createLead(o.ownerCtx, { name: 'Minus', estimatedValue: -1 })).rejects.toThrow();
    await expect(createLead(o.ownerCtx, { name: 'Pecahan', estimatedValue: 1500.5 })).rejects.toThrow();
  });
});

describe('stagnant leads (BR-M04-08)', () => {
  it('flags an open lead after the organization threshold and lists it for the Action Center', async () => {
    const o = await makeOrg('2026-10-01T03:00:00Z');
    const { id } = await createLead(o.ownerCtx, { name: 'Diam' });
    await createLead(aiCtx(o.ownerCtx), { name: 'Draf diam' });
    expect((await getLead(o.ownerCtx, id)).isStagnant).toBe(false);
    o.clock.set('2026-10-20T03:00:00Z'); // 19 days later
    expect((await getLead(o.ownerCtx, id)).isStagnant).toBe(true);
    expect((await listStagnantLeads(o.orgId, o.clock.now())).map((l) => l.id)).toEqual([id]);
    await moveLead(o.ownerCtx, id, 'exploring'); // activity resets the clock
    expect((await getLead(o.ownerCtx, id)).isStagnant).toBe(false);
  });
});

describe('converting a won lead (BR-M04-04, -05, -09)', () => {
  it('creates nothing until the lead is won, and by a manager only', async () => {
    const o = await makeOrg();
    const { id } = await createLead(o.ownerCtx, { name: 'Kopi Fajar' });
    await expect(convertLeadToClient(o.ownerCtx, id, { mode: 'create' })).rejects.toMatchObject({ code: 'invalid_state' });
    await toNegotiation(o.ownerCtx, id);
    await moveLead(o.ownerCtx, id, 'won');
    await expect(convertLeadToClient(o.staffCtx, id, { mode: 'create' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await db.select().from(clients).where(eq(clients.orgId, o.orgId))).toHaveLength(0);
  });

  it('creates the client and the onboarding checklist, once', async () => {
    const o = await makeOrg('2026-10-28T03:00:00Z');
    const { id } = await createLead(o.ownerCtx, { name: 'Kopi  Fajar', contactName: 'Fajar', email: 'Fajar@Example.test', needsSummary: 'Butuh kasir dan stok' });
    await toNegotiation(o.ownerCtx, id);
    await moveLead(o.ownerCtx, id, 'won');

    const out = await convertLeadToClient(o.ownerCtx, id, { mode: 'create' });
    expect(out.tasksCreated).toBe(4);
    const [client] = await db.select().from(clients).where(and(eq(clients.orgId, o.orgId), eq(clients.id, out.clientId)));
    expect(client).toMatchObject({ name: 'Kopi Fajar', contactName: 'Fajar', email: 'fajar@example.test', notes: 'Butuh kasir dan stok' });
    const todo = await db.select().from(tasks).where(and(eq(tasks.orgId, o.orgId), eq(tasks.leadId, id)));
    expect(todo.map((t) => t.title)).toContain('Buat langganan');
    expect(todo.every((t) => t.clientId === out.clientId && t.status === 'open' && !t.isDraft && t.dueDate)).toBe(true);
    expect((await getLead(o.ownerCtx, id)).convertedClientId).toBe(out.clientId);

    await expect(convertLeadToClient(o.ownerCtx, id, { mode: 'create' })).rejects.toMatchObject({ code: 'invalid_state' }); // never twice
    expect(await db.select().from(tasks).where(and(eq(tasks.orgId, o.orgId), eq(tasks.leadId, id)))).toHaveLength(4);
    await expect(reopenLead(o.ownerCtx, id, { note: 'salah' })).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('offers linking instead of a duplicate when the client name already exists', async () => {
    const o = await makeOrg();
    const existing = await createClient(o.ownerCtx, { name: 'Kopi Fajar' });
    const { id } = await createLead(o.ownerCtx, { name: 'kopi fajar' });
    await toNegotiation(o.ownerCtx, id);
    await moveLead(o.ownerCtx, id, 'won');

    await expect(convertLeadToClient(o.ownerCtx, id, { mode: 'create' })).rejects.toMatchObject({ code: 'duplicate' });
    // The failed attempt left nothing behind.
    expect(await db.select().from(tasks).where(eq(tasks.orgId, o.orgId))).toHaveLength(0);
    expect((await getLead(o.ownerCtx, id)).convertedClientId).toBeNull();

    const out = await convertLeadToClient(o.ownerCtx, id, { mode: 'link', clientId: existing.id }, { locale: 'en' });
    expect(out.clientId).toBe(existing.id);
    expect(await db.select().from(clients).where(eq(clients.orgId, o.orgId))).toHaveLength(1);
    const todo = await db.select().from(tasks).where(eq(tasks.orgId, o.orgId));
    expect(todo.map((t) => t.title)).toContain('Create the subscription');
  });

  it("cannot link to another organization's client", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const foreign = await createClient(b.ownerCtx, { name: 'Klien Org Lain' });
    const { id } = await createLead(a.ownerCtx, { name: 'Lead A' });
    await toNegotiation(a.ownerCtx, id);
    await moveLead(a.ownerCtx, id, 'won');
    await expect(convertLeadToClient(a.ownerCtx, id, { mode: 'link', clientId: foreign.id })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('tenant isolation (CR-02)', () => {
  it('never shows or touches another organization’s leads', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const { id } = await createLead(a.ownerCtx, { name: 'Rahasia A' });
    expect(await listLeads(b.ownerCtx)).toHaveLength(0);
    await expect(getLead(b.ownerCtx, id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(moveLead(b.ownerCtx, id, 'exploring')).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateLead(b.ownerCtx, id, { name: 'Diubah' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
