import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { AiProviderError } from '../../../ai/errors';
import { db, pg } from '../../../db/client';
import { aiBudgets, aiRuns, approvals, auditLog } from '../../../db/schema';
import { DomainError } from '../../errors';
import { APPROVAL_TTL_MS, getApproval, requestApproval } from '../../approvals/service';
import { MAX_DAILY_BUDGET_MICRO_USD, getBudgetStatus, setAiBudget, zonedDayStart } from '../budget';
import { AiRun, summarize } from '../runs';
import { makeOrg } from './support';

afterAll(async () => {
  await pg.end();
});

describe('zonedDayStart', () => {
  it('starts the day at 00:00 in the organization time zone', () => {
    // 2026-10-28 03:00 UTC is 10:00 in Jakarta (UTC+7): the Jakarta day began at 2026-10-27 17:00 UTC.
    expect(zonedDayStart(new Date('2026-10-28T03:00:00Z'), 'Asia/Jakarta').toISOString()).toBe('2026-10-27T17:00:00.000Z');
    // 20:00 UTC is already the next Jakarta day (03:00 WIB on the 29th).
    expect(zonedDayStart(new Date('2026-10-28T20:00:00Z'), 'Asia/Jakarta').toISOString()).toBe('2026-10-28T17:00:00.000Z');
    expect(zonedDayStart(new Date('2026-10-28T03:00:00Z'), 'UTC').toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });
});

describe('daily budget (BR-M07-07)', () => {
  it('counts only today, only this feature, and only this organization', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const base = { model: 'muse-spark-1.3', status: 'ok' as const, finishedAt: a.clock.now() };
    await db.insert(aiRuns).values([
      { ...base, orgId: a.orgId, feature: 'agent', costMicroUsd: 300_000, startedAt: new Date('2026-10-28T01:00:00Z') }, // today
      { ...base, orgId: a.orgId, feature: 'agent', costMicroUsd: 500_000, startedAt: new Date('2026-10-27T10:00:00Z') }, // yesterday in Jakarta (17:00 WIB)
      { ...base, orgId: a.orgId, feature: 'image', costMicroUsd: 400_000, startedAt: new Date('2026-10-28T01:00:00Z') }, // other feature
      { ...base, orgId: b.orgId, feature: 'agent', costMicroUsd: 900_000, startedAt: new Date('2026-10-28T01:00:00Z') }, // other org
    ]);
    const status = await getBudgetStatus(db, a.orgId, 'agent', a.clock.now());
    expect(status).toMatchObject({ limitMicroUsd: 2_000_000, spentMicroUsd: 300_000, remainingMicroUsd: 1_700_000, exhausted: false });
  });

  it('starts fresh after midnight in the organization time zone', async () => {
    const o = await makeOrg('2026-10-28T03:00:00Z');
    await db.insert(aiRuns).values({ orgId: o.orgId, feature: 'agent', model: 'muse-spark-1.3', status: 'ok', costMicroUsd: 2_000_000, startedAt: new Date('2026-10-28T02:00:00Z'), finishedAt: new Date() });
    expect((await getBudgetStatus(db, o.orgId, 'agent', o.clock.now())).exhausted).toBe(true);
    o.clock.set('2026-10-28T18:00:00Z'); // 01:00 on the 29th in Jakarta
    expect(await getBudgetStatus(db, o.orgId, 'agent', o.clock.now())).toMatchObject({ spentMicroUsd: 0, exhausted: false });
  });

  it('treats a missing budget row as zero, so a missing setting blocks instead of allowing unlimited spend', async () => {
    const o = await makeOrg();
    await db.delete(aiBudgets).where(and(eq(aiBudgets.orgId, o.orgId), eq(aiBudgets.feature, 'image')));
    expect(await getBudgetStatus(db, o.orgId, 'image', o.clock.now())).toMatchObject({ limitMicroUsd: 0, exhausted: true });
  });

  it('can be changed by the Owner only, within bounds, and is audited', async () => {
    const o = await makeOrg();
    await setAiBudget(db, o.ownerCtx, 'agent', 5_000_000);
    expect((await getBudgetStatus(db, o.orgId, 'agent', o.clock.now())).limitMicroUsd).toBe(5_000_000);
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'ai_budget.updated')));
    expect(audit[0].summary).toEqual({ feature: 'agent', from: 2_000_000, to: 5_000_000 });

    for (const ctx of [o.adminCtx, o.staffCtx]) {
      await expect(setAiBudget(db, ctx, 'agent', 1)).rejects.toMatchObject({ code: 'forbidden' });
    }
    for (const bad of [-1, 1.5, MAX_DAILY_BUDGET_MICRO_USD + 1]) {
      await expect(setAiBudget(db, o.ownerCtx, 'agent', bad)).rejects.toBeInstanceOf(DomainError);
    }
  });
});

