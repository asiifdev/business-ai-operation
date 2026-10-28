import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { clients, leads, organizations, tasks } from '../../db/schema';
import { recordAudit } from '../audit/service';
import { todayIn } from '../billing/dates';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { nameField, nameKey, optionalText, tidyName, who, MAX_PRICE } from '../portfolio/shared';
import { allowedMoves, canMove, daysInStage, isFinalStage, isStagnant, ONBOARDING_CHECKLIST, onboardingDueDate, OPEN_STAGES, pipelineValue, type Stage } from './stages';

const leadFields = z.object({
  name: nameField,
  contactName: optionalText(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .transform((v) => (v === '' ? null : v))
    .pipe(z.string().email().nullable())
    .optional(),
  phone: optionalText(40),
  source: optionalText(80),
  needsSummary: optionalText(4000),
  estimatedValue: z.number().int().min(0).max(MAX_PRICE).nullable().optional(),
  assignedTo: z.string().min(1).nullable().optional(),
});
export const leadSchema = leadFields;
export const leadPatchSchema = leadFields.partial();

const FIELDS = ['name', 'contactName', 'email', 'phone', 'source', 'needsSummary', 'estimatedValue', 'assignedTo'] as const;

async function loadLead(tx: Pick<typeof db, 'select'>, orgId: string, id: string) {
  const [row] = await tx.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, id)));
  if (!row) throw new DomainError('not_found', 'lead');
  return row;
}

/** Managers may touch any lead; staff only the ones assigned to them (PRD section 3). */
function assertCanTouch(ctx: Ctx, lead: { assignedTo: string | null }) {
  if (can(ctx.role, 'lead.write')) return;
  if (can(ctx.role, 'lead.update_assigned') && lead.assignedTo === ctx.userId) return;
  throw new DomainError('forbidden', `${ctx.role} may not change this lead`);
}

const isAi = (ctx: Ctx) => ctx.actor.startsWith('ai:');

/**
 * Creates a lead. A lead made by an AI run (a recording, a Telegram message) is a DRAFT: it stays out of the pipeline value
 * and cannot be moved until a person accepts it (BR-M04-06).
 */
export async function createLead(ctx: Ctx, raw: z.input<typeof leadSchema>, opts: { meetingId?: string } = {}) {
  assertCan(ctx, 'lead.write');
  const input = leadSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(leads)
      .values({
        orgId: ctx.orgId,
        name: input.name,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        source: input.source ?? null,
        needsSummary: input.needsSummary ?? null,
        estimatedValue: input.estimatedValue ?? null,
        assignedTo: input.assignedTo ?? null,
        isDraft: isAi(ctx),
        meetingId: opts.meetingId ?? null,
        stageChangedAt: ctx.clock.now(),
      })
      .returning({ id: leads.id });
    await recordAudit(tx, who(ctx), { action: 'lead.created', entityType: 'lead', entityId: row.id, summary: { name: input.name, draft: isAi(ctx) } });
    return { id: row.id };
  });
}

export async function updateLead(ctx: Ctx, id: string, raw: z.input<typeof leadPatchSchema>) {
  const patch = leadPatchSchema.parse(raw);
  await db.transaction(async (tx) => {
    const before = await loadLead(tx, ctx.orgId, id);
    assertCanTouch(ctx, before);
    if (before.archivedAt) throw new DomainError('invalid_state', 'archived lead');
    // Handing a lead to someone else is a manager's call.
    if (patch.assignedTo !== undefined && patch.assignedTo !== before.assignedTo) assertCan(ctx, 'lead.write');
    const set: Partial<typeof leads.$inferInsert> = {};
    const changed: string[] = [];
    for (const key of FIELDS) {
      if (patch[key] !== undefined && patch[key] !== before[key]) {
        set[key] = patch[key] as never;
        changed.push(key);
      }
    }
    if (changed.length === 0) return;
    await tx.update(leads).set(set).where(and(eq(leads.orgId, ctx.orgId), eq(leads.id, id)));
    // Which fields changed, never their values: contact details are personal data (BR-M15-06).
    await recordAudit(tx, who(ctx), { action: 'lead.updated', entityType: 'lead', entityId: id, summary: { fields: changed } });
  });
}

/** A person accepts an AI draft: from now on it counts in the pipeline and can move (BR-M04-06). */
export async function acceptLeadDraft(ctx: Ctx, id: string) {
  assertCan(ctx, 'lead.write');
  await db.transaction(async (tx) => {
    const lead = await loadLead(tx, ctx.orgId, id);
    if (!lead.isDraft) return;
    await tx.update(leads).set({ isDraft: false, stageChangedAt: ctx.clock.now() }).where(and(eq(leads.orgId, ctx.orgId), eq(leads.id, id)));
    await recordAudit(tx, who(ctx), { action: 'lead.draft_accepted', entityType: 'lead', entityId: id, summary: { name: lead.name } });
  });
}

