import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, clients, deployments, packages, products } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createClient, deleteClient, getClient360, listClients, setClientArchived, updateClient } from '../clients';
import { createDeployment, deleteDeployment, listDeployments, updateDeployment } from '../deployments';
import { archiveProduct, createPackage, createProduct, deleteProduct, getProduct, listProducts, setPackageArchived, unarchiveProduct, updatePackage, updateProduct } from '../products';

afterAll(async () => {
  await pg.end();
});

const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

async function seed() {
  const o = await makeOrg();
  const p = await createProduct(o.ownerCtx, { name: 'Orbit CRM', description: 'CRM untuk agensi', currentVersion: '2.0.0' });
  const q = await createProduct(o.ownerCtx, { name: 'Orbit POS', currentVersion: '1.4.0' });
  const c = await createClient(o.ownerCtx, { name: 'Aksara Studio', email: 'halo@aksara.test' });
  return { o, p: p.id, q: q.id, c: c.id };
}

describe('acceptance: products and packages (BR-M02-01, -02)', () => {
  it('creates a product with two packages that are the official prices', async () => {
    const { o, p } = await seed();
    await createPackage(o.ownerCtx, p, { name: 'Starter', monthlyPrice: 150_000, features: 'Satu pengguna' });
    await createPackage(o.ownerCtx, p, { name: 'Bisnis', monthlyPrice: 450_000 });
    const detail = await getProduct(o.staffCtx, p); // staff see the prices (owner decision)
    expect(detail.packages.map((x) => [x.name, x.monthlyPrice])).toEqual([['Starter', 150_000], ['Bisnis', 450_000]]);
    expect((await listProducts(o.staffCtx)).find((x) => x.id === p)?.packageCount).toBe(2);
  });

  it('refuses a negative, fractional or absurd price, and a duplicate package name in one product', async () => {
    const { o, p, q } = await seed();
    for (const monthlyPrice of [-1, 1.5, 1_000_000_000_001]) await expect(createPackage(o.ownerCtx, p, { name: 'X1', monthlyPrice })).rejects.toThrow();
    await createPackage(o.ownerCtx, p, { name: 'Starter', monthlyPrice: 100_000 });
    await rejects(createPackage(o.ownerCtx, p, { name: '  starter ', monthlyPrice: 5 }), 'duplicate');
    await createPackage(o.ownerCtx, q, { name: 'Starter', monthlyPrice: 5 }); // the same name in another product is fine
    expect((await createPackage(o.ownerCtx, p, { name: 'Gratis', monthlyPrice: 0 })).id).toBeTruthy();
  });

  it('records a price change in the audit trail with both amounts and touches nothing else', async () => {
    const { o, p } = await seed();
    const pkg = await createPackage(o.ownerCtx, p, { name: 'Starter', monthlyPrice: 150_000 });
    await updatePackage(o.adminCtx, pkg.id, { monthlyPrice: 175_000 });
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'package.updated')));
    expect(entry.summary).toMatchObject({ monthlyPrice: { from: 150_000, to: 175_000 } });
    expect(entry.actor).toBe(`user:${o.adminCtx.userId}`);
  });

  it('keeps product names unique among active products (case-insensitive) but lets an archived name be reused', async () => {
    const { o, p } = await seed();
    await rejects(createProduct(o.ownerCtx, { name: 'orbit   crm' }), 'duplicate');
    await archiveProduct(o.ownerCtx, p);
    const again = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
    await rejects(unarchiveProduct(o.ownerCtx, p), 'duplicate'); // the name is taken by the new one
    expect(again.id).not.toBe(p);
  });

  it('only managers write the catalogue, and an archived product takes no new packages', async () => {
    const { o, p } = await seed();
    await rejects(createProduct(o.staffCtx, { name: 'Terlarang' }), 'forbidden');
    await rejects(createPackage(o.staffCtx, p, { name: 'X1', monthlyPrice: 1 }), 'forbidden');
    await rejects(archiveProduct(o.staffCtx, p), 'forbidden');
    await archiveProduct(o.adminCtx, p);
    await rejects(createPackage(o.ownerCtx, p, { name: 'Baru', monthlyPrice: 1 }), 'invalid_state');
    await rejects(updateProduct(o.ownerCtx, p, { name: 'Ganti' }), 'invalid_state');
  });

  it('archives a package without deleting it, and an archived package leaves the active count', async () => {
    const { o, p } = await seed();
    const pkg = await createPackage(o.ownerCtx, p, { name: 'Lama', monthlyPrice: 10 });
    await setPackageArchived(o.ownerCtx, pkg.id, true);
    expect((await listProducts(o.ownerCtx)).find((x) => x.id === p)?.packageCount).toBe(0);
    expect((await getProduct(o.ownerCtx, p)).packages[0].archivedAt).not.toBeNull();
    await setPackageArchived(o.ownerCtx, pkg.id, false);
    expect((await listProducts(o.ownerCtx)).find((x) => x.id === p)?.packageCount).toBe(1);
  });

  it('clears an optional field when it is sent empty and leaves it when it is not sent', async () => {
    const { o, p } = await seed();
    await updateProduct(o.ownerCtx, p, { description: '' });
    expect((await getProduct(o.ownerCtx, p)).product.description).toBeNull();
    await updateProduct(o.ownerCtx, p, { currentVersion: '2.1.0' });
    expect((await getProduct(o.ownerCtx, p)).product.name).toBe('Orbit CRM');
  });
});

