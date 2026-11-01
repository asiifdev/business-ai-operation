import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../../db/client';
import { buildAssistantRegistry } from '../../../ai/tools/catalog';
import { makeOrg } from '../../ai/__tests__/support';
import type { Ctx } from '../../ctx';
import { DomainError } from '../../errors';
import { createProduct } from '../../portfolio/products';
import { createFlow, getFlow, listFlows, updateFlow } from '../service';
import { getTemplate } from '../templates';

afterAll(async () => {
  await pg.end();
});

const asAi = (ctx: Ctx): Ctx => ({ ...ctx, actor: 'ai:run-1', aiRunId: 'run-1' });
const draftFlow = async (ctx: Ctx, args: Record<string, unknown>) => {
  const tool = buildAssistantRegistry().get('draft_flow')!;
  return (await (tool.run as (c: Ctx, a: unknown) => Promise<{ id: string }>)(ctx, tool.args.parse(args))) as { id: string };
};
const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

/** A flow with a free command node: the one thing the assistant may never write (BR-M17-18, PRD M17). */
const commandDefinition = {
  slots: [{ name: 'server', kind: 'ssh' }],
  nodes: [{ id: 'c', tool: 'ssh.run_command', bind: { ssh: 'server' }, config: { command: 'uptime' } }],
};

describe('M17 draft_flow', () => {
  it('saves a diagram from a built-in template, marked as AI-assisted, linked to the product, running nothing', async () => {
    const o = await makeOrg();
    const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
    const { id } = await draftFlow(asAi(o.ownerCtx), { template: 'laravel-pm2-setup', productId: product.id });

    const row = (await listFlows(o.ownerCtx)).find((f) => f.id === id)!;
    expect(row).toMatchObject({ kind: 'setup', productId: product.id, aiAssisted: true, hasCommandNode: false, currentVersion: 1 });
    expect((await getFlow(o.ownerCtx, id)).aiAssisted).toBe(true);
  });

  it('a flow a person drew is not marked, and a person saving over an AI draft clears the mark', async () => {
    const o = await makeOrg();
    const template = getTemplate('laravel-pm2-update')!;
    const mine = await createFlow(o.ownerCtx, { name: 'Buatan saya', kind: 'update', definition: template.build() });
    expect((await getFlow(o.ownerCtx, mine.id)).aiAssisted).toBe(false);

    const { id } = await draftFlow(asAi(o.ownerCtx), { template: 'laravel-pm2-update', name: 'Draf asisten' });
    expect((await listFlows(o.ownerCtx)).find((f) => f.id === id)!.aiAssisted).toBe(true);
    await updateFlow(o.ownerCtx, id, { definition: template.build() });
    const after = await getFlow(o.ownerCtx, id);
    expect(after.version).toBe(2);
    expect(after.aiAssisted).toBe(false);
  });

  it('refuses a flow with a command node when the assistant writes it, even for the Owner, and saves nothing', async () => {
    const o = await makeOrg();
    await rejects(createFlow(asAi(o.ownerCtx), { name: 'Perintah bebas', kind: 'update', definition: commandDefinition }), 'forbidden');
    expect((await listFlows(o.ownerCtx)).map((f) => f.name)).not.toContain('Perintah bebas');
    // the Owner may still write the very same flow themselves (BR-M17-18)
    await expect(createFlow(o.ownerCtx, { name: 'Perintah bebas', kind: 'update', definition: commandDefinition })).resolves.toHaveProperty('id');
  });

  it('refuses the assistant editing a flow that already has a command node, new version or just a new name', async () => {
    const o = await makeOrg();
    const { id } = await createFlow(o.ownerCtx, { name: 'Milik Pemilik', kind: 'update', definition: commandDefinition });
    await rejects(updateFlow(asAi(o.ownerCtx), id, { name: 'Diganti asisten' }), 'forbidden');
    await rejects(updateFlow(asAi(o.ownerCtx), id, { definition: getTemplate('laravel-pm2-update')!.build() }), 'forbidden');
    expect((await getFlow(o.ownerCtx, id)).flow.name).toBe('Milik Pemilik');
  });

  it('draft_flow needs the flow.write permission and a product of this organization', async () => {
    const o = await makeOrg();
    await rejects(draftFlow(asAi(o.staffCtx), { template: 'laravel-pm2-setup' }), 'forbidden');
    const other = await makeOrg();
    const foreign = await createProduct(other.ownerCtx, { name: 'Milik org lain' });
    await rejects(draftFlow(asAi(o.ownerCtx), { template: 'laravel-pm2-setup', productId: foreign.id }), 'not_found');
  });
});
