import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, foreignKey, index, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, tstz, updatedAtColumn } from './_shared';
import { organizations, users } from './auth';
import { meetings } from './meetings';
import { clients, deployments, products } from './portfolio';

export const leadStage = pgEnum('lead_stage', ['new', 'exploring', 'proposal', 'negotiation', 'won', 'lost']);
export const taskKind = pgEnum('task_kind', ['task', 'bug', 'feature', 'maintenance']);
export const taskStatus = pgEnum('task_status', ['open', 'in_progress', 'done']);
export const taskPriority = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);

/**
 * ERD 3.4. A prospect on its way to becoming a client (BRD-M04). `isDraft` marks a lead an AI proposed: it stays out of the
 * pipeline value until a person accepts it (BR-M04-06). "Stagnant" is derived from `stageChangedAt`, never stored.
 * `meeting_id` is the recording a draft came from (M09).
 */
export const leads = pgTable(
  'leads',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    source: text('source'),
    needsSummary: text('needs_summary'),
    estimatedValue: bigint('estimated_value', { mode: 'number' }),
    stage: leadStage('stage').notNull().default('new'),
    stageChangedAt: tstz('stage_changed_at').defaultNow().notNull(),
    lostReason: text('lost_reason'),
    assignedTo: text('assigned_to'),
    convertedClientId: text('converted_client_id'),
    meetingId: text('meeting_id'),
    isDraft: boolean('is_draft').notNull().default(false),
    archivedAt: tstz('archived_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_leads_org_id').on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.assignedTo], foreignColumns: [users.orgId, users.id], name: 'fk_leads_assignee' }),
    foreignKey({ columns: [t.orgId, t.convertedClientId], foreignColumns: [clients.orgId, clients.id], name: 'fk_leads_client' }),
    foreignKey({ columns: [t.orgId, t.meetingId], foreignColumns: [meetings.orgId, meetings.id], name: 'fk_leads_meeting' }),
    check('leads_value_ck', sql`${t.estimatedValue} is null or ${t.estimatedValue} >= 0`),
    check('leads_lost_reason_ck', sql`${t.stage} <> 'lost' or ${t.lostReason} is not null`),
    index('idx_leads_stage').on(t.orgId, t.stage),
    index('idx_leads_stage_changed').on(t.orgId, t.stageChangedAt),
  ],
);

/**
 * ERD 3.4. Work to do for a client, product, deployment or lead (BRD-M05). "Late" is derived from `dueDate` and `status`.
 * `meeting_id` is the recording an action item came from (M09).
 */
export const tasks = pgTable(
  'tasks',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    kind: taskKind('kind').notNull().default('task'),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatus('status').notNull().default('open'),
    priority: taskPriority('priority').notNull().default('medium'),
    dueDate: date('due_date', { mode: 'string' }),
    assigneeId: text('assignee_id'),
    clientId: text('client_id'),
    productId: text('product_id'),
    deploymentId: text('deployment_id'),
    leadId: text('lead_id'),
    isDraft: boolean('is_draft').notNull().default(false),
    /** Where an AI-made task came from (`meeting`, `telegram_photo`) and the exact words it was based on. */
    source: text('source'),
    sourceQuote: text('source_quote'),
    meetingId: text('meeting_id'),
    duplicateOfTaskId: text('duplicate_of_task_id'),
    completedAt: tstz('completed_at'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_tasks_org_id').on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.assigneeId], foreignColumns: [users.orgId, users.id], name: 'fk_tasks_assignee' }),
    foreignKey({ columns: [t.orgId, t.clientId], foreignColumns: [clients.orgId, clients.id], name: 'fk_tasks_client' }),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id], name: 'fk_tasks_product' }),
    foreignKey({ columns: [t.orgId, t.deploymentId], foreignColumns: [deployments.orgId, deployments.id], name: 'fk_tasks_deployment' }),
    foreignKey({ columns: [t.orgId, t.leadId], foreignColumns: [leads.orgId, leads.id], name: 'fk_tasks_lead' }),
    foreignKey({ columns: [t.orgId, t.duplicateOfTaskId], foreignColumns: [t.orgId, t.id], name: 'fk_tasks_duplicate' }),
    foreignKey({ columns: [t.orgId, t.meetingId], foreignColumns: [meetings.orgId, meetings.id], name: 'fk_tasks_meeting' }),
    check('tasks_done_ck', sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
    index('idx_tasks_due').on(t.orgId, t.status, t.dueDate),
    index('idx_tasks_assignee').on(t.orgId, t.assigneeId, t.status),
  ],
);
