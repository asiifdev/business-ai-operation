import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeProvider, say } from '../../../ai/fake-provider';
import { db, pg } from '../../../db/client';
import { auditLog, documents } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createClient } from '../../portfolio/clients';
import { createPackage, createProduct, updatePackage } from '../../portfolio/products';
import { userCtx } from '../../ctx';
import { draftNarrative } from '../narrative';
import { createDocument, deleteDraft, finalizeDocument, getDocument, listDocuments, reviseDocument, updateDraft } from '../service';

afterAll(async () => {
  await pg.end();
});

const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};
const dbRejects = async (promise: Promise<unknown>, pattern: RegExp) => {
  const err = (await promise.then(() => null, (e: unknown) => e)) as { message?: string; cause?: { message?: string } } | null;
  expect(err, 'the database should refuse').not.toBeNull();
  expect([err?.message, err?.cause?.message].join(' ')).toMatch(pattern);
};

async function seed() {
  const o = await makeOrg();
  const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
  const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });
  const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
  return { o, packageId: pkg.id, clientId: client.id };
}
const proposal = (s: { clientId: string; packageId: string }, over: Record<string, unknown> = {}) => ({ kind: 'proposal' as const, title: 'Proposal Orbit CRM', clientId: s.clientId, items: [{ packageId: s.packageId, quantity: 3 }], ...over });

