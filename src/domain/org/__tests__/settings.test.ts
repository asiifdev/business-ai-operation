import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { getOrgSettings, orgSettingsSchema, updateOrgSettings } from '../settings';

afterAll(async () => {
  await pg.end();
});

const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

async function current(o: Awaited<ReturnType<typeof makeOrg>>) {
  const { currency: _c, ...rest } = await getOrgSettings(o.ownerCtx);
  return rest;
}

describe('M01 organization settings', () => {
  it('starts from the documented defaults (BR-M01-07)', async () => {
    const o = await makeOrg();
    expect(await getOrgSettings(o.staffCtx)).toMatchObject({ currency: 'IDR', timezone: 'Asia/Jakarta', graceDays: 7, draftOffsetDays: 7, schedulerHour: 8, invoiceNumberFormat: 'INV-{YYYY}-{NNNN}', taxRateBps: 0, stagnantDays: 14, approvalTtlHours: 24 });
  });

  it('lets only the Owner change them and audits what changed, without payment details', async () => {
    const o = await makeOrg();
    const base = await current(o);
    await rejects(updateOrgSettings(o.adminCtx, { ...base, taxRateBps: 1100 }), 'forbidden');
    await rejects(updateOrgSettings(o.staffCtx, { ...base, taxRateBps: 1100 }), 'forbidden');

    const r = await updateOrgSettings(o.ownerCtx, { ...base, taxRateBps: 1100, graceDays: 3, bankName: 'BCA', bankAccountNumber: '1234567890' });
    expect(r.changed.sort()).toEqual(['bankAccountNumber', 'bankName', 'graceDays', 'taxRateBps']);
    expect(await getOrgSettings(o.staffCtx)).toMatchObject({ taxRateBps: 1100, graceDays: 3, bankName: 'BCA' });

    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'org.settings_updated')));
    const text = JSON.stringify(row.summary);
    expect(row.summary).toMatchObject({ taxRateBps: { from: 0, to: 1100 }, graceDays: { from: 7, to: 3 } });
    expect(text).not.toContain('1234567890');
    expect(text).not.toContain('BCA');
  });

  it('writes nothing when nothing changed', async () => {
    const o = await makeOrg();
    expect((await updateOrgSettings(o.ownerCtx, await current(o))).changed).toEqual([]);
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'org.settings_updated')));
    expect(rows).toHaveLength(0);
  });

  it('refuses nonsense: unknown zone, hour out of range, tax above 100%, a number format that cannot count', async () => {
    const o = await makeOrg();
    const base = await current(o);
    for (const bad of [{ timezone: 'Mars/Olympus' }, { schedulerHour: 24 }, { briefingHour: -1 }, { taxRateBps: 10_001 }, { invoiceNumberFormat: 'INV-{YYYY}' }, { invoiceNumberFormat: 'INV <b>{NNNN}' }, { approvalTtlHours: 0 }]) {
      expect(orgSettingsSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    await expect(updateOrgSettings(o.ownerCtx, { ...base, timezone: 'Mars/Olympus' })).rejects.toThrow();
  });

  it('one organization\'s change never touches another', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await updateOrgSettings(a.ownerCtx, { ...(await current(a)), graceDays: 30 });
    expect((await getOrgSettings(b.ownerCtx)).graceDays).toBe(7);
  });
});
