import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { automationRuns, findings, invoices, organizations } from '../../../db/schema';
import { fixedClock } from '../../../lib/clock';
import { runTick, TICKER_LOCK_KEY, type TickState } from '../../../server/ticker';
import { makeOrg } from '../../ai/__tests__/support';
import { automationOnce } from '../../automation/once';
import { createClient } from '../../portfolio/clients';
import { createPackage, createProduct } from '../../portfolio/products';
import { createInvoiceDraft, markInvoiceSent } from '../invoices';
import { emitOverdueFindings, runBillingRules } from '../rules';
import { createSubscription } from '../subscriptions';

afterAll(async () => {
  await pg.end();
});

const item = (unitPrice: number) => [{ description: 'Layanan', quantity: 1, unitPrice }];

async function world() {
  const o = await makeOrg('2026-10-28T03:00:00Z'); // 10:00 in Jakarta
  const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
  const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
  const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });
  const sub = await createSubscription(o.ownerCtx, { clientId: client.id, packageId: pkg.id, startedOn: '2026-10-01', nextDueDate: '2026-11-01' });
  return { o, client: client.id, sub: sub.id };
}
const runsOf = async (orgId: string, rule: string) => db.select().from(automationRuns).where(and(eq(automationRuns.orgId, orgId), eq(automationRuns.rule, rule)));
const findingsOf = async (orgId: string, rule: 'invoice_overdue' | 'invoice_draft_ready') => db.select().from(findings).where(and(eq(findings.orgId, orgId), eq(findings.rule, rule)));

describe('automation.once (CR-10, BR-M15-04)', () => {
  it('runs a rule once per key, in parallel too, and records its result', async () => {
    const o = await makeOrg();
    let calls = 0;
    const attempt = () => db.transaction((tx) => automationOnce(tx, o.orgId, 'demo', 'k1', async () => ({ n: ++calls })));
    const results = await Promise.all(Array.from({ length: 6 }, attempt));
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    expect(calls).toBe(1);
    expect((await runsOf(o.orgId, 'demo'))[0].result).toEqual({ n: 1 });
    expect((await db.transaction((tx) => automationOnce(tx, o.orgId, 'demo', 'k2', async () => 1))).ran).toBe(true); // another key runs
  });

  it('gives the claim back when the work fails, so the next run tries again', async () => {
    const o = await makeOrg();
    await expect(db.transaction((tx) => automationOnce(tx, o.orgId, 'demo', 'k1', async () => { throw new Error('boom'); }))).rejects.toThrow('boom');
    expect(await runsOf(o.orgId, 'demo')).toHaveLength(0);
    expect((await db.transaction((tx) => automationOnce(tx, o.orgId, 'demo', 'k1', async () => 'ok'))).ran).toBe(true);
  });
});

describe('billing rules', () => {
  it('prepares one renewal draft and raises one "draft ready" event, however often it runs', async () => {
    const { o, sub } = await world();
    const now = o.clock.now();
    const first = await runBillingRules(o.orgId, now);
    expect(first.renewalDrafts).toBe(1);
    await Promise.all([runBillingRules(o.orgId, now), runBillingRules(o.orgId, now), runBillingRules(o.orgId, now)]);
    const drafts = await db.select().from(invoices).where(eq(invoices.subscriptionId, sub));
    expect(drafts).toHaveLength(1);
    const events = await findingsOf(o.orgId, 'invoice_draft_ready');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityType: 'invoice', entityId: drafts[0].id, periodKey: '2026-11', status: 'new' });
    expect(await runsOf(o.orgId, 'renewal_draft')).toHaveLength(1);
  });

  it('raises the overdue event exactly once per invoice, only once it is past its due date, and not for paid or draft ones', async () => {
    const { o, client } = await world();
    const sent = await createInvoiceDraft(o.ownerCtx, { clientId: client, dueDate: '2026-10-30', items: item(500_000) });
    await markInvoiceSent(o.ownerCtx, sent.id);
    await createInvoiceDraft(o.ownerCtx, { clientId: client, dueDate: '2026-10-01', items: item(100_000) }); // a draft never becomes overdue
    expect((await emitOverdueFindings(o.orgId, o.clock.now())).raised).toEqual([]); // not yet due
    o.clock.set('2026-10-31T03:00:00Z');
    const day1 = await emitOverdueFindings(o.orgId, o.clock.now());
    expect(day1.raised).toEqual([sent.id]);
    o.clock.set('2026-11-05T03:00:00Z');
    await Promise.all([emitOverdueFindings(o.orgId, o.clock.now()), emitOverdueFindings(o.orgId, o.clock.now())]);
    const events = await findingsOf(o.orgId, 'invoice_overdue');
    expect(events).toHaveLength(1); // days later, still just one: further reminders need an approval (BR-M03-12)
    expect(events[0]).toMatchObject({ entityId: sent.id, periodKey: '2026-10-30', status: 'new' });
    expect(Object.keys(events[0])).not.toContain('amount'); // no figure is stored on the finding (BR-M08-03)
  });

  it('writes the overdue event to the audit trail as the system, and keeps invoice status untouched', async () => {
    const { o, client } = await world();
    const inv = await createInvoiceDraft(o.ownerCtx, { clientId: client, dueDate: '2026-10-30', items: item(500_000) });
    await markInvoiceSent(o.ownerCtx, inv.id);
    o.clock.set('2026-11-02T03:00:00Z');
    await emitOverdueFindings(o.orgId, o.clock.now());
    const [row] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, inv.id));
    expect(row.status).toBe('sent'); // overdue is derived, the scheduler writes no status (BR-M03-02)
    const trail = await db.execute<{ actor: string }>(sql`select actor from audit_log where org_id = ${o.orgId} and action = 'finding.created'`);
    expect(trail.map((r) => r.actor)).toEqual(['system:rule.invoice_overdue']);
  });
});

