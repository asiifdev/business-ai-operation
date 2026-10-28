import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../db/client';
import { makeOrg } from '../../domain/ai/__tests__/support';
import type { Ctx } from '../../domain/ctx';
import { createClient } from '../../domain/portfolio/clients';
import { createDeployment } from '../../domain/portfolio/deployments';
import { createPackage, createProduct, updateProduct } from '../../domain/portfolio/products';
import { askAssistant } from '../assistant';
import { FakeProvider, callTools, say } from '../fake-provider';
import { buildAssistantRegistry } from '../tools/catalog';

afterAll(async () => {
  await pg.end();
});

const run = async (ctx: Ctx, name: string, args: Record<string, unknown> = {}) => {
  const tool = buildAssistantRegistry().get(name)!;
  return (await (tool.run as (c: Ctx, a: unknown) => Promise<Record<string, any>>)(ctx, tool.args.parse(args))) as Record<string, any>;
};

async function world() {
  const o = await makeOrg();
  const crm = (await createProduct(o.ownerCtx, { name: 'Orbit CRM', currentVersion: '2.0.0' })).id;
  const pos = (await createProduct(o.ownerCtx, { name: 'Orbit POS', currentVersion: '1.4.0' })).id;
  await createPackage(o.ownerCtx, crm, { name: 'Starter', monthlyPrice: 150_000, features: 'Satu pengguna' });
  await createPackage(o.ownerCtx, crm, { name: 'Bisnis', monthlyPrice: 450_000 });
  const aksara = (await createClient(o.ownerCtx, { name: 'Aksara Studio', contactName: 'Rina', email: 'rina@aksara.test' })).id;
  const kopi = (await createClient(o.ownerCtx, { name: 'Kopi Senja', notes: 'Pelanggan lama' })).id;
  await createDeployment(o.ownerCtx, { productId: crm, clientId: aksara, installedVersion: '1.9.0', domain: 'crm.aksara.test' });
  await createDeployment(o.ownerCtx, { productId: pos, clientId: aksara, installedVersion: '1.4.0' });
  await createDeployment(o.ownerCtx, { productId: crm, clientId: kopi, installedVersion: '2.0.0' });
  return { o, crm, pos, aksara, kopi };
}

