import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, findings } from '../../../db/schema';
import { emitTaskLate } from '../../action-center/rules';
import { sweepFindings } from '../../action-center/findings';
import { makeOrg } from '../../ai/__tests__/support';
import type { Ctx } from '../../ctx';
import { createClient } from '../../portfolio/clients';
import { createDeployment } from '../../portfolio/deployments';
import { createProduct } from '../../portfolio/products';
import { acceptTaskDraft, createTask, discardTaskDraft, findSimilarTasks, getTask, getTaskSummary, linkRelatedTask, listTasks, setTaskStatus, updateTask } from '../service';

afterAll(async () => {
  await pg.end();
});

const aiCtx = (ctx: Ctx): Ctx => ({ ...ctx, actor: 'ai:run-1', aiRunId: 'run-1' });

// makeOrg starts the clock at 2026-10-28 10:00 in Jakarta.

describe('creating tasks (BRD-M05 section 10)', () => {
  it('gives a Bug for a client a default due date from its priority, and records it', async () => {
    const o = await makeOrg();
    const client = (await createClient(o.ownerCtx, { name: 'Klinik Sehat' })).id;
    const { id, dueDate } = await createTask(o.ownerCtx, { title: 'Pengingat tidak terkirim', kind: 'bug', priority: 'high', clientId: client });
    expect(dueDate).toBe('2026-10-31');
    const task = await getTask(o.ownerCtx, id);
    expect(task).toMatchObject({ kind: 'bug', status: 'open', priority: 'high', clientName: 'Klinik Sehat', late: false, isDraft: false, nextStatuses: ['in_progress', 'done'] });
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.entityId, id)));
    expect(audit.map((a) => a.action)).toEqual(['task.created']);
  });

  it('fills the client and product from a deployment, and refuses a mismatch', async () => {
    const o = await makeOrg();
    const product = (await createProduct(o.ownerCtx, { name: 'Orbit POS', currentVersion: '1.0.0' })).id;
    const client = (await createClient(o.ownerCtx, { name: 'Kopi Senja' })).id;
    const other = (await createClient(o.ownerCtx, { name: 'Toko Lain' })).id;
    const deployment = (await createDeployment(o.ownerCtx, { productId: product, clientId: client, environment: 'production', installedVersion: '1.0.0' })).id;
    const { id } = await createTask(o.ownerCtx, { title: 'Struk salah alamat', kind: 'bug', deploymentId: deployment });
    expect(await getTask(o.ownerCtx, id)).toMatchObject({ clientId: client, productId: product, deploymentId: deployment });
    await expect(createTask(o.ownerCtx, { title: 'Salah klien', deploymentId: deployment, clientId: other })).rejects.toMatchObject({ code: 'validation' });
  });

  it('refuses a client of another organization (BR-M05-08)', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const foreign = (await createClient(b.ownerCtx, { name: 'Milik Org Lain' })).id;
    await expect(createTask(a.ownerCtx, { title: 'Bocor', clientId: foreign })).rejects.toMatchObject({ code: 'not_found' });
    const mine = await createTask(a.ownerCtx, { title: 'Tugas org A' });
    await expect(getTask(b.ownerCtx, mine.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await listTasks(b.ownerCtx)).toEqual([]);
  });
});

describe('late is derived, never written (BR-M05-03)', () => {
  it('turns late when the clock passes the due date, with no job touching the row', async () => {
    const o = await makeOrg();
    const { id } = await createTask(o.ownerCtx, { title: 'Backup bulanan', kind: 'maintenance', dueDate: '2026-10-29' });
    expect((await getTask(o.ownerCtx, id)).late).toBe(false);
    o.clock.set('2026-10-31T03:00:00Z');
    expect(await getTask(o.ownerCtx, id)).toMatchObject({ late: true, daysLate: 2, status: 'open' });
    expect((await getTaskSummary(o.ownerCtx)).late).toBe(1);
    await setTaskStatus(o.ownerCtx, id, 'done');
    expect(await getTask(o.ownerCtx, id)).toMatchObject({ late: false, status: 'done' });
  });

  it('raises one late-task finding per due date, and closes it by itself once the task is done', async () => {
    const o = await makeOrg();
    const { id } = await createTask(o.ownerCtx, { title: 'Upgrade POS', kind: 'maintenance', dueDate: '2026-10-20' });
    const now = o.clock.now();
    expect((await emitTaskLate(o.orgId, now)).raised).toEqual([id]);
    expect((await emitTaskLate(o.orgId, now)).raised).toEqual([]); // idempotent
    const [finding] = await db.select().from(findings).where(and(eq(findings.orgId, o.orgId), eq(findings.entityId, id)));
    expect(finding).toMatchObject({ rule: 'task_late', status: 'new', periodKey: '2026-10-20' });
    await setTaskStatus(o.ownerCtx, id, 'done');
    await sweepFindings(o.orgId, now);
    const [after] = await db.select().from(findings).where(eq(findings.id, finding.id));
    expect(after.status).toBe('auto_resolved');
  });
});