describe('the ticker (PRD section 7)', () => {
  const rules = (log: string[]) => async (orgId: string) => {
    log.push(orgId);
    return { renewalDrafts: 0, overdueRaised: 0 };
  };

  it('waits for the organization\'s scheduler hour, then runs once a day', async () => {
    const o = await makeOrg('2026-10-28T00:00:00Z'); // 07:00 in Jakarta, before the 08:00 default
    const clock = fixedClock('2026-10-28T00:00:00Z');
    const state: TickState = new Map();
    const log: string[] = [];
    await runTick(state, clock, rules(log));
    expect(log).not.toContain(o.orgId);
    clock.set('2026-10-28T01:30:00Z'); // 08:30
    await runTick(state, clock, rules(log));
    expect(log.filter((x) => x === o.orgId)).toHaveLength(1);
    clock.set('2026-10-28T08:00:00Z'); // same day, later
    await runTick(state, clock, rules(log));
    expect(log.filter((x) => x === o.orgId)).toHaveLength(1);
    clock.set('2026-10-29T01:30:00Z'); // next morning
    await runTick(state, clock, rules(log));
    expect(log.filter((x) => x === o.orgId)).toHaveLength(2);
  });

  it('follows each organization\'s own hour and time zone', async () => {
    const o = await makeOrg();
    await db.update(organizations).set({ timezone: 'Asia/Makassar', schedulerHour: 9 }).where(eq(organizations.id, o.orgId));
    const clock = fixedClock('2026-10-28T00:30:00Z'); // 08:30 in Makassar (UTC+8): before 9
    const state: TickState = new Map();
    const log: string[] = [];
    await runTick(state, clock, rules(log));
    expect(log).not.toContain(o.orgId);
    clock.set('2026-10-28T01:05:00Z'); // 09:05 in Makassar
    await runTick(state, clock, rules(log));
    expect(log).toContain(o.orgId);
  });

  it('does nothing while another process holds the lock, and tries again next tick', async () => {
    const o = await makeOrg('2026-10-28T03:00:00Z');
    const clock = fixedClock('2026-10-28T03:00:00Z');
    const state: TickState = new Map();
    const log: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${TICKER_LOCK_KEY})`);
      await held;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(await runTick(state, clock, rules(log))).toEqual([]);
    expect(log).not.toContain(o.orgId);
    release();
    await holder;
    expect(await runTick(state, clock, rules(log))).toContain(o.orgId);
  });

  it('retries an organization whose rules failed, without stopping the others', async () => {
    const a = await makeOrg('2026-10-28T03:00:00Z');
    const b = await makeOrg('2026-10-28T03:00:00Z');
    const clock = fixedClock('2026-10-28T03:00:00Z');
    const state: TickState = new Map();
    const seen: string[] = [];
    let fail = true;
    const flaky = async (orgId: string) => {
      seen.push(orgId);
      if (fail && orgId === a.orgId) throw new Error('boom');
      return { renewalDrafts: 0, overdueRaised: 0 };
    };
    const quiet = console.error;
    console.error = () => {};
    const first = await runTick(state, clock, flaky);
    console.error = quiet;
    expect(first).toContain(b.orgId);
    expect(first).not.toContain(a.orgId);
    fail = false;
    expect(await runTick(state, clock, flaky)).toContain(a.orgId);
  });
});