/** Moves a lead to another stage. The service, not the screen, decides what is allowed (BR-M04-02, -03). */
export async function moveLead(ctx: Ctx, id: string, to: Stage, opts: { lostReason?: string } = {}) {
  if (isAi(ctx)) throw new DomainError('forbidden', 'an AI run may only suggest a stage change (BRD-M04 section 2)');
  await db.transaction(async (tx) => {
    const lead = await loadLead(tx, ctx.orgId, id);
    assertCanTouch(ctx, lead);
    // Closing a lead as won or lost is for managers.
    if (to === 'won' || to === 'lost') assertCan(ctx, 'lead.write');
    if (lead.isDraft) throw new DomainError('invalid_state', 'accept the AI draft before moving it');
    if (lead.archivedAt) throw new DomainError('invalid_state', 'archived lead');
    if (!canMove(lead.stage, to)) throw new DomainError('invalid_state', `a lead cannot go from ${lead.stage} to ${to}`);
    const reason = opts.lostReason?.trim();
    if (to === 'lost' && !reason) throw new DomainError('validation', 'a lost lead needs a reason');
    await tx
      .update(leads)
      .set({ stage: to, stageChangedAt: ctx.clock.now(), lostReason: to === 'lost' ? reason! : null })
      .where(and(eq(leads.orgId, ctx.orgId), eq(leads.id, id)));
    await recordAudit(tx, who(ctx), { action: 'lead.stage_changed', entityType: 'lead', entityId: id, summary: { from: lead.stage, to, ...(to === 'lost' ? { reason } : {}) } });
  });
}

/** Won and Lost are final, but a manager can reopen one with a note (BR-M04-01). A lead already turned into a client cannot be reopened. */
export async function reopenLead(ctx: Ctx, id: string, opts: { note: string; to?: (typeof OPEN_STAGES)[number] }) {
  assertCan(ctx, 'lead.write');
  const note = opts.note?.trim();
  if (!note) throw new DomainError('validation', 'reopening a lead needs a note');
  await db.transaction(async (tx) => {
    const lead = await loadLead(tx, ctx.orgId, id);
    if (!isFinalStage(lead.stage)) throw new DomainError('invalid_state', 'the lead is not closed');
    if (lead.convertedClientId) throw new DomainError('invalid_state', 'this lead already became a client');
    const to = opts.to ?? 'new';
    await tx.update(leads).set({ stage: to, stageChangedAt: ctx.clock.now(), lostReason: null }).where(and(eq(leads.orgId, ctx.orgId), eq(leads.id, id)));
    await recordAudit(tx, who(ctx), { action: 'lead.reopened', entityType: 'lead', entityId: id, summary: { from: lead.stage, to, note } });
  });
}

export async function setLeadArchived(ctx: Ctx, id: string, archived: boolean) {
  assertCan(ctx, 'lead.write');
  await db.transaction(async (tx) => {
    const lead = await loadLead(tx, ctx.orgId, id);
    if (Boolean(lead.archivedAt) === archived) return;
    await tx.update(leads).set({ archivedAt: archived ? ctx.clock.now() : null }).where(and(eq(leads.orgId, ctx.orgId), eq(leads.id, id)));
    await recordAudit(tx, who(ctx), { action: archived ? 'lead.archived' : 'lead.unarchived', entityType: 'lead', entityId: id, summary: { name: lead.name } });
  });
}

export interface LeadRow {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  needsSummary: string | null;
  estimatedValue: number | null;
  stage: Stage;
  stageChangedAt: Date;
  lostReason: string | null;
  assignedTo: string | null;
  convertedClientId: string | null;
  isDraft: boolean;
  archivedAt: Date | null;
  /** Derived (BR-M04-08): open, accepted, and idle for longer than the organization's threshold. */
  isStagnant: boolean;
  daysInStage: number;
  /** Where this lead may go next, so a button board never offers an invalid move. */
  nextStages: Stage[];
}

async function orgSettings(tx: Pick<typeof db, 'select'>, orgId: string) {
  const [org] = await tx.select({ stagnantDays: organizations.stagnantDays, timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId));
  return org;
}

function toRow(l: typeof leads.$inferSelect, stagnantDays: number, now: Date): LeadRow {
  return { ...l, isStagnant: isStagnant(l, stagnantDays, now), daysInStage: daysInStage(l.stageChangedAt, now), nextStages: l.isDraft || l.archivedAt ? [] : allowedMoves(l.stage) };
}

export async function listLeads(ctx: Ctx, opts: { stage?: Stage; includeArchived?: boolean } = {}): Promise<LeadRow[]> {
  assertCan(ctx, 'lead.read');
  const org = await orgSettings(db, ctx.orgId);
  const now = ctx.clock.now();
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, ctx.orgId), opts.stage ? eq(leads.stage, opts.stage) : undefined, opts.includeArchived ? undefined : isNull(leads.archivedAt)))
    .orderBy(asc(leads.isDraft), desc(leads.stageChangedAt));
  return rows.map((l) => toRow(l, org.stagnantDays, now));
}

