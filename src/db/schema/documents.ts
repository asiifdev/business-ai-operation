import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, foreignKey, index, integer, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, tstz, updatedAtColumn } from './_shared';
import { organizations, users } from './auth';
import { meetings } from './meetings';
import { leads } from './pipeline';
import { clients, packages } from './portfolio';

export const documentKind = pgEnum('document_kind', ['proposal', 'quotation', 'minutes']);
export const documentStatus = pgEnum('document_status', ['draft', 'final']);

/**
 * ERD 3.5, BRD-M06. Proposals, quotations and meeting minutes. A final document never changes (a database trigger refuses
 * it); a revision is a new row in the same `series_id` with the next `version`. Amounts are integer Rupiah computed by
 * the billing calculator, never by a model (BR-M06). Minutes carry no amounts (all zero).
 */
export const documents = pgTable(
  'documents',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    kind: documentKind('kind').notNull(),
    /** Id of the first version; the same for every revision. */
    seriesId: text('series_id').notNull(),
    version: integer('version').notNull().default(1),
    status: documentStatus('status').notNull().default('draft'),
    /** Given when the document becomes final (D-027). */
    number: text('number'),
    title: text('title').notNull(),
    clientId: text('client_id'),
    leadId: text('lead_id'),
    meetingId: text('meeting_id'),
    narrative: text('narrative'),
    subtotal: bigint('subtotal', { mode: 'number' }).notNull().default(0),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    total: bigint('total', { mode: 'number' }).notNull().default(0),
    validUntil: date('valid_until', { mode: 'string' }),
    isAiDraft: boolean('is_ai_draft').notNull().default(false),
    finalizedAt: tstz('finalized_at'),
    finalizedBy: text('finalized_by'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_documents_org_id').on(t.orgId, t.id),
    unique('uq_documents_series_version').on(t.seriesId, t.version),
    unique('uq_documents_number').on(t.orgId, t.number),
    foreignKey({ columns: [t.orgId, t.clientId], foreignColumns: [clients.orgId, clients.id], name: 'fk_documents_client' }),
    foreignKey({ columns: [t.orgId, t.leadId], foreignColumns: [leads.orgId, leads.id], name: 'fk_documents_lead' }),
    foreignKey({ columns: [t.orgId, t.meetingId], foreignColumns: [meetings.orgId, meetings.id], name: 'fk_documents_meeting' }),
    foreignKey({ columns: [t.orgId, t.finalizedBy], foreignColumns: [users.orgId, users.id], name: 'fk_documents_finalized_by' }),
    check('documents_amounts_ck', sql`${t.subtotal} >= 0 and ${t.taxAmount} >= 0 and ${t.total} >= 0 and ${t.taxRateBps} >= 0`),
    check('documents_version_ck', sql`${t.version} >= 1`),
    check('documents_final_ck', sql`(${t.status} = 'final') = (${t.finalizedAt} is not null)`),
    index('idx_documents_kind').on(t.orgId, t.kind, t.createdAt),
  ],
);

/** ERD 3.5. A priced line. `unit_price` is a COPY of the official package price, never a figure from a model (BR-M06). */
export const documentItems = pgTable(
  'document_items',
  {
    id: idColumn(),
    orgId: text('org_id').notNull(),
    documentId: text('document_id').notNull(),
    position: integer('position').notNull(),
    packageId: text('package_id'),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    lineTotal: bigint('line_total', { mode: 'number' }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.documentId], foreignColumns: [documents.orgId, documents.id], name: 'fk_document_items_document' }),
    foreignKey({ columns: [t.orgId, t.packageId], foreignColumns: [packages.orgId, packages.id], name: 'fk_document_items_package' }),
    check('document_items_quantity_ck', sql`${t.quantity} > 0`),
    check('document_items_amounts_ck', sql`${t.unitPrice} >= 0 and ${t.lineTotal} >= 0`),
  ],
);