describe('acceptance: clients and deployments (BR-M02-03, -04, -10)', () => {
  it('shows a client with two deployments of different products in the 360 view', async () => {
    const { o, p, q, c } = await seed();
    await createDeployment(o.staffCtx, { productId: p, clientId: c, environment: 'production', domain: 'crm.aksara.test', installedVersion: '2.0.0' });
    await createDeployment(o.staffCtx, { productId: q, clientId: c, installedVersion: '1.2.0', label: 'Cabang Klaten' });
    const view = await getClient360(o.ownerCtx, c);
    expect(view.client.name).toBe('Aksara Studio');
    expect(view.deployments.map((d) => [d.productName, d.environment, d.versionState])).toEqual([['Orbit CRM', 'production', 'current'], ['Orbit POS', 'production', 'behind']]);
    expect(view.deployments[1].label).toBe('Cabang Klaten');
  });

  it('marks a deployment behind after the product version is raised, without storing that state', async () => {
    const { o, p, c } = await seed();
    const d = await createDeployment(o.ownerCtx, { productId: p, clientId: c, installedVersion: '2.0.0' });
    expect((await listDeployments(o.ownerCtx, { behindOnly: true }))).toHaveLength(0);
    await updateProduct(o.ownerCtx, p, { currentVersion: '2.1.0' });
    const behind = await listDeployments(o.ownerCtx, { behindOnly: true });
    expect(behind.map((x) => x.id)).toEqual([d.id]);
    // The deployment row itself is untouched: there is no status column that could go stale.
    const [row] = await db.select().from(deployments).where(eq(deployments.id, d.id));
    expect(row.installedVersion).toBe('2.0.0');
    expect(row.status).toBe('active');
    expect((await listProducts(o.ownerCtx)).find((x) => x.id === p)?.behindCount).toBe(1);
    expect((await listClients(o.ownerCtx))[0]).toMatchObject({ behindCount: 1, deploymentCount: 1 });
    expect((await listProducts(o.ownerCtx)).find((x) => x.id === p)?.deploymentCount).toBe(1);
    await updateDeployment(o.staffCtx, d.id, { installedVersion: '2.1.0' });
    expect(await listDeployments(o.ownerCtx, { behindOnly: true })).toHaveLength(0);
  });

  it('does not count an inactive deployment or a non-semver version as behind', async () => {
    const { o, p, q, c } = await seed();
    await createDeployment(o.ownerCtx, { productId: p, clientId: c, installedVersion: '1.0.0', status: 'inactive' });
    await createDeployment(o.ownerCtx, { productId: q, clientId: c, installedVersion: '2026.10' });
    expect(await listDeployments(o.ownerCtx, { behindOnly: true })).toHaveLength(0);
    expect((await listDeployments(o.ownerCtx)).map((d) => d.versionState).sort()).toEqual(['behind', 'unknown']);
  });

  it('allows one deployment per product, client and environment', async () => {
    const { o, p, c } = await seed();
    await createDeployment(o.ownerCtx, { productId: p, clientId: c, environment: 'Production' });
    await rejects(createDeployment(o.ownerCtx, { productId: p, clientId: c, environment: 'production' }), 'duplicate');
    const staging = await createDeployment(o.ownerCtx, { productId: p, clientId: c, environment: 'staging' });
    await rejects(updateDeployment(o.ownerCtx, staging.id, { environment: 'production' }), 'duplicate');
  });

  it('keeps client names unique regardless of case and spacing (BR-M02-10)', async () => {
    const { o } = await seed();
    await rejects(createClient(o.staffCtx, { name: '  AKSARA    studio ' }), 'duplicate');
    const other = await createClient(o.staffCtx, { name: 'Kopi Senja' });
    await rejects(updateClient(o.staffCtx, other.id, { name: 'aksara studio' }), 'duplicate');
    expect((await listClients(o.ownerCtx)).map((x) => x.name)).toEqual(['Aksara Studio', 'Kopi Senja']);
  });

  it('lets staff create and edit clients and deployments but not archive or delete', async () => {
    const { o, p, c } = await seed();
    const created = await createClient(o.staffCtx, { name: 'Dari Staf', email: 'STAF@Example.test' });
    expect((await getClient360(o.staffCtx, created.id)).client.email).toBe('staf@example.test');
    await updateClient(o.staffCtx, created.id, { phone: '0812' });
    const d = await createDeployment(o.staffCtx, { productId: p, clientId: c });
    await rejects(setClientArchived(o.staffCtx, c, true), 'forbidden');
    await rejects(deleteClient(o.staffCtx, created.id), 'forbidden');
    await rejects(deleteDeployment(o.staffCtx, d.id), 'forbidden');
  });

  it('refuses to delete a client with history and archives it instead; the data stays whole', async () => {
    const { o, p, c } = await seed();
    await createDeployment(o.ownerCtx, { productId: p, clientId: c });
    await rejects(deleteClient(o.ownerCtx, c), 'invalid_state');
    await setClientArchived(o.ownerCtx, c, true);
    expect((await listClients(o.ownerCtx)).map((x) => x.id)).not.toContain(c);
    expect((await listClients(o.ownerCtx, { includeArchived: true })).map((x) => x.id)).toContain(c);
    expect((await getClient360(o.ownerCtx, c)).deployments).toHaveLength(1);
    await rejects(updateClient(o.ownerCtx, c, { phone: '1' }), 'invalid_state');
    await rejects(createDeployment(o.ownerCtx, { productId: p, clientId: c, environment: 'staging' }), 'invalid_state');
  });

  it('deletes a client or product with no history, and removes the product packages with it', async () => {
    const { o } = await seed();
    const blank = await createClient(o.ownerCtx, { name: 'Kosong' });
    await deleteClient(o.ownerCtx, blank.id);
    expect(await db.select().from(clients).where(eq(clients.id, blank.id))).toHaveLength(0);
    const fresh = await createProduct(o.ownerCtx, { name: 'Sementara' });
    await createPackage(o.ownerCtx, fresh.id, { name: 'Paket', monthlyPrice: 1 });
    await deleteProduct(o.ownerCtx, fresh.id);
    expect(await db.select().from(packages).where(eq(packages.productId, fresh.id))).toHaveLength(0);
  });

  it('searches clients by name, contact and email, treating % and _ as plain characters', async () => {
    const { o } = await seed();
    await createClient(o.ownerCtx, { name: 'Kopi_Senja 100%', contactName: 'Budi Santoso' });
    expect((await listClients(o.ownerCtx, { q: 'aksara' })).map((x) => x.name)).toEqual(['Aksara Studio']);
    expect((await listClients(o.ownerCtx, { q: 'santoso' })).map((x) => x.name)).toEqual(['Kopi_Senja 100%']);
    expect((await listClients(o.ownerCtx, { q: 'halo@aksara' })).length).toBe(1);
    expect((await listClients(o.ownerCtx, { q: '%' })).map((x) => x.name)).toEqual(['Kopi_Senja 100%']);
    expect(await listClients(o.ownerCtx, { q: 'tidak ada' })).toEqual([]);
  });

  it('shows the change history to managers and hides it from staff', async () => {
    const { o, p, c } = await seed();
    await createDeployment(o.ownerCtx, { productId: p, clientId: c });
    const manager = await getClient360(o.adminCtx, c);
    expect(manager.timeline?.map((e) => e.action).sort()).toEqual(['client.created', 'deployment.created']);
    expect((await getClient360(o.staffCtx, c)).timeline).toBeNull();
  });
});