export async function getLead(ctx: Ctx, id: string): Promise<LeadRow> {
  assertCan(ctx, 'lead.read');
  const org = await orgSettings(db, ctx.orgId);
  return toRow(await loadLead(db, ctx.orgId, id), org.stagnantDays, ctx.clock.now());
}

export interface PipelineSummary {
  perStage: Array<{ stage: Stage; count: number; value: number }>;
  /** Sum of estimated values of open, accepted leads (BR-M04-07). */
  value: number;
  stagnant: number;
  drafts: number;
}

/** The single place pipeline numbers are computed (CR-03): the board, the dashboard, the assistant and Telegram all call this. */
export async function getPipelineSummary(ctx: Ctx): Promise<PipelineSummary> {
  const rows = await listLeads(ctx);
  const open = rows.filter((l) => !l.isDraft);
  return {
    perStage: OPEN_STAGES.map((stage) => {
      const inStage = open.filter((l) => l.stage === stage);
      return { stage, count: inStage.length, value: pipelineValue(inStage) };
    }),
    value: pipelineValue(rows),
    stagnant: rows.filter((l) => l.isStagnant).length,
    drafts: rows.filter((l) => l.isDraft).length,
  };
}

export type ConvertInput = { mode: 'create' } | { mode: 'link'; clientId: string };

/**
 * Turns a WON lead into a client with the standard onboarding checklist (BR-M04-04, -05, -09). This is the executor: the web
 * asks for confirmation first, and an AI request reaches it only as an approved `act` (CR-06/07), so nothing is created
 * before a person says yes. A lead converts once. Creating a client whose name already exists is refused with `duplicate`;
 * the caller then offers `{ mode: 'link' }` to attach to the existing client instead.
 * The subscription is a checklist item rather than a record: its package and price are a billing decision for a person.
 */
export async function convertLeadToClient(ctx: Ctx, id: string, input: ConvertInput, opts: { locale?: 'id' | 'en' } = {}) {
  assertCan(ctx, 'lead.convert');
  return db.transaction(async (tx) => {
    const lead = await loadLead(tx, ctx.orgId, id);
    if (lead.convertedClientId) throw new DomainError('invalid_state', 'this lead already became a client');
    if (lead.stage !== 'won') throw new DomainError('invalid_state', 'only a won lead can become a client');

    let clientId: string;
    if (input.mode === 'link') {
      const [existing] = await tx.select({ id: clients.id, archivedAt: clients.archivedAt }).from(clients).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, input.clientId)));
      if (!existing) throw new DomainError('not_found', 'client');
      if (existing.archivedAt) throw new DomainError('invalid_state', 'archived client');
      clientId = existing.id;
    } else {
      try {
        // A savepoint, so a duplicate name does not abort the whole transaction before we can report it.
        [{ id: clientId }] = await tx.transaction((sp) =>
          sp
            .insert(clients)
            .values({ orgId: ctx.orgId, name: tidyName(lead.name), nameKey: nameKey(lead.name), contactName: lead.contactName, email: lead.email, phone: lead.phone, notes: lead.needsSummary })
            .returning({ id: clients.id }),
        );
      } catch (err) {
        if (isUniqueViolation(err, 'uq_clients_name_key')) throw new DomainError('duplicate', 'a client with this name already exists');
        throw err;
      }
      await recordAudit(tx, who(ctx), { action: 'client.created', entityType: 'client', entityId: clientId, summary: { name: lead.name, fromLead: id } });
    }

    const org = await orgSettings(tx, ctx.orgId);
    const today = todayIn(org.timezone, ctx.clock.now());
    const titles = ONBOARDING_CHECKLIST[opts.locale ?? 'id'];
    await tx.insert(tasks).values(
      titles.map((title, i) => ({ orgId: ctx.orgId, title, clientId, leadId: id, dueDate: onboardingDueDate(today, i), createdBy: ctx.userId, source: 'lead_conversion' })),
    );
    await tx.update(leads).set({ convertedClientId: clientId }).where(and(eq(leads.orgId, ctx.orgId), eq(leads.id, id)));
    await recordAudit(tx, who(ctx), { action: 'lead.converted', entityType: 'lead', entityId: id, summary: { clientId, linked: input.mode === 'link', tasks: titles.length } });
    return { clientId, tasksCreated: titles.length };
  });
}

/** Whether an open lead is worth a stagnant finding right now, for the Action Center rule (BR-M08). */
export async function listStagnantLeads(orgId: string, now: Date): Promise<Array<{ id: string; stageChangedAt: Date; stage: Stage }>> {
  const org = await orgSettings(db, orgId);
  const rows = await db
    .select({ id: leads.id, stage: leads.stage, stageChangedAt: leads.stageChangedAt, isDraft: leads.isDraft, archivedAt: leads.archivedAt })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), sql`${leads.stage} in ('new','exploring','proposal','negotiation')`, eq(leads.isDraft, false), isNull(leads.archivedAt)));
  return rows.filter((l) => isStagnant(l, org.stagnantDays, now)).map(({ id, stage, stageChangedAt }) => ({ id, stage, stageChangedAt }));
}