describe('portfolio tools read the real data of the organization', () => {
  it('list_clients finds clients, counts deployments and how many are behind', async () => {
    const { o } = await world();
    const all = await run(o.staffCtx, 'list_clients');
    expect(all.klien.map((c: { nama: string }) => c.nama)).toEqual(['Aksara Studio', 'Kopi Senja']);
    expect(all.klien[0]).toMatchObject({ jumlahDeployment: 2, deploymentTertinggal: 1, kontak: 'Rina', email: 'rina@aksara.test' });
    expect(all.klien[1]).toMatchObject({ jumlahDeployment: 1, deploymentTertinggal: 0 });
    expect((await run(o.staffCtx, 'list_clients', { search: 'kopi' })).klien).toHaveLength(1);
  });

  it('get_client_overview gives the client with every deployment and its version state', async () => {
    const { o, aksara } = await world();
    const view = await run(o.staffCtx, 'get_client_overview', { clientId: aksara });
    expect(view).toMatchObject({ nama: 'Aksara Studio', kontak: 'Rina' });
    expect(view.deployment.map((d: any) => [d.produk, d.versiTerpasang, d.versiProdukSaatIni, d.versi])).toEqual([
      ['Orbit CRM', '1.9.0', '2.0.0', 'tertinggal'],
      ['Orbit POS', '1.4.0', '1.4.0', 'terbaru'],
    ]);
  });

  it('get_product_packages returns the official prices both formatted and as integers', async () => {
    const { o, crm } = await world();
    const out = await run(o.staffCtx, 'get_product_packages', { productId: crm });
    expect(out.paket.map((p: any) => [p.nama, p.hargaPerBulan, p.hargaPerBulanAngka])).toEqual([['Starter', 'Rp 150.000', 150000], ['Bisnis', 'Rp 450.000', 450000]]);
  });

  it('list_deployments can show only what is behind, and list_products counts it', async () => {
    const { o, crm } = await world();
    const behind = await run(o.ownerCtx, 'list_deployments', { behindOnly: true });
    expect(behind.deployment.map((d: any) => [d.klien, d.produk])).toEqual([['Aksara Studio', 'Orbit CRM']]);
    await updateProduct(o.ownerCtx, crm, { currentVersion: '2.1.0' });
    expect((await run(o.ownerCtx, 'list_deployments', { behindOnly: true })).jumlah).toBe(2);
    const products = await run(o.ownerCtx, 'list_products');
    expect(products.produk.find((p: any) => p.nama === 'Orbit CRM')).toMatchObject({ versiSaatIni: '2.1.0', jumlahPaket: 2, jumlahDeployment: 2, deploymentTertinggal: 2 });
  });

  it('never shows another organization data, and an id from another organization is simply not found', async () => {
    const a = await world();
    const b = await makeOrg();
    expect((await run(b.ownerCtx, 'list_clients')).jumlah).toBe(0);
    expect((await run(b.ownerCtx, 'list_products')).jumlah).toBe(0);
    await expect(run(b.ownerCtx, 'get_client_overview', { clientId: a.aksara })).rejects.toMatchObject({ code: 'not_found' });
    await expect(run(b.ownerCtx, 'get_product_packages', { productId: a.crm })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('has no tool that can change the portfolio', () => {
    const names = buildAssistantRegistry().list().map((t) => t.name);
    expect(names.filter((n) => /^(create|update|delete|archive|set|add|remove)_/.test(n))).toEqual([]);
    // The only tool that is not read-only is the billing draft: it prepares an unsent invoice and touches no portfolio data.
    expect(buildAssistantRegistry().list().filter((t) => t.tier !== 'read').map((t) => [t.name, t.tier])).toEqual([['draft_invoice', 'draft']]);
  });
});

describe('the assistant answers portfolio questions from these tools and nothing else', () => {
  it('answers a behind-version question with the names and versions the tool returned', async () => {
    const { o } = await world();
    const fake = new FakeProvider({
      chat: [
        callTools([{ name: 'list_deployments', args: { behindOnly: true } }]),
        say('Aksara Studio memakai Orbit CRM 1.9.0, sedangkan versi saat ini 2.0.0 (tertinggal). Sumber: list_deployments.'),
      ],
    });
    const reply = await askAssistant(db, o.ownerCtx, { request: { messages: [{ role: 'user', content: 'Klien mana yang tertinggal versi?' }] }, organizationName: 'Orbit Studio', locale: 'id', provider: fake });
    expect(reply).toMatchObject({ ok: true, refused: false, sources: ['list_deployments'] });
    expect(reply.text).toContain('Aksara Studio');
  });

  it('refuses a price the tool did not return, so a made-up price never reaches the screen', async () => {
    const { o, crm } = await world();
    const fake = new FakeProvider({
      chat: [
        callTools([{ name: 'get_product_packages', args: { productId: crm } }]),
        say('Paket Starter Rp 99.000 per bulan.'),
        say('Paket Starter Rp 99.000 per bulan.'),
      ],
    });
    const reply = await askAssistant(db, o.ownerCtx, { request: { messages: [{ role: 'user', content: 'Berapa harga Starter?' }] }, organizationName: 'Orbit Studio', locale: 'id', provider: fake });
    expect(reply).toMatchObject({ refused: true, refusalReason: 'unverified_numbers' });
    expect(reply.text).not.toContain('99.000');
  });

  it('accepts the real price formatted either way', async () => {
    const { o, crm } = await world();
    const fake = new FakeProvider({ chat: [callTools([{ name: 'get_product_packages', args: { productId: crm } }]), say('Starter: Rp 150.000 per bulan. Bisnis: 450000 per bulan.')] });
    const reply = await askAssistant(db, o.ownerCtx, { request: { messages: [{ role: 'user', content: 'Harga paket CRM?' }] }, organizationName: 'Orbit Studio', locale: 'id', provider: fake });
    expect(reply).toMatchObject({ ok: true, refused: false, sources: ['get_product_packages'] });
    expect(reply.text).toContain('150.000');
  });
});
