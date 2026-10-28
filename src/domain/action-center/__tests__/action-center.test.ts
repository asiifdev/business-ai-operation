import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { callTools, FakeProvider, say } from '../../../ai/fake-provider';
import { db, pg } from '../../../db/client';
import { approvals, auditLog, findings, invoices } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import { setAiBudget } from '../../ai/budget';
import { createInvoiceDraft, getInvoice, markInvoiceSent } from '../../billing/invoices';
import { recordPayment } from '../../billing/payments';
import { emitOverdueFindings, runBillingRules } from '../../billing/rules';
import { getFinanceSummary } from '../../billing/summary';
import { createSubscription } from '../../billing/subscriptions';
import { createClient } from '../../portfolio/clients';
import { createPackage, createProduct } from '../../portfolio/products';
import { decideApproval, expireApprovals, listPendingApprovals } from '../approvals';
import { generateBriefing } from '../briefing';
import { explainFinding } from '../explain';
import { getFinding, listFindings, setFindingStatus, updateFindingDraft } from '../findings';
import { emitRenewalUpcoming } from '../rules';

afterAll(async () => {
  await pg.end();
});

const item = (unitPrice: number) => [{ description: 'Layanan', quantity: 1, unitPrice }];

/** An organization with one client and one sent invoice that falls due on 30/10/2026. */
async function overdueWorld() {
  const o = await makeOrg('2026-10-28T03:00:00Z');
  const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
  const inv = await createInvoiceDraft(o.ownerCtx, { clientId: client.id, dueDate: '2026-10-30', items: item(500_000) });
  await markInvoiceSent(o.ownerCtx, inv.id);
  o.clock.set('2026-11-05T03:00:00Z'); // six days late
  await emitOverdueFindings(o.orgId, o.clock.now());
  const [finding] = await db.select().from(findings).where(and(eq(findings.orgId, o.orgId), eq(findings.rule, 'invoice_overdue')));
  return { o, client: client.id, invoiceId: inv.id, findingId: finding.id };
}

/** An organization whose renewal draft was just prepared by the scheduler: one "draft ready" finding. */
async function draftWorld() {
  const o = await makeOrg('2026-10-28T03:00:00Z');
  const client = await createClient(o.ownerCtx, { name: 'Kopi Senja' });
  const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
  const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });
  await createSubscription(o.ownerCtx, { clientId: client.id, packageId: pkg.id, startedOn: '2026-10-01', nextDueDate: '2026-11-01' });
  await runBillingRules(o.orgId, o.clock.now());
  const [finding] = await db.select().from(findings).where(and(eq(findings.orgId, o.orgId), eq(findings.rule, 'invoice_draft_ready')));
  return { o, invoiceId: finding.entityId, findingId: finding.id };
}

const explanationFor = (amount: string) => `PENJELASAN:\nDraf perpanjangan sebesar ${amount} sudah siap ditinjau.\nDRAF PESAN:\nHalo, berikut tagihan perpanjangan sebesar ${amount}.`;

