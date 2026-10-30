import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { findings } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import type { Ctx } from '../../ctx';
import { createLead, moveLead } from '../../pipeline/leads';
import { listFindings } from '../findings';
import { emitLeadStagnant, sweepActionCenter } from '../rules';

afterAll(async () => {
  await pg.end();
});

const aiCtx = (ctx: Ctx): Ctx => ({ ...ctx, actor: 'ai:run-1', aiRunId: 'run-1' });
const stagnantRows = (orgId: string) => db.select().from(findings).where(and(eq(findings.orgId, orgId), eq(findings.rule, 'lead_stagnant')));

describe('rule lead_stagnant (BRD-M08 section 3, BR-M04-08, D-073)', () => {
  it('raises one finding for a lead quiet past the threshold, never two for the same spell', async () => {
    const o = await makeOrg('2026-10-01T03:00:00Z');
    const { id } = await createLead(o.ownerCtx, { name: 'Toko Sinar', estimatedValue: 5_000_000 });
    o.clock.set('2026-10-10T03:00:00Z'); // 9 days: under the default 14
    expect((await emitLeadStagnant(o.orgId, o.clock.now())).raised).toEqual([]);
    o.clock.set('2026-10-20T03:00:00Z'); // 19 days
    expect((await emitLeadStagnant(o.orgId, o.clock.now())).raised).toEqual([id]);
    expect((await emitLeadStagnant(o.orgId, o.clock.now())).raised).toEqual([]);
    expect(await stagnantRows(o.orgId)).toHaveLength(1);

    // Everyone sees it: a lead is not money (BRD-M08 section 2). The card reads the lead live.
    const { findings: cards } = await listFindings(o.staffCtx, 'open');
    const card = cards.find((c) => c.rule === 'lead_stagnant');
    expect(card?.facts).toMatchObject({ kind: 'lead', leadId: id, name: 'Toko Sinar', stage: 'new', daysInStage: 19, stagnantDays: 14, stagnant: true });
    expect(card?.href).toBe(`/app/lead/${id}`);
  });

  it('closes by itself when the lead moves, and a later quiet spell raises a new card', async () => {
    const o = await makeOrg('2026-10-01T03:00:00Z');
    const { id } = await createLead(o.ownerCtx, { name: 'Klinik Sehat' });
    o.clock.set('2026-10-20T03:00:00Z');
    await emitLeadStagnant(o.orgId, o.clock.now());
    await moveLead(o.ownerCtx, id, 'exploring');
    await sweepActionCenter(o.orgId, o.clock.now());
    expect((await stagnantRows(o.orgId)).map((r) => r.status)).toEqual(['auto_resolved']);

    o.clock.set('2026-11-10T03:00:00Z'); // 21 days in the new stage
    expect((await emitLeadStagnant(o.orgId, o.clock.now())).raised).toEqual([id]);
    expect((await stagnantRows(o.orgId)).filter((r) => r.status === 'new')).toHaveLength(1);
  });

  it('ignores AI drafts and finished leads, and keeps to its own organization', async () => {
    const o = await makeOrg('2026-10-01T03:00:00Z');
    await createLead(aiCtx(o.ownerCtx), { name: 'Dari Rekaman' });
    const won = await createLead(o.ownerCtx, { name: 'Sudah Menang' });
    for (const stage of ['exploring', 'proposal', 'negotiation', 'won'] as const) await moveLead(o.ownerCtx, won.id, stage);
    const other = await makeOrg('2026-10-01T03:00:00Z');
    await createLead(other.ownerCtx, { name: 'Milik Org Lain' });
    o.clock.set('2026-11-01T03:00:00Z');
    expect((await emitLeadStagnant(o.orgId, o.clock.now())).raised).toEqual([]);
    expect(await stagnantRows(o.orgId)).toHaveLength(0);
  });
});
