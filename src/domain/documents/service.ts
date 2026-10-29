import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../../db/client';
import type { Tx } from '../../db/client';
import { newId } from '../../db/ids';
import { clients, documentItems, documents, leads, meetings, packages, products } from '../../db/schema';
import { recordAudit } from '../audit/service';
import { todayIn } from '../billing/dates';
import { loadOrgBilling, nextNumber } from '../billing/invoices';
import { calculateTotals } from '../billing/money';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { who } from '../portfolio/shared';
import { documentFilterSchema, documentPatchSchema, documentSchema, formatDocumentNumber, type DocumentKind, type LineInput } from './rules';

type Row = typeof documents.$inferSelect;

interface ResolvedLine {
  packageId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Turns the lines a person (or the assistant) asked for into priced lines. A package line takes its price from the
 * official package, never from the request (BR-M06-01); only a custom line carries a price typed by a person. The
 * assistant's tool offers package lines alone, so a model can never introduce a price.
 */
async function resolveLines(tx: Tx, orgId: string, lines: readonly LineInput[]): Promise<ResolvedLine[]> {
  const ids = [...new Set(lines.flatMap((l) => ('packageId' in l ? [l.packageId] : [])))];
  const found = ids.length
    ? await tx
        .select({ id: packages.id, name: packages.name, price: packages.monthlyPrice, archivedAt: packages.archivedAt, productName: products.name })
        .from(packages)
        .innerJoin(products, and(eq(products.orgId, packages.orgId), eq(products.id, packages.productId)))
        .where(and(eq(packages.orgId, orgId), inArray(packages.id, ids)))
    : [];
  const byId = new Map(found.map((p) => [p.id, p]));
  return lines.map((l) => {
    if (!('packageId' in l)) return { packageId: null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice };
    const pkg = byId.get(l.packageId);
    if (!pkg) throw new DomainError('not_found', 'package');
    if (pkg.archivedAt) throw new DomainError('invalid_state', 'archived package');
    return { packageId: pkg.id, description: l.description ?? `${pkg.productName} — ${pkg.name}`, quantity: l.quantity, unitPrice: pkg.price };
  });
}

/** Totals come from the billing calculator, the same one invoices use, so a figure has one source (BR-M06-06). */
async function writeItems(tx: Tx, orgId: string, documentId: string, lines: ResolvedLine[], taxRateBps: number) {
  const totals = calculateTotals(lines, taxRateBps);
  await tx.delete(documentItems).where(and(eq(documentItems.orgId, orgId), eq(documentItems.documentId, documentId)));
  await tx.insert(documentItems).values(totals.lines.map((l, i) => ({ orgId, documentId, position: i + 1, packageId: lines[i].packageId, ...l })));
  return { subtotal: totals.subtotal, taxAmount: totals.taxAmount, total: totals.total, taxRateBps };
}

async function assertParties(tx: Tx, orgId: string, clientId: string | null | undefined, leadId: string | null | undefined) {
  if (clientId) {
    const [c] = await tx.select({ archivedAt: clients.archivedAt }).from(clients).where(and(eq(clients.orgId, orgId), eq(clients.id, clientId)));
    if (!c) throw new DomainError('not_found', 'client');
  }
  if (leadId) {
    const [l] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, leadId)));
    if (!l) throw new DomainError('not_found', 'lead');
  }
}

/** A draft proposal or quotation. A draft made by the assistant is flagged until a person has saved it (BR-M06-05). */
export async function createDocument(ctx: Ctx, raw: z.input<typeof documentSchema>) {
  assertCan(ctx, 'document.write');
  const input = documentSchema.parse(raw);
  return db.transaction(async (tx) => {
    await assertParties(tx, ctx.orgId, input.clientId, input.leadId);
    const org = await loadOrgBilling(tx, ctx.orgId);
    const lines = await resolveLines(tx, ctx.orgId, input.items);
    const id = newId();
    await tx.insert(documents).values({
      id,
      orgId: ctx.orgId,
      kind: input.kind,
      seriesId: id,
      title: input.title,
      clientId: input.clientId ?? null,
      leadId: input.leadId ?? null,
      narrative: input.narrative ?? null,
      validUntil: input.validUntil ?? null,
      isAiDraft: ctx.actor.startsWith('ai:'),
      createdBy: ctx.actor,
    });
    const totals = await writeItems(tx, ctx.orgId, id, lines, org.taxRateBps);
    await tx.update(documents).set(totals).where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, id)));
    await recordAudit(tx, who(ctx), { action: 'document.created', entityType: 'document', entityId: id, summary: { kind: input.kind, total: totals.total, lines: lines.length } });
    return { id, total: totals.total };
  });
}

