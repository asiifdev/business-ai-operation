import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../db/client';
import { clients, tasks } from '../../db/schema';
import { makeOrg } from '../../domain/ai/__tests__/support';
import { createClient } from '../../domain/portfolio/clients';
import { createTask } from '../../domain/tasks/service';
import { buildActionRegistry } from '../tools/actions';
import { splitSuggestions } from '../assistant';

afterAll(async () => {
  await pg.end();
});

const run = async (ctx: Parameters<typeof createClient>[0], tool: string, args: object) => {
  const def = buildActionRegistry().get(tool)!;
  return (def.execute as (c: typeof ctx, a: unknown) => Promise<unknown>)(ctx, def.args.parse(args));
};

describe('management tools run the same services as the buttons (D-091)', () => {
  it('archives and restores a client, and deletes one that has no history', async () => {
    const o = await makeOrg();
    const a = await createClient(o.ownerCtx, { name: 'Klien Arsip' });
    await run(o.ownerCtx, 'archive_client', { clientId: a.id });
    expect((await db.select().from(clients).where(eq(clients.id, a.id)))[0]!.archivedAt).not.toBeNull();
    await run(o.ownerCtx, 'archive_client', { clientId: a.id, archived: false });
    expect((await db.select().from(clients).where(eq(clients.id, a.id)))[0]!.archivedAt).toBeNull();
    await run(o.ownerCtx, 'delete_client', { clientId: a.id });
    expect(await db.select().from(clients).where(eq(clients.id, a.id))).toHaveLength(0);
  });

  it('refuses to delete what has history, and staff cannot archive', async () => {
    const o = await makeOrg();
    const c = await createClient(o.ownerCtx, { name: 'Punya Riwayat' });
    await createTask(o.ownerCtx, { title: 'Tugas klien', clientId: c.id });
    await expect(run(o.ownerCtx, 'delete_client', { clientId: c.id })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(run(o.staffCtx, 'archive_client', { clientId: c.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('links a task to a client through update_task, and discards only a draft', async () => {
    const o = await makeOrg();
    const c = await createClient(o.ownerCtx, { name: 'Balutan' });
    const t = await createTask(o.ownerCtx, { title: 'Fitur pengembalian' });
    await run(o.ownerCtx, 'update_task', { taskId: t.id, clientId: c.id });
    expect((await db.select().from(tasks).where(eq(tasks.id, t.id)))[0]!.clientId).toBe(c.id);
    await expect(run(o.ownerCtx, 'discard_task_draft', { taskId: t.id })).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('suggestion buttons never answer for the person (D-091)', () => {
  it('drops them when the answer itself asks something', () => {
    expect(splitSuggestions('Siapa nama kliennya?\nLanjutan: Tell me the client name').suggestions).toEqual([]);
    expect(splitSuggestions('Sudah dibuat.\nLanjutan: Buatkan pengingat untuk klien ini').suggestions).toEqual(['Buatkan pengingat untuk klien ini']);
  });
});