describe('acceptance: isolation and secrets', () => {
  it('hides every product, client and deployment from another organization', async () => {
    const a = await seed();
    const b = await makeOrg();
    await rejects(getProduct(b.ownerCtx, a.p), 'not_found');
    await rejects(getClient360(b.ownerCtx, a.c), 'not_found');
    await rejects(updateClient(b.ownerCtx, a.c, { phone: '1' }), 'not_found');
    await rejects(updateProduct(b.ownerCtx, a.p, { name: 'Curian' }), 'not_found');
    await rejects(createDeployment(b.ownerCtx, { productId: a.p, clientId: a.c }), 'not_found');
    expect(await listProducts(b.ownerCtx)).toEqual([]);
    expect(await listClients(b.ownerCtx)).toEqual([]);
    expect(await listDeployments(b.ownerCtx)).toEqual([]);
  });

  it('cannot mix a client of one organization with a product of another, even by writing ids directly', async () => {
    const a = await seed();
    const b = await seed();
    await expect(db.insert(deployments).values({ orgId: a.o.orgId, productId: b.p, clientId: a.c, environment: 'production' })).rejects.toThrow();
  });

  it('has no column that could hold a deployment password, token or environment variables (BR-M02-07)', async () => {
    const rows = await db.execute<{ column_name: string }>(sql`select column_name from information_schema.columns where table_name = 'deployments'`);
    const names = [...rows].map((r) => r.column_name);
    expect(names.filter((n) => /pass|token|secret|env_|credential|key|ssh/i.test(n))).toEqual([]);
  });

  it('refuses a domain that carries a scheme, a login or a path', async () => {
    const { o, p, c } = await seed();
    for (const domain of ['https://crm.aksara.test', 'user:pass@crm.aksara.test', 'crm.aksara.test/admin', 'crm aksara test', 'a']) {
      await expect(createDeployment(o.ownerCtx, { productId: p, clientId: c, environment: `e-${Math.random().toString(36).slice(2, 8)}`, domain })).rejects.toThrow();
    }
    const ok = await createDeployment(o.ownerCtx, { productId: p, clientId: c, domain: 'CRM.Aksara.test' });
    expect((await listDeployments(o.ownerCtx))[0].domain).toBe('crm.aksara.test');
    expect(ok.id).toBeTruthy();
  });

  it('audits every portfolio change in the same transaction', async () => {
    const { o, p, c } = await seed();
    await createPackage(o.ownerCtx, p, { name: 'Sx', monthlyPrice: 1 });
    await createDeployment(o.ownerCtx, { productId: p, clientId: c });
    await setClientArchived(o.ownerCtx, c, true);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.orgId, o.orgId))).map((e) => e.action);
    for (const expected of ['product.created', 'package.created', 'client.created', 'deployment.created', 'client.archived']) expect(actions).toContain(expected);
    // A failed write leaves no audit row behind.
    const before = actions.length;
    await rejects(createClient(o.ownerCtx, { name: 'Aksara Studio' }), 'duplicate');
    expect((await db.select().from(auditLog).where(eq(auditLog.orgId, o.orgId))).length).toBe(before);
  });
});

describe('products table', () => {
  it('lists active products first by name and optionally the archived ones', async () => {
    const { o, p } = await seed();
    await archiveProduct(o.ownerCtx, p);
    expect((await listProducts(o.ownerCtx)).map((x) => x.name)).toEqual(['Orbit POS']);
    expect((await listProducts(o.ownerCtx, { includeArchived: true })).map((x) => x.name)).toEqual(['Orbit CRM', 'Orbit POS']);
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.orgId, o.orgId))).toEqual([{ n: 2 }]);
  });
});