/** Convenience for the pipeline: a draft proposal for a lead, titled after it. */
export async function createFromLead(ctx: Ctx, leadId: string, input: { kind?: 'proposal' | 'quotation'; items: LineInput[]; narrative?: string | null; title?: string }) {
  assertCan(ctx, 'document.write');
  const [lead] = await db.select({ name: leads.name, convertedClientId: leads.convertedClientId }).from(leads).where(and(eq(leads.orgId, ctx.orgId), eq(leads.id, leadId)));
  if (!lead) throw new DomainError('not_found', 'lead');
  const kind = input.kind ?? 'proposal';
  return createDocument(ctx, { kind, title: input.title ?? `${kind === 'proposal' ? 'Proposal' : 'Quotation'} — ${lead.name}`, leadId, clientId: lead.convertedClientId, narrative: input.narrative, items: input.items });
}

async function lockDocument(tx: Tx, orgId: string, id: string): Promise<Row> {
  const [row] = await tx.select().from(documents).where(and(eq(documents.orgId, orgId), eq(documents.id, id))).for('update');
  if (!row) throw new DomainError('not_found', 'document');
  return row;
}

/** Only a draft can be edited (BR-M06-02). Saving counts as a human review, so the "AI-assisted" flag clears (BR-M06-05). */
export async function updateDraft(ctx: Ctx, id: string, raw: z.input<typeof documentPatchSchema>) {
  assertCan(ctx, 'document.write');
  const patch = documentPatchSchema.parse(raw);
  return db.transaction(async (tx) => {
    const before = await lockDocument(tx, ctx.orgId, id);
    if (before.status !== 'draft') throw new DomainError('invalid_state', 'only a draft can be edited');
    if (patch.items && before.kind === 'minutes') throw new DomainError('validation', 'minutes have no prices');
    const set: Partial<typeof documents.$inferInsert> = { isAiDraft: ctx.actor.startsWith('ai:') ? before.isAiDraft : false };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.narrative !== undefined) set.narrative = patch.narrative;
    if (patch.validUntil !== undefined) set.validUntil = patch.validUntil;
    if (patch.items) {
      const org = await loadOrgBilling(tx, ctx.orgId);
      Object.assign(set, await writeItems(tx, ctx.orgId, id, await resolveLines(tx, ctx.orgId, patch.items), org.taxRateBps));
    }
    await tx.update(documents).set(set).where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, id)));
    await recordAudit(tx, who(ctx), { action: 'document.updated', entityType: 'document', entityId: id, summary: { fields: Object.keys(patch) } });
    return { id };
  });
}

/**
 * Draft to Final: gives the number and from here on the document never changes (BR-M06-02, -03, -04; the database
 * refuses any later edit). A person with `document.finalize` does it, or the approval a person gave to the assistant's
 * proposal.
 */
export async function finalizeDocument(ctx: Ctx, id: string) {
  assertCan(ctx, 'document.finalize');
  return db.transaction(async (tx) => {
    const before = await lockDocument(tx, ctx.orgId, id);
    if (before.status !== 'draft') throw new DomainError('invalid_state', 'only a draft can be finalized');
    if (before.kind !== 'minutes') {
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(documentItems).where(and(eq(documentItems.orgId, ctx.orgId), eq(documentItems.documentId, id)));
      if (count === 0 || before.total <= 0) throw new DomainError('validation', 'a document with no amount cannot be finalized');
    }
    // A revision keeps the number of its series, so "PRO-2026-0003" stays recognisable across versions.
    const [first] = before.version > 1 ? await tx.select({ number: documents.number }).from(documents).where(and(eq(documents.orgId, ctx.orgId), eq(documents.seriesId, before.seriesId), eq(documents.version, 1))) : [];
    const org = await loadOrgBilling(tx, ctx.orgId);
    const year = Number(todayIn(org.timezone, ctx.clock.now()).slice(0, 4));
    const base = first?.number ?? formatDocumentNumber(before.kind, year, await nextNumber(tx, ctx.orgId, `document:${before.kind}:${year}`));
    const number = before.version > 1 ? `${base}-v${before.version}` : base;
    await tx.update(documents).set({ status: 'final', number, finalizedAt: ctx.clock.now(), finalizedBy: ctx.userId, isAiDraft: false }).where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, id)));
    await recordAudit(tx, who(ctx), { action: 'document.finalized', entityType: 'document', entityId: id, summary: { kind: before.kind, number, total: before.total, version: before.version } });
    return { id, number };
  });
}