describe('M06 documents', () => {
  it('copies the official package price and computes totals in code (BR-M06-01, -06)', async () => {
    const s = await seed();
    const { id, total } = await createDocument(s.o.ownerCtx, proposal(s));
    const d = await getDocument(s.o.ownerCtx, id);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ quantity: 3, unitPrice: 450_000, lineTotal: 1_350_000, packageId: s.packageId });
    expect(d.subtotal + d.taxAmount).toBe(total);
    expect(d.status).toBe('draft');
    expect(d.number).toBeNull();
  });

  it('a later price change does not touch an existing draft, and editing the narrative does not change the total', async () => {
    const s = await seed();
    const { id, total } = await createDocument(s.o.ownerCtx, proposal(s));
    await updatePackage(s.o.ownerCtx, s.packageId, { monthlyPrice: 1 });
    await updateDraft(s.o.ownerCtx, id, { narrative: 'Ganti harga menjadi 1 rupiah.' });
    const d = await getDocument(s.o.ownerCtx, id);
    expect(d.total).toBe(total);
    expect(d.items[0].unitPrice).toBe(450_000);
  });

  it('changing the items recomputes the total through the service', async () => {
    const s = await seed();
    const { id } = await createDocument(s.o.ownerCtx, proposal(s));
    await updateDraft(s.o.ownerCtx, id, { items: [{ description: 'Setup', quantity: 1, unitPrice: 2_000_000 }] });
    expect((await getDocument(s.o.ownerCtx, id)).subtotal).toBe(2_000_000);
  });

  it('finalizes with a sequential number per kind, then refuses any edit (BR-M06-02, -04)', async () => {
    const s = await seed();
    const a = await createDocument(s.o.ownerCtx, proposal(s));
    const b = await createDocument(s.o.ownerCtx, proposal(s));
    const q = await createDocument(s.o.ownerCtx, proposal(s, { kind: 'quotation' }));
    const year = new Date().getFullYear();
    expect((await finalizeDocument(s.o.ownerCtx, a.id)).number).toBe(`PRO-${year}-0001`);
    expect((await finalizeDocument(s.o.ownerCtx, b.id)).number).toBe(`PRO-${year}-0002`);
    expect((await finalizeDocument(s.o.ownerCtx, q.id)).number).toBe(`QUO-${year}-0001`);
    await rejects(updateDraft(s.o.ownerCtx, a.id, { title: 'Ubah' }), 'invalid_state');
    await rejects(finalizeDocument(s.o.ownerCtx, a.id), 'invalid_state');
    await rejects(deleteDraft(s.o.ownerCtx, a.id), 'invalid_state');
    // The database refuses too, even around the service.
    await dbRejects(db.update(documents).set({ title: 'x' }).where(and(eq(documents.orgId, s.o.ownerCtx.orgId), eq(documents.id, a.id))), /final/);
  });

  it('a revision is a new draft in the same series, and keeps the old version intact (BR-M06-02)', async () => {
    const s = await seed();
    const a = await createDocument(s.o.ownerCtx, proposal(s));
    const { number } = await finalizeDocument(s.o.ownerCtx, a.id);
    const rev = await reviseDocument(s.o.ownerCtx, a.id);
    expect(rev.version).toBe(2);
    await rejects(reviseDocument(s.o.ownerCtx, a.id), 'invalid_state'); // one revision in progress at a time
    const draft = await getDocument(s.o.ownerCtx, rev.id);
    expect(draft).toMatchObject({ status: 'draft', number: null, total: (await getDocument(s.o.ownerCtx, a.id)).total });
    expect(draft.items).toHaveLength(1);
    await updateDraft(s.o.ownerCtx, rev.id, { title: 'Proposal v2' });
    expect((await finalizeDocument(s.o.ownerCtx, rev.id)).number).toBe(`${number}-v2`);
    expect((await getDocument(s.o.ownerCtx, a.id)).title).toBe('Proposal Orbit CRM');
    expect((await getDocument(s.o.ownerCtx, rev.id)).versions.map((v) => v.version)).toEqual([1, 2]);
    expect((await listDocuments(s.o.ownerCtx)).map((d) => d.version)).toEqual([2]);
    expect(await listDocuments(s.o.ownerCtx, { allVersions: true })).toHaveLength(2);
  });

  it('refuses a document with no amount, an archived-package line and a missing client', async () => {
    const s = await seed();
    const free = await createDocument(s.o.ownerCtx, proposal(s, { items: [{ description: 'Gratis', quantity: 1, unitPrice: 0 }] }));
    await rejects(finalizeDocument(s.o.ownerCtx, free.id), 'validation');
    await rejects(createDocument(s.o.ownerCtx, proposal(s, { clientId: 'nope' })), 'not_found');
    await rejects(createDocument(s.o.ownerCtx, proposal(s, { items: [{ packageId: 'nope', quantity: 1 }] })), 'not_found');
  });

  it('staff may read but not write or finalize; another organization sees nothing', async () => {
    const s = await seed();
    const { id } = await createDocument(s.o.ownerCtx, proposal(s));
    const staff = userCtx({ orgId: s.o.ownerCtx.orgId, userId: 'staff-1', role: 'staff' });
    expect((await getDocument(staff, id)).id).toBe(id);
    await rejects(createDocument(staff, proposal(s)), 'forbidden');
    await rejects(finalizeDocument(staff, id), 'forbidden');
    const other = await makeOrg();
    await rejects(getDocument(other.ownerCtx, id), 'not_found');
    expect(await listDocuments(other.ownerCtx)).toEqual([]);
  });

  it('flags an assistant draft until a person saves it, and audits every step (BR-M06-05, -10)', async () => {
    const s = await seed();
    const aiCtx = { ...s.o.ownerCtx, actor: 'ai:run-1' as const, aiRunId: undefined };
    const { id } = await createDocument(aiCtx, proposal(s));
    expect((await getDocument(s.o.ownerCtx, id)).isAiDraft).toBe(true);
    await updateDraft(s.o.ownerCtx, id, { title: 'Proposal Orbit CRM final' });
    expect((await getDocument(s.o.ownerCtx, id)).isAiDraft).toBe(false);
    await finalizeDocument(s.o.ownerCtx, id);
    const actions = (await db.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.orgId, s.o.ownerCtx.orgId), eq(auditLog.entityId, id)))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['document.created', 'document.updated', 'document.finalized']));
  });

  it('keeps a narrative that has no figures and drops one with an invented price (BR-M06-01)', async () => {
    const s = await seed();
    const { id } = await createDocument(s.o.ownerCtx, proposal(s));
    const good = await draftNarrative(s.o.ownerCtx, id, new FakeProvider({ chat: [say('Kami menawarkan Orbit CRM paket Bisnis untuk Aksara Studio.')] }));
    expect(good.ok).toBe(true);
    expect(await getDocument(s.o.ownerCtx, id)).toMatchObject({ narrative: 'Kami menawarkan Orbit CRM paket Bisnis untuk Aksara Studio.', isAiDraft: true });
    const bad = await draftNarrative(s.o.ownerCtx, id, new FakeProvider({ chat: [say('Harga spesial Rp 1 saja.')] }));
    expect(bad.ok).toBe(false);
    expect((await getDocument(s.o.ownerCtx, id)).narrative).toBe('Kami menawarkan Orbit CRM paket Bisnis untuk Aksara Studio.');
  });
});
