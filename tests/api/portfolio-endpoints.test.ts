import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../src/db/client';
import { makeOrg } from '../../src/domain/ai/__tests__/support';
import type { Ctx } from '../../src/domain/ctx';
import { POST as archiveClient } from '../../src/pages/api/clients/[id]/archive';
import { DELETE as deleteClient, GET as getClient, PATCH as patchClient } from '../../src/pages/api/clients/[id]';
import { GET as listClients, POST as postClient } from '../../src/pages/api/clients/index';
import { DELETE as deleteDeployment, PATCH as patchDeployment } from '../../src/pages/api/deployments/[id]';
import { GET as listDeployments, POST as postDeployment } from '../../src/pages/api/deployments/index';
import { PATCH as patchPackage } from '../../src/pages/api/packages/[id]';
import { POST as archiveProduct } from '../../src/pages/api/products/[id]/archive';
import { POST as postPackage } from '../../src/pages/api/products/[id]/packages';
import { DELETE as deleteProduct, GET as getProduct, PATCH as patchProduct } from '../../src/pages/api/products/[id]';
import { GET as listProducts, POST as postProduct } from '../../src/pages/api/products/index';

afterAll(async () => {
  await pg.end();
});

type Handler = (c: never) => Response | Promise<Response>;
async function call(handler: Handler, ctx: Ctx | null, { method = 'GET', body, params = {}, query = '' }: { method?: string; body?: unknown; params?: Record<string, string>; query?: string } = {}) {
  const url = new URL(`http://localhost/api/x${query}`);
  const request = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handler({ request, url, params, locals: { ctx, user: ctx ? { locale: 'id' } : null } } as never);
  return { status: res.status, body: (await res.json()) as any };
}