describe('AiRun (BR-M07-08, BR-M15-05)', () => {
  it('writes a run with tokens, cost, tools and the person it acted for', async () => {
    const o = await makeOrg();
    const run = await AiRun.start(db, o.ownerCtx, { feature: 'agent', model: 'muse-spark-1.3', inputSummary: 'Penjelasan invoice  telat\n\n' });
    run.addChat('muse-spark-1.3', { inputTokens: 1000, outputTokens: 500, cachedTokens: 0, reasoningTokens: 100 });
    run.addTool({ round: 1, name: 'get_invoice', tier: 'read', status: 'ok' });
    await run.finish('ok', { outputSummary: 'Invoice telat 6 hari.' });

    const [row] = await db.select().from(aiRuns).where(eq(aiRuns.id, run.id));
    expect(row).toMatchObject({
      orgId: o.orgId,
      feature: 'agent',
      status: 'ok',
      onBehalfOf: o.ownerCtx.userId,
      inputTokens: 1000,
      outputTokens: 500,
      costMicroUsd: Math.ceil(1000 * 1.25 + 500 * 4.25),
      inputSummary: 'Penjelasan invoice telat',
      outputSummary: 'Invoice telat 6 hari.',
      error: null,
    });
    expect(row.tools).toEqual([{ round: 1, name: 'get_invoice', tier: 'read', status: 'ok' }]);
    expect(row.finishedAt).not.toBeNull();
  });

  it('leaves an honest error row when a run never finishes', async () => {
    const o = await makeOrg();
    const run = await AiRun.start(db, o.ownerCtx, { feature: 'minutes', model: 'muse-spark-1.3' });
    const [row] = await db.select().from(aiRuns).where(eq(aiRuns.id, run.id));
    expect(row).toMatchObject({ status: 'error', error: 'run did not finish', finishedAt: null });
  });

  it('records a blocked run and refuses to start when the budget is spent', async () => {
    const o = await makeOrg();
    await setAiBudget(db, o.ownerCtx, 'image', 0);
    await expect(AiRun.start(db, o.ownerCtx, { feature: 'image', model: 'muse-image-1.0' })).rejects.toMatchObject({ kind: 'budget' });
    const [row] = await db.select().from(aiRuns).where(and(eq(aiRuns.orgId, o.orgId), eq(aiRuns.feature, 'image')));
    expect(row).toMatchObject({ status: 'blocked_budget', costMicroUsd: 0 });
  });

  it('re-checks the budget between rounds using what this run has already spent', async () => {
    const o = await makeOrg();
    await setAiBudget(db, o.ownerCtx, 'agent', 10_000); // USD 0.01
    const run = await AiRun.start(db, o.ownerCtx, { feature: 'agent', model: 'muse-spark-1.3' });
    await expect(run.assertBudget()).resolves.toBeUndefined();
    run.addChat('muse-spark-1.3', { inputTokens: 0, outputTokens: 3000, cachedTokens: 0, reasoningTokens: 0 }); // 12,750 micro-USD
    await expect(run.assertBudget()).rejects.toBeInstanceOf(AiProviderError);
  });

  it('acts as the AI run for the person, never as the person (BR-M15-02)', async () => {
    const o = await makeOrg();
    const run = await AiRun.start(db, o.staffCtx, { feature: 'agent', model: 'muse-spark-1.3' });
    expect(run.ctx).toMatchObject({ actor: `ai:${run.id}`, aiRunId: run.id, userId: o.staffCtx.userId, role: 'staff', orgId: o.orgId });
  });

  it('records cost for speech and images by their own prices', async () => {
    const o = await makeOrg();
    const run = await AiRun.start(db, o.ownerCtx, { feature: 'transcribe', model: 'muse-voice-transcribe-1.0' });
    run.addAudio(22_000);
    run.addImages(2);
    await run.finish('ok');
    const [row] = await db.select().from(aiRuns).where(eq(aiRuns.id, run.id));
    expect(row).toMatchObject({ audioMs: 22_000, images: 2, costMicroUsd: 1100 + 20_000 });
  });

  it('keeps summaries short and on one line (BR-M15-06)', () => {
    expect(summarize('a\n\n  b   c')).toBe('a b c');
    expect(summarize('x'.repeat(1000))?.length).toBe(200);
    expect(summarize(null)).toBeNull();
  });
});

describe('requestApproval (BR-M07-03, CR-06)', () => {
  it('creates a pending approval with the exact arguments, an expiry and an audit row, and changes nothing else', async () => {
    const o = await makeOrg();
    const run = await AiRun.start(db, o.ownerCtx, { feature: 'agent', model: 'muse-spark-1.3' });
    const created = await requestApproval(db, run.ctx, { tool: 'mark_invoice_sent', args: { invoiceId: 'inv-1' }, rationale: 'Tandai invoice INV-1 sebagai terkirim.' });

    const row = await getApproval(db, o.orgId, created.id);
    expect(row).toMatchObject({ status: 'pending', tool: 'mark_invoice_sent', args: { invoiceId: 'inv-1' }, requestedFor: o.ownerCtx.userId, aiRunId: run.id, decidedBy: null, executedAt: null });
    expect(row!.expiresAt.getTime() - o.clock.now().getTime()).toBe(APPROVAL_TTL_MS);

    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'approval.requested')));
    expect(audit).toMatchObject({ actor: `ai:${run.id}`, actorUserId: o.ownerCtx.userId, aiRunId: run.id, entityId: created.id });
  });

  it('needs a reason, and other organizations cannot see it', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await expect(requestApproval(db, a.ownerCtx, { tool: 'x_tool', args: {}, rationale: '  ' })).rejects.toMatchObject({ code: 'validation' });
    const created = await requestApproval(db, a.ownerCtx, { tool: 'x_tool', args: {}, rationale: 'ok' });
    expect(await getApproval(db, b.orgId, created.id)).toBeNull();
    expect((await db.select().from(approvals).where(eq(approvals.orgId, b.orgId))).length).toBe(0);
  });
});