describe('findings and cards (BRD-M08 section 10)', () => {
  it('shows an overdue invoice as one card whose figures equal the invoice, read live', async () => {
    const { o, invoiceId, findingId } = await overdueWorld();
    await emitOverdueFindings(o.orgId, o.clock.now()); // running the rule again changes nothing
    const { findings: cards } = await listFindings(o.ownerCtx, 'open');
    expect(cards.filter((c) => c.rule === 'invoice_overdue')).toHaveLength(1);
    const card = cards.find((c) => c.id === findingId)!;
    const inv = await getInvoice(o.ownerCtx, invoiceId);
    expect(card.facts).toMatchObject({ kind: 'invoice', number: inv.invoice.number, balance: inv.derived.balance, daysOverdue: inv.derived.daysOverdue, overdue: true });
    expect(card.facts.kind === 'invoice' && card.facts.daysOverdue).toBe(6);
    expect(card.priority.level).toBe('high');
  });

  it('hides money findings from staff, as for viewing invoices', async () => {
    const { o, findingId } = await overdueWorld();
    expect((await listFindings(o.staffCtx, 'open')).findings).toEqual([]);
    await expect(getFinding(o.staffCtx, findingId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(setFindingStatus(o.staffCtx, findingId, { action: 'ignore' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('closes a finding by itself once the invoice is paid', async () => {
    const { o, invoiceId, findingId } = await overdueWorld();
    await recordPayment(o.ownerCtx, invoiceId, { amount: 500_000, paidOn: '2026-11-05', method: 'transfer' });
    expect((await listFindings(o.ownerCtx, 'open')).findings.map((c) => c.id)).not.toContain(findingId);
    expect((await getFinding(o.ownerCtx, findingId)).status).toBe('auto_resolved');
  });

  it('moves a finding once: handled, snoozed and woken, ignored; a closed one does not move again', async () => {
    const { o, findingId } = await overdueWorld();
    await setFindingStatus(o.adminCtx, findingId, { action: 'snooze', days: 1 });
    expect((await listFindings(o.ownerCtx, 'snoozed')).findings.map((c) => c.id)).toContain(findingId);
    o.clock.set('2026-11-06T04:00:00Z');
    expect((await listFindings(o.ownerCtx, 'open')).findings.map((c) => c.id)).toContain(findingId); // woke up
    const results = await Promise.allSettled([setFindingStatus(o.ownerCtx, findingId, { action: 'handle' }), setFindingStatus(o.adminCtx, findingId, { action: 'handle' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(setFindingStatus(o.ownerCtx, findingId, { action: 'ignore' })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(updateFindingDraft(o.ownerCtx, findingId, { draftMessage: 'x' })).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('raises "subscription due soon" once, and closes it when the renewal is invoiced', async () => {
    const o = await makeOrg('2026-10-28T03:00:00Z');
    const client = await createClient(o.ownerCtx, { name: 'Bumi Kreatif' });
    const product = await createProduct(o.ownerCtx, { name: 'Orbit HR' });
    const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Dasar', monthlyPrice: 300_000 });
    const sub = await createSubscription(o.ownerCtx, { clientId: client.id, packageId: pkg.id, startedOn: '2026-10-02', nextDueDate: '2026-11-02' });
    await Promise.all([emitRenewalUpcoming(o.orgId, o.clock.now()), emitRenewalUpcoming(o.orgId, o.clock.now())]);
    const rows = await db.select().from(findings).where(and(eq(findings.orgId, o.orgId), eq(findings.rule, 'renewal_upcoming')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: 'subscription', entityId: sub.id, periodKey: '2026-11-02' });
    await runBillingRules(o.orgId, o.clock.now()); // the scheduler drafts the renewal
    expect((await listFindings(o.ownerCtx, 'open')).findings.map((c) => c.rule)).toEqual(['invoice_draft_ready']); // the draft card takes over
    expect((await getFinding(o.ownerCtx, rows[0].id)).status).toBe('auto_resolved');
  });
});

describe('AI explanation (BR-M08-03, -10, -11)', () => {
  it('saves one grounded explanation and draft, reuses it, and sends nothing', async () => {
    const { o, findingId } = await overdueWorld();
    const provider = new FakeProvider({
      chat: [
        callTools([{ name: 'get_finding_facts', args: {} }]),
        say('PENJELASAN:\nInvoice Aksara Studio terlambat 6 hari dengan sisa Rp 500.000.\nDRAF PESAN:\nHalo, kami mengingatkan sisa tagihan Rp 500.000 yang jatuh tempo 30/10/2026.'),
      ],
    });
    const first = await explainFinding(o.ownerCtx, findingId, { provider });
    expect(first.ok).toBe(true);
    expect(first.card.explanation).toContain('terlambat 6 hari');
    expect(first.card.draftMessage).toContain('Rp 500.000');
    expect(first.card.aiRunId).toBeTruthy();
    const again = await explainFinding(o.ownerCtx, findingId, { provider: new FakeProvider() }); // no script: would throw if called
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(await db.select().from(approvals).where(eq(approvals.orgId, o.orgId))).toHaveLength(0); // an overdue card proposes no action
  });

  it('refuses an explanation with a number the facts do not have, and keeps the card usable', async () => {
    const { o, findingId } = await overdueWorld();
    const wrong = 'PENJELASAN:\nSisa tagihan Rp 750.000.\nDRAF PESAN:\n-';
    const provider = new FakeProvider({ chat: [callTools([{ name: 'get_finding_facts', args: {} }]), say(wrong), say(wrong)] });
    const out = await explainFinding(o.ownerCtx, findingId, { provider });
    expect(out.ok).toBe(false);
    expect(out.card.explanation).toBeNull();
  });

  it('when the AI budget is used up the card still shows, labelled as not AI', async () => {
    const { o, findingId } = await overdueWorld();
    await setAiBudget(db, o.ownerCtx, 'agent', 0);
    const out = await explainFinding(o.ownerCtx, findingId, { provider: new FakeProvider() });
    expect(out.ok).toBe(false);
    expect(out.message).toBeTruthy();
    expect((await listFindings(o.ownerCtx, 'open')).findings.map((c) => c.id)).toContain(findingId);
  });
});

describe('approvals (BR-M08-04 to -08)', () => {
  async function proposed() {
    const w = await draftWorld();
    const provider = new FakeProvider({
      chat: [callTools([{ name: 'get_finding_facts', args: {} }, { name: 'mark_invoice_sent', args: { invoiceId: w.invoiceId } }]), say(explanationFor('Rp 450.000'))],
    });
    const out = await explainFinding(w.o.ownerCtx, w.findingId, { provider });
    expect(out.pendingApprovals).toHaveLength(1);
    return { ...w, approvalId: out.pendingApprovals[0].id };
  }

  it('turns the proposal into a pending approval with the exact arguments; nothing runs yet', async () => {
    const { o, invoiceId, approvalId } = await proposed();
    const [pending] = await listPendingApprovals(o.ownerCtx);
    expect(pending).toMatchObject({ id: approvalId, tool: 'mark_invoice_sent', args: { invoiceId }, canDecide: true, financial: true });
    expect(pending.target).toMatchObject({ invoiceId, status: 'draft' });
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv.status).toBe('draft');
  });

  it('runs the approved action through the same service, as the approver, with the AI run in the audit trail', async () => {
    const { o, invoiceId, findingId, approvalId } = await proposed();
    const out = await decideApproval(o.adminCtx, approvalId, { decision: 'approve' });
    expect(out).toEqual({ status: 'approved', executed: true });
    const inv = await getInvoice(o.ownerCtx, invoiceId);
    expect(inv.invoice.status).toBe('sent');
    expect(inv.invoice.number).toMatch(/^INV-2026-/);
    const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    const [sent] = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.entityId, invoiceId), eq(auditLog.action, 'invoice.sent')));
    expect(sent.actor).toBe(`user:${o.adminCtx.userId}`);
    expect(sent.aiRunId).toBe(approval.aiRunId);
    expect((await getFinding(o.ownerCtx, findingId)).status).toBe('handled');
  });

  it('lets exactly one of two simultaneous decisions win (web and Telegram)', async () => {
    const { o, approvalId } = await proposed();
    const results = await Promise.allSettled([decideApproval(o.ownerCtx, approvalId, { decision: 'approve' }), decideApproval(o.adminCtx, approvalId, { decision: 'approve' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'already_decided' } });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'invoice.sent')))).toHaveLength(1);
  });

  it('never lets staff approve a money action', async () => {
    const { o, approvalId } = await proposed();
    await expect(decideApproval(o.staffCtx, approvalId, { decision: 'approve' })).rejects.toBeTruthy();
    const [row] = await db.select({ status: approvals.status }).from(approvals).where(eq(approvals.id, approvalId));
    expect(row.status).toBe('pending');
  });

  it('refuses an expired approval and runs nothing', async () => {
    const { o, invoiceId, approvalId } = await proposed();
    o.clock.set('2026-10-29T04:00:00Z'); // 25 hours later; the default lifetime is 24
    await expect(decideApproval(o.ownerCtx, approvalId, { decision: 'approve' })).rejects.toMatchObject({ code: 'expired' });
    expect(await expireApprovals(o.orgId, o.clock.now())).toBe(0); // already marked
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv.status).toBe('draft');
  });

  it('refuses with a reason when the data changed before the decision, and the finding closes itself', async () => {
    const { o, invoiceId, findingId, approvalId } = await proposed();
    await markInvoiceSent(o.ownerCtx, invoiceId); // someone sent it by hand meanwhile
    const out = await decideApproval(o.ownerCtx, approvalId, { decision: 'approve' });
    expect(out).toEqual({ status: 'rejected', executed: false, reason: 'invalid_state' });
    expect((await getFinding(o.ownerCtx, findingId)).status).toBe('auto_resolved');
    expect(await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'invoice.sent')))).toHaveLength(1);
  });

  it('a rejection changes nothing', async () => {
    const { o, invoiceId, approvalId } = await proposed();
    expect(await decideApproval(o.ownerCtx, approvalId, { decision: 'reject' })).toEqual({ status: 'rejected', executed: false });
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv.status).toBe('draft');
  });
});

describe('daily briefing (BR-M08-13)', () => {
  it('holds the same numbers as the dashboard and is written once a day', async () => {
    const { o } = await overdueWorld();
    const provider = new FakeProvider({ chat: [say('Ada 1 invoice lewat jatuh tempo senilai Rp 500.000. Mulai dari Action Center.')] });
    const briefing = await generateBriefing(o.ownerCtx, { provider });
    const finance = await getFinanceSummary(o.ownerCtx);
    expect(briefing.facts).toMatchObject({ mrr: finance.mrr, receivedThisMonth: finance.receivedThisMonth, outstanding: finance.outstanding, overdue: { amount: finance.overdue.amount, count: finance.overdue.count } });
    expect(briefing.facts.openFindings).toBe(1);
    expect(briefing.isAi).toBe(true);
    expect((await generateBriefing(o.ownerCtx, { provider: new FakeProvider() })).createdAt).toEqual(briefing.createdAt);
  });

  it('drops wording with a number that is not in the data: numbers only, not an AI result', async () => {
    const { o } = await overdueWorld();
    const briefing = await generateBriefing(o.ownerCtx, { provider: new FakeProvider({ chat: [say('Pendapatan naik 12% bulan ini.')] }) });
    expect(briefing).toMatchObject({ isAi: false, narrative: null });
  });

  it('is for managers only', async () => {
    const { o } = await overdueWorld();
    await expect(generateBriefing(o.staffCtx, { provider: new FakeProvider() })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