describe('AI drafts (BR-M05-05)', () => {
  it('keeps a task made by an AI run out of the open count until a person accepts it', async () => {
    const o = await makeOrg();
    const { id, isDraft } = await createTask(aiCtx(o.ownerCtx), { title: 'Laporan stok harian', kind: 'feature', dueDate: '2026-10-01' }, { source: 'meeting', sourceQuote: 'minta laporan stok tiap malam' });
    expect(isDraft).toBe(true);
    expect(await getTaskSummary(o.ownerCtx)).toMatchObject({ open: 0, late: 0, drafts: 1 });
    expect(await getTask(o.ownerCtx, id)).toMatchObject({ late: false, nextStatuses: [], source: 'meeting', sourceQuote: 'minta laporan stok tiap malam' });
    await expect(setTaskStatus(o.ownerCtx, id, 'in_progress')).rejects.toMatchObject({ code: 'invalid_state' });
    await acceptTaskDraft(o.ownerCtx, id);
    expect(await getTaskSummary(o.ownerCtx)).toMatchObject({ open: 1, late: 1, drafts: 0 });
  });

  it('never lets an AI run move, edit or accept a task', async () => {
    const o = await makeOrg();
    const { id } = await createTask(o.ownerCtx, { title: 'Tugas biasa' });
    await expect(setTaskStatus(aiCtx(o.ownerCtx), id, 'done')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateTask(aiCtx(o.ownerCtx), id, { priority: 'urgent' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(linkRelatedTask(aiCtx(o.ownerCtx), id, null)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('discards only drafts', async () => {
    const o = await makeOrg();
    const draft = await createTask(aiCtx(o.ownerCtx), { title: 'Draf AI' });
    const real = await createTask(o.ownerCtx, { title: 'Tugas nyata' });
    await expect(discardTaskDraft(o.ownerCtx, real.id)).rejects.toMatchObject({ code: 'invalid_state' });
    await discardTaskDraft(o.ownerCtx, draft.id);
    await expect(getTask(o.ownerCtx, draft.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('who may change a task (BR-M05-07, PRD section 3)', () => {
  it('lets staff close only their own tasks', async () => {
    const o = await makeOrg();
    const mine = await createTask(o.ownerCtx, { title: 'Milik staf', assigneeId: o.staffCtx.userId });
    const theirs = await createTask(o.ownerCtx, { title: 'Milik admin', assigneeId: o.adminCtx.userId });
    await setTaskStatus(o.staffCtx, mine.id, 'done');
    await expect(setTaskStatus(o.staffCtx, theirs.id, 'done')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateTask(o.staffCtx, theirs.id, { title: 'Diubah staf' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await getTask(o.staffCtx, theirs.id)).canEdit).toBe(false);
    await setTaskStatus(o.adminCtx, theirs.id, 'done'); // a manager may close any task
  });

  it('lets staff create work and take it, but not hand it to someone else', async () => {
    const o = await makeOrg();
    await expect(createTask(o.staffCtx, { title: 'Untuk admin', assigneeId: o.adminCtx.userId })).rejects.toMatchObject({ code: 'forbidden' });
    const { id } = await createTask(o.staffCtx, { title: 'Saya kerjakan' });
    await updateTask(o.staffCtx, id, { assigneeId: o.staffCtx.userId });
    await setTaskStatus(o.staffCtx, id, 'in_progress');
    const assigned = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'task.assigned')));
    expect(assigned).toHaveLength(1);
  });
});

describe('status moves (BR-M05-01, BR-M05-09)', () => {
  it('stamps the finish time, clears it on reopen, refuses a skipped step, and audits each move', async () => {
    const o = await makeOrg();
    const { id } = await createTask(o.ownerCtx, { title: 'Serah terima' });
    await setTaskStatus(o.ownerCtx, id, 'done');
    expect((await getTask(o.ownerCtx, id)).completedAt).not.toBeNull();
    await expect(setTaskStatus(o.ownerCtx, id, 'in_progress')).rejects.toMatchObject({ code: 'invalid_state' });
    await setTaskStatus(o.ownerCtx, id, 'open');
    expect((await getTask(o.ownerCtx, id)).completedAt).toBeNull();
    const moves = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'task.status_changed')));
    expect(moves.map((m) => m.summary)).toEqual([{ from: 'open', to: 'done' }, { from: 'done', to: 'open' }]);
  });
});

describe('similar tasks (BR-M05-06)', () => {
  it('suggests a task that reads alike and links the two without losing either', async () => {
    const o = await makeOrg();
    const a = await createTask(o.ownerCtx, { title: 'Pengingat jadwal tidak terkirim untuk janji temu pagi', description: 'Pasien tidak menerima pengingat' });
    const b = await createTask(o.ownerCtx, { title: 'Pengingat WhatsApp terlambat dikirim ke pasien klinik', description: 'Pengingat janji temu datang terlambat' });
    await createTask(o.ownerCtx, { title: 'Ekspor laporan pipeline ke CSV' });
    const similar = await findSimilarTasks(o.ownerCtx, { taskId: b.id });
    expect(similar.map((s) => s.id)).toEqual([a.id]);

    await linkRelatedTask(o.ownerCtx, b.id, a.id);
    expect((await getTask(o.ownerCtx, b.id)).related).toEqual([{ id: a.id, title: expect.any(String), status: 'open', direction: 'parent' }]);
    expect((await getTask(o.ownerCtx, a.id)).related).toEqual([{ id: b.id, title: expect.any(String), status: 'open', direction: 'child' }]);
    expect(await listTasks(o.ownerCtx)).toHaveLength(3); // nothing merged or deleted
    expect(await findSimilarTasks(o.ownerCtx, { taskId: b.id })).toEqual([]); // already linked
    await expect(linkRelatedTask(o.ownerCtx, a.id, b.id)).rejects.toMatchObject({ code: 'invalid_state' }); // no loop
    await expect(linkRelatedTask(o.ownerCtx, a.id, a.id)).rejects.toMatchObject({ code: 'validation' });
    await linkRelatedTask(o.ownerCtx, b.id, null);
    expect((await getTask(o.ownerCtx, b.id)).related).toEqual([]);
  });
});

describe('listing', () => {
  it('filters by assignee and late, and leaves finished work out unless asked', async () => {
    const o = await makeOrg();
    const late = await createTask(o.ownerCtx, { title: 'Terlambat', dueDate: '2026-10-01', assigneeId: o.ownerCtx.userId });
    await createTask(o.ownerCtx, { title: 'Masih lama', dueDate: '2026-12-01' });
    const done = await createTask(o.ownerCtx, { title: 'Sudah beres' });
    await setTaskStatus(o.ownerCtx, done.id, 'done');
    expect((await listTasks(o.ownerCtx)).map((t) => t.title)).toEqual(['Terlambat', 'Masih lama']);
    expect((await listTasks(o.ownerCtx, { late: true })).map((t) => t.id)).toEqual([late.id]);
    expect((await listTasks(o.ownerCtx, { assignee: 'me' })).map((t) => t.id)).toEqual([late.id]);
    expect(await listTasks(o.ownerCtx, { includeDone: true })).toHaveLength(3);
    expect((await getTaskSummary(o.ownerCtx)).mine).toBe(1);
  });
});

describe('sweep and newer rules', () => {
  it('never closes a finding whose kind of record this build cannot read', async () => {
    const o = await makeOrg();
    const [row] = await db.insert(findings).values({ orgId: o.orgId, rule: 'lead_stagnant', entityType: 'record-kind-from-a-newer-build', entityId: 'x-from-a-newer-build', periodKey: '2026-W44' }).returning({ id: findings.id });
    await sweepFindings(o.orgId, o.clock.now());
    const [after] = await db.select({ status: findings.status }).from(findings).where(eq(findings.id, row.id));
    expect(after.status).toBe('new');
  });
});