/** A final document is never edited: a revision is a new draft in the same series with the next version (BR-M06-02). */
export async function reviseDocument(ctx: Ctx, id: string) {
  assertCan(ctx, 'document.write');
  return db.transaction(async (tx) => {
    const source = await lockDocument(tx, ctx.orgId, id);
    if (source.status !== 'final') throw new DomainError('invalid_state', 'only a final document can be revised');
    const [latest] = await tx.select({ id: documents.id, version: documents.version, status: documents.status }).from(documents).where(and(eq(documents.orgId, ctx.orgId), eq(documents.seriesId, source.seriesId))).orderBy(desc(documents.version)).limit(1);
    if (latest.id !== source.id) throw new DomainError('invalid_state', latest.status === 'draft' ? 'a revision is already in progress' : 'only the latest version can be revised');
    const items = await tx.select().from(documentItems).where(and(eq(documentItems.orgId, ctx.orgId), eq(documentItems.documentId, id))).orderBy(asc(documentItems.position));
    const newDocId = newId();
    await tx.insert(documents).values({
      id: newDocId,
      orgId: ctx.orgId,
      kind: source.kind,
      seriesId: source.seriesId,
      version: source.version + 1,
      title: source.title,
      clientId: source.clientId,
      leadId: source.leadId,
      meetingId: source.meetingId,
      narrative: source.narrative,
      subtotal: source.subtotal,
      taxRateBps: source.taxRateBps,
      taxAmount: source.taxAmount,
      total: source.total,
      validUntil: source.validUntil,
      createdBy: ctx.actor,
    });
    if (items.length) await tx.insert(documentItems).values(items.map((i) => ({ orgId: ctx.orgId, documentId: newDocId, position: i.position, packageId: i.packageId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })));
    await recordAudit(tx, who(ctx), { action: 'document.revised', entityType: 'document', entityId: newDocId, summary: { from: id, version: source.version + 1 } });
    return { id: newDocId, version: source.version + 1 };
  });
}

/** A draft that was never finalized can be thrown away. Minutes belong to a meeting, so they are kept and edited instead. */
export async function deleteDraft(ctx: Ctx, id: string) {
  assertCan(ctx, 'document.write');
  await db.transaction(async (tx) => {
    const before = await lockDocument(tx, ctx.orgId, id);
    if (before.status !== 'draft') throw new DomainError('invalid_state', 'only a draft can be deleted');
    if (before.kind === 'minutes') throw new DomainError('invalid_state', 'minutes are kept with their meeting');
    await tx.delete(documentItems).where(and(eq(documentItems.orgId, ctx.orgId), eq(documentItems.documentId, id)));
    await tx.delete(documents).where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, id)));
    await recordAudit(tx, who(ctx), { action: 'document.deleted', entityType: 'document', entityId: id, summary: { kind: before.kind, version: before.version } });
  });
}

export interface DocumentRow {
  id: string;
  kind: DocumentKind;
  status: 'draft' | 'final';
  number: string | null;
  version: number;
  seriesId: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  leadId: string | null;
  leadName: string | null;
  total: number;
  validUntil: string | null;
  isAiDraft: boolean;
  createdAt: Date;
  finalizedAt: Date | null;
}

const LIST_LIMIT = 300;

const selectRow = () =>
  db
    .select({ doc: documents, clientName: clients.name, leadName: leads.name })
    .from(documents)
    .leftJoin(clients, and(eq(clients.orgId, documents.orgId), eq(clients.id, documents.clientId)))
    .leftJoin(leads, and(eq(leads.orgId, documents.orgId), eq(leads.id, documents.leadId)));

const toRow = (r: { doc: Row; clientName: string | null; leadName: string | null }): DocumentRow => ({
  id: r.doc.id,
  kind: r.doc.kind,
  status: r.doc.status,
  number: r.doc.number,
  version: r.doc.version,
  seriesId: r.doc.seriesId,
  title: r.doc.title,
  clientId: r.doc.clientId,
  clientName: r.clientName,
  leadId: r.doc.leadId,
  leadName: r.leadName,
  total: r.doc.total,
  validUntil: r.doc.validUntil,
  isAiDraft: r.doc.isAiDraft,
  createdAt: r.doc.createdAt,
  finalizedAt: r.doc.finalizedAt,
});

