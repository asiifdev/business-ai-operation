import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, clients } from '../../../db/schema';
import { riskOf, mayAutoRun } from '../../action-center/autonomy';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createClient, createClientsBulk, MAX_BULK_CLIENTS } from '../clients';

afterAll(async () => {
  await pg.end();
});

describe('adding clients in bulk (D-098)', () => {
  it('adds what it can in one go, and reports the rest by name instead of failing the batch', async () => {
    const o = await makeOrg();
    await createClient(o.ownerCtx, { name: 'Pak Fatoni Shiha Prestige' });
    const r = await createClientsBulk(o.staffCtx, [
      { name: 'Bu Ratna', phone: '+62 812-0000-1111' },
      { name: '  pak   fatoni shiha prestige ' }, // already a client, other case and spacing
      { name: 'CV Maju Jaya', contactName: 'Dedi', email: 'dedi@maju.id' },
      { name: 'bu ratna' }, // repeated in this list
      { name: 'X' }, // too short
      { name: 'Budi', email: 'bukan-email' }, // unusable email
    ]);
    expect(r.created.map((c) => c.name).sort()).toEqual(['Bu Ratna', 'CV Maju Jaya']);
    expect(r.skipped.map((s) => `${s.reason}:${s.name.trim()}`).sort()).toEqual(['exists:pak   fatoni shiha prestige', 'invalid:Budi', 'invalid:X', 'repeated:bu ratna']);
    const rows = await db.select().from(clients).where(eq(clients.orgId, o.orgId));
    expect(rows).toHaveLength(3);
    expect(rows.find((c) => c.name === 'Bu Ratna')).toMatchObject({ phone: '+62 812-0000-1111' });
  });

  it('is idempotent: the same list a second time adds nothing and says why', async () => {
    const o = await makeOrg();
    const list = [{ name: 'A Satu' }, { name: 'B Dua' }];
    expect((await createClientsBulk(o.ownerCtx, list)).created).toHaveLength(2);
    const again = await createClientsBulk(o.ownerCtx, list);
    expect(again.created).toEqual([]);
    expect(again.skipped.map((s) => s.reason)).toEqual(['exists', 'exists']);
  });

  it('audits every client added, stays inside the organization, and bounds the batch', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await createClientsBulk(a.ownerCtx, [{ name: 'Sama Nama' }, { name: 'Lain Nama' }]);
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.orgId, a.orgId), eq(auditLog.action, 'client.created')));
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => (x.summary as { bulk?: boolean }).bulk === true)).toBe(true);
    // The same name in another organization is a different client.
    expect((await createClientsBulk(b.ownerCtx, [{ name: 'Sama Nama' }])).created).toHaveLength(1);
    await expect(createClientsBulk(a.ownerCtx, [])).rejects.toThrow();
    await expect(createClientsBulk(a.ownerCtx, Array.from({ length: MAX_BULK_CLIENTS + 1 }, (_, i) => ({ name: `Klien ${i}` })))).rejects.toThrow();
  });

  it('is a medium-risk action: it waits for a click unless the organization chose the highest level', () => {
    expect(riskOf('create_clients')).toBe('medium');
    expect(mayAutoRun('careful', 'create_clients')).toBe(false);
    expect(mayAutoRun('balanced', 'create_clients')).toBe(false);
    expect(mayAutoRun('autonomous', 'create_clients')).toBe(true);
    expect(new DomainError('forbidden').code).toBe('forbidden');
  });
});