describe('portfolio endpoints', () => {
  it('creates a product with packages and a client with a deployment through the API, and reads the 360 view', async () => {
    const o = await makeOrg();
    const product = await call(postProduct, o.ownerCtx, { method: 'POST', body: { name: 'Orbit CRM', currentVersion: '2.0.0' } });
    expect(product.status).toBe(201);
    const productId = product.body.data.id as string;
    expect((await call(postPackage, o.ownerCtx, { method: 'POST', params: { id: productId }, body: { name: 'Starter', monthlyPrice: 150000 } })).status).toBe(201);
    const client = await call(postClient, o.staffCtx, { method: 'POST', body: { name: 'Aksara Studio' } });
    expect(client.status).toBe(201);
    const clientId = client.body.data.id as string;
    expect((await call(postDeployment, o.staffCtx, { method: 'POST', body: { productId, clientId, installedVersion: '1.9.0', domain: 'crm.aksara.test' } })).status).toBe(201);

    const view = await call(getClient, o.staffCtx, { params: { id: clientId } });
    expect(view.status).toBe(200);
    expect(view.body.data.deployments[0]).toMatchObject({ productName: 'Orbit CRM', versionState: 'behind', domain: 'crm.aksara.test' });
    expect(view.body.data.timeline).toBeNull(); // staff do not see the change history

    const detail = await call(getProduct, o.staffCtx, { params: { id: productId } });
    expect(detail.body.data.packages).toMatchObject([{ name: 'Starter', monthlyPrice: 150000 }]);
    expect((await call(listProducts, o.staffCtx)).body.data.products[0]).toMatchObject({ packageCount: 1, deploymentCount: 1, behindCount: 1 });
    expect((await call(listDeployments, o.staffCtx, { query: '?behind=1' })).body.data.deployments).toHaveLength(1);
    expect((await call(listClients, o.staffCtx, { query: '?q=aks' })).body.data.clients).toHaveLength(1);
  });

  it('answers 400 with field names for bad input, 409 for a duplicate, 403 for the wrong role, 404 across organizations', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const bad = await call(postProduct, a.ownerCtx, { method: 'POST', body: { name: 'x' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'validation', fields: ['name'] });
    const product = (await call(postProduct, a.ownerCtx, { method: 'POST', body: { name: 'Orbit CRM' } })).body.data.id as string;
    expect((await call(postProduct, a.ownerCtx, { method: 'POST', body: { name: 'orbit crm' } })).status).toBe(409);
    expect((await call(postProduct, a.staffCtx, { method: 'POST', body: { name: 'Terlarang' } })).status).toBe(403);
    expect((await call(postPackage, a.ownerCtx, { method: 'POST', params: { id: product }, body: { name: 'Gratis', monthlyPrice: -5 } })).status).toBe(400);
    expect((await call(getProduct, b.ownerCtx, { params: { id: product } })).status).toBe(404);
    expect((await call(patchProduct, b.ownerCtx, { method: 'PATCH', params: { id: product }, body: { name: 'Curian' } })).status).toBe(404);
  });

  it('refuses a deployment domain with a scheme or login, and shows no secret field in any response', async () => {
    const o = await makeOrg();
    const productId = (await call(postProduct, o.ownerCtx, { method: 'POST', body: { name: 'Orbit CRM' } })).body.data.id as string;
    const clientId = (await call(postClient, o.ownerCtx, { method: 'POST', body: { name: 'Aksara Studio' } })).body.data.id as string;
    const bad = await call(postDeployment, o.ownerCtx, { method: 'POST', body: { productId, clientId, domain: 'https://admin:rahasia@crm.aksara.test' } });
    expect(bad.status).toBe(400);
    const good = await call(postDeployment, o.ownerCtx, { method: 'POST', body: { productId, clientId } });
    const listed = await call(listDeployments, o.ownerCtx);
    expect(JSON.stringify(listed.body)).not.toMatch(/password|token|secret/i);
    expect(good.status).toBe(201);
  });

  it('updates and archives through PATCH and POST, and refuses to delete what has history', async () => {
    const o = await makeOrg();
    const productId = (await call(postProduct, o.ownerCtx, { method: 'POST', body: { name: 'Orbit CRM', currentVersion: '1.0.0' } })).body.data.id as string;
    const clientId = (await call(postClient, o.ownerCtx, { method: 'POST', body: { name: 'Aksara Studio' } })).body.data.id as string;
    const pkgId = (await call(postPackage, o.ownerCtx, { method: 'POST', params: { id: productId }, body: { name: 'Starter', monthlyPrice: 100 } })).body.data.id as string;
    const depId = (await call(postDeployment, o.ownerCtx, { method: 'POST', body: { productId, clientId, installedVersion: '1.0.0' } })).body.data.id as string;

    expect((await call(patchPackage, o.adminCtx, { method: 'PATCH', params: { id: pkgId }, body: { monthlyPrice: 120 } })).status).toBe(200);
    expect((await call(patchClient, o.staffCtx, { method: 'PATCH', params: { id: clientId }, body: { phone: '0812' } })).status).toBe(200);
    expect((await call(patchDeployment, o.staffCtx, { method: 'PATCH', params: { id: depId }, body: { installedVersion: '1.1.0' } })).status).toBe(200);
    expect((await call(deleteDeployment, o.staffCtx, { method: 'DELETE', params: { id: depId } })).status).toBe(403);
    expect((await call(deleteClient, o.ownerCtx, { method: 'DELETE', params: { id: clientId } })).status).toBe(409);
    expect((await call(deleteProduct, o.ownerCtx, { method: 'DELETE', params: { id: productId } })).status).toBe(409);
    expect((await call(archiveClient, o.ownerCtx, { method: 'POST', params: { id: clientId }, body: { archived: true } })).status).toBe(200);
    expect((await call(listClients, o.ownerCtx)).body.data.clients).toHaveLength(0);
    expect((await call(listClients, o.ownerCtx, { query: '?archived=1' })).body.data.clients).toHaveLength(1);
    expect((await call(archiveProduct, o.ownerCtx, { method: 'POST', params: { id: productId }, body: { archived: true } })).status).toBe(200);
    expect((await call(archiveProduct, o.ownerCtx, { method: 'POST', params: { id: productId }, body: { archived: 'ya' } })).status).toBe(400);
    expect((await call(deleteDeployment, o.ownerCtx, { method: 'DELETE', params: { id: depId } })).status).toBe(200);
  });

  it('refuses without a session', async () => {
    expect((await call(listProducts, null)).status).toBe(403);
  });
});