/** Latest version of each series by default, newest first. */
export async function listDocuments(ctx: Ctx, raw: z.input<typeof documentFilterSchema> = {}): Promise<DocumentRow[]> {
  assertCan(ctx, 'document.read');
  const f = documentFilterSchema.parse(raw);
  const rows = await selectRow()
    .where(and(eq(documents.orgId, ctx.orgId), f.kind ? eq(documents.kind, f.kind) : undefined, f.status ? eq(documents.status, f.status) : undefined, f.clientId ? eq(documents.clientId, f.clientId) : undefined, f.leadId ? eq(documents.leadId, f.leadId) : undefined))
    .orderBy(desc(documents.createdAt))
    .limit(LIST_LIMIT);
  const out = rows.map(toRow);
  if (f.allVersions) return out;
  const latest = new Map<string, number>();
  for (const r of out) latest.set(r.seriesId, Math.max(latest.get(r.seriesId) ?? 0, r.version));
  return out.filter((r) => latest.get(r.seriesId) === r.version);
}

export interface DocumentDetail extends DocumentRow {
  narrative: string | null;
  subtotal: number;
  taxAmount: number;
  taxRateBps: number;
  meetingId: string | null;
  meetingTitle: string | null;
  items: Array<{ id: string; position: number; packageId: string | null; description: string; quantity: number; unitPrice: number; lineTotal: number }>;
  /** Every version of this series, oldest first. */
  versions: Array<{ id: string; version: number; status: 'draft' | 'final'; number: string | null }>;
}

export async function getDocument(ctx: Ctx, id: string): Promise<DocumentDetail> {
  assertCan(ctx, 'document.read');
  const [row] = await selectRow().where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, id)));
  if (!row) throw new DomainError('not_found', 'document');
  const [items, versions, [meeting]] = await Promise.all([
    db.select().from(documentItems).where(and(eq(documentItems.orgId, ctx.orgId), eq(documentItems.documentId, id))).orderBy(asc(documentItems.position)),
    db.select({ id: documents.id, version: documents.version, status: documents.status, number: documents.number }).from(documents).where(and(eq(documents.orgId, ctx.orgId), eq(documents.seriesId, row.doc.seriesId))).orderBy(asc(documents.version)),
    row.doc.meetingId ? db.select({ title: meetings.title }).from(meetings).where(and(eq(meetings.orgId, ctx.orgId), eq(meetings.id, row.doc.meetingId))) : Promise.resolve([]),
  ]);
  return {
    ...toRow(row),
    narrative: row.doc.narrative,
    subtotal: row.doc.subtotal,
    taxAmount: row.doc.taxAmount,
    taxRateBps: row.doc.taxRateBps,
    meetingId: row.doc.meetingId,
    meetingTitle: meeting?.title ?? null,
    items: items.map((i) => ({ id: i.id, position: i.position, packageId: i.packageId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    versions,
  };
}

export interface DocumentOptions {
  clients: Array<{ id: string; name: string }>;
  leads: Array<{ id: string; name: string }>;
  /** Active packages with their official monthly price, the only source of a package line's price (BR-M06-01). */
  packages: Array<{ id: string; label: string; price: number }>;
  /** For the form's preview only; the stored totals are computed on the server. */
  taxRateBps: number;
}

/** What the new-document form offers to pick from. */
export async function getDocumentOptions(ctx: Ctx): Promise<DocumentOptions> {
  assertCan(ctx, 'document.write');
  const [org, clientRows, leadRows, packageRows] = await Promise.all([
    loadOrgBilling(db, ctx.orgId),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.orgId, ctx.orgId), isNull(clients.archivedAt))).orderBy(asc(clients.name)),
    db.select({ id: leads.id, name: leads.name }).from(leads).where(and(eq(leads.orgId, ctx.orgId), isNull(leads.archivedAt), eq(leads.isDraft, false), inArray(leads.stage, ['new', 'exploring', 'proposal', 'negotiation']))).orderBy(asc(leads.name)),
    db
      .select({ id: packages.id, name: packages.name, price: packages.monthlyPrice, productName: products.name })
      .from(packages)
      .innerJoin(products, and(eq(products.orgId, packages.orgId), eq(products.id, packages.productId)))
      .where(and(eq(packages.orgId, ctx.orgId), isNull(packages.archivedAt), isNull(products.archivedAt)))
      .orderBy(asc(products.name), asc(packages.name)),
  ]);
  return { clients: clientRows, leads: leadRows, packages: packageRows.map((p) => ({ id: p.id, label: `${p.productName} — ${p.name}`, price: p.price })), taxRateBps: org.taxRateBps };
}
