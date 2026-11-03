import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../db/client';
import { approvals, clients, leads, organizations, packages, products } from '../../db/schema';
import { decideApproval } from '../../domain/action-center/approvals';
import { makeOrg } from '../../domain/ai/__tests__/support';
import type { Ctx } from '../../domain/ctx';
import { getInvoice, listInvoices } from '../../domain/billing/invoices';
import { createLead } from '../../domain/pipeline/leads';
import { createClient } from '../../domain/portfolio/clients';
import { createProduct } from '../../domain/portfolio/products';
import { setAutonomy } from '../../domain/action-center/autonomy';
import { askAssistant } from '../assistant';
import { FakeProvider, callTools, say } from '../fake-provider';
import { buildActionRegistry, DATA_ACT_TOOLS } from '../tools/actions';
import { buildAssistantRegistry } from '../tools/catalog';

afterAll(async () => {
  await pg.end();
});

// These tests cover the click-to-approve path, so the organization is `careful` (D-082). The automatic path is in autonomy.test.ts.
const ask = async (ctx: Ctx, provider: FakeProvider, text: string) => {
  await db.update(organizations).set({ aiAutonomy: 'careful' }).where(eq(organizations.id, ctx.orgId));
  return askAssistant(db, ctx, { request: { messages: [{ role: 'user', content: text }] }, organizationName: 'Orbit Studio', locale: 'id', provider });
};

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

  it('proposes a product with all its packages in ONE call, always waits for a click, and creates it whole on approval', async () => {
    const o = await makeOrg();
    await setAutonomy(o.ownerCtx, { level: 'autonomous' }); // even then: prices wait for a person
    const args = { name: 'POS Toko Makmur', packages: [{ name: 'Basic', monthlyPrice: 100_000 }, { name: 'Premium', monthlyPrice: 400_000, features: '3 outlet' }] };
    const fake = new FakeProvider({ chat: [callTools([{ name: 'create_product', args }]), say('Produk beserta paketnya saya ajukan.')] });
    const reply = await askAssistant(db, o.ownerCtx, { request: { messages: [{ role: 'user', content: 'Input produk POS Toko Makmur dengan paketnya' }] }, organizationName: 'Orbit Studio', locale: 'id', provider: fake });
    expect(reply.autoRan).toHaveLength(0);
    expect(reply.pendingApprovals).toHaveLength(1);
    expect(await db.select().from(products).where(eq(products.orgId, o.orgId))).toHaveLength(0);

    const [row] = await db.select().from(approvals).where(and(eq(approvals.orgId, o.orgId), eq(approvals.tool, 'create_product')));
    // The approver sees every name and price before deciding.
    expect(row.rationale).toContain('Premium Rp');
    expect(row.rationale).toContain('2 paket');
    expect((await decideApproval(o.ownerCtx, row.id, { decision: 'approve' })).executed).toBe(true);
    const [product] = await db.select().from(products).where(eq(products.orgId, o.orgId));
    const made = await db.select().from(packages).where(eq(packages.productId, product.id));
    expect(made.map((p) => [p.name, p.monthlyPrice]).sort()).toEqual([['Basic', 100_000], ['Premium', 400_000]]);
  });

  it('adds and changes a package of an existing product only after approval', async () => {
    const o = await makeOrg();
    const { id: productId } = await createProduct(o.ownerCtx, { name: 'POS Lama' });
    const add = new FakeProvider({ chat: [callTools([{ name: 'create_package', args: { productId, name: 'Premium', monthlyPrice: 400_000 } }]), say('Diajukan.')] });
    expect((await ask(o.ownerCtx, add, 'Tambahkan paket Premium')).pendingApprovals).toHaveLength(1);
    expect(await db.select().from(packages).where(eq(packages.productId, productId))).toHaveLength(0);
    const [created] = await db.select().from(approvals).where(and(eq(approvals.orgId, o.orgId), eq(approvals.tool, 'create_package')));
    expect((await decideApproval(o.ownerCtx, created.id, { decision: 'approve' })).executed).toBe(true);
    const [pkg] = await db.select().from(packages).where(eq(packages.productId, productId));

    const change = new FakeProvider({ chat: [callTools([{ name: 'update_package', args: { packageId: pkg.id, monthlyPrice: 450_000 } }]), say('Diajukan.')] });
    expect((await ask(o.ownerCtx, change, 'Naikkan harga Premium')).pendingApprovals).toHaveLength(1);
    const [changed] = await db.select().from(approvals).where(and(eq(approvals.orgId, o.orgId), eq(approvals.tool, 'update_package')));
    expect((await decideApproval(o.ownerCtx, changed.id, { decision: 'approve' })).executed).toBe(true);
    expect((await db.select().from(packages).where(eq(packages.id, pkg.id)))[0].monthlyPrice).toBe(450_000);
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
    const reply = await ask(o.ownerCtx, fake, 'Catat calon klien Calon Baru');
    const [lead] = await db.select().from(leads).where(and(eq(leads.orgId, o.orgId), eq(leads.name, 'Calon Baru')));
    expect(lead.isDraft).toBe(true);
    // The reply carries the draft, so the interface can link straight to it.
    expect(reply.drafts).toEqual([{ tool: 'draft_lead', id: lead.id }]);
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

  it('sets the due date of a draft invoice itself (14 days from today) when the person named none, instead of asking for a date format', async () => {
    const o = await makeOrg();
    const { id: clientId } = await createClient(o.ownerCtx, { name: 'Toko Tanpa Tanggal' });
    const fake = new FakeProvider({ chat: [callTools([{ name: 'draft_invoice', args: { clientId, items: [{ description: 'Maintenance bulanan', quantity: 1, unitPrice: 1_500_000 }] } }]), say('Draf invoice dibuat.')] });
    await ask(o.ownerCtx, fake, 'Buatkan draf invoice maintenance 1,5 juta untuk Toko Tanpa Tanggal');
    const [row] = await listInvoices(o.ownerCtx, { clientId });
    const detail = await getInvoice(o.ownerCtx, row.id);
    const days = Math.round((Date.parse(detail.invoice.dueDate) - o.ownerCtx.clock.now().getTime()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(13);
    expect(days).toBeLessThanOrEqual(14);
  });

  it('keeps the work and says so when the model\'s own words had to be dropped (numbers no tool returned), instead of "no data"', async () => {
    const o = await makeOrg();
    // The model writes a figure no tool returned and then repeats it after one correction: its words are dropped, the draft stays.
    const fake = new FakeProvider({ chat: [callTools([{ name: 'draft_lead', args: { name: 'Calon Angka' } }]), say('Lead dibuat, target 777 pelanggan.'), say('Lead dibuat, target 777 pelanggan.')] });
    const reply = await ask(o.ownerCtx, fake, 'Catat calon klien Calon Angka');
    expect(reply.refused).toBe(true);
    expect(reply.text).toMatch(/Sudah saya kerjakan/);
    expect(reply.drafts).toHaveLength(1);
  });

  it('accepts a number the person typed themselves when the assistant repeats it', async () => {
    const o = await makeOrg();
    const fake = new FakeProvider({ chat: [callTools([{ name: 'draft_lead', args: { name: 'Calon Echo' } }]), say('Draf lead Calon Echo dibuat, target 777 pelanggan seperti Anda sebut.')] });
    const reply = await ask(o.ownerCtx, fake, 'Catat calon klien Calon Echo dengan target 777 pelanggan');
    expect(reply.refused).toBe(false);
    expect(reply.text).toMatch(/777/);
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
