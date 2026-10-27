import { sql } from 'drizzle-orm';
import {
  check, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, unique, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { bigAmount, idColumn, tstz } from './_shared';
import { organizations, users } from './auth';

export const aiFeature = pgEnum('ai_feature', ['agent', 'minutes', 'transcribe', 'image']);
export const aiRunStatus = pgEnum('ai_run_status', ['ok', 'error', 'blocked_budget', 'rejected_tool']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'done', 'failed']);

/** ERD 3.8. One row per model call (BR-M15-05). Summaries only, never full document text (BR-M15-06). */
export const aiRuns = pgTable(
  'ai_runs',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    feature: aiFeature('feature').notNull(),
    onBehalfOf: text('on_behalf_of'),
    model: text('model').notNull(),
    status: aiRunStatus('status').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    audioMs: integer('audio_ms'),
    images: integer('images'),
    /** Cost in micro-USD (1 USD = 1,000,000) so no float is ever stored. */
    costMicroUsd: bigAmount('cost_micro_usd').notNull().default(0),
    tools: jsonb('tools').notNull().default(sql`'[]'::jsonb`),
    inputSummary: text('input_summary'),
    outputSummary: text('output_summary'),
    error: text('error'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    startedAt: tstz('started_at').defaultNow().notNull(),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    unique('uq_ai_runs_org_id').on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.onBehalfOf], foreignColumns: [users.orgId, users.id], name: 'fk_ai_runs_user' }),
    index('idx_ai_runs_budget').on(t.orgId, t.feature, t.startedAt),
    check('ai_runs_cost_ck', sql`${t.costMicroUsd} >= 0 and ${t.inputTokens} >= 0 and ${t.outputTokens} >= 0`),
  ],
);

/** Daily spending cap per feature, set by the Owner (CR-11, D-025). */
export const aiBudgets = pgTable(
  'ai_budgets',
  {
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    feature: aiFeature('feature').notNull(),
    dailyLimitMicroUsd: bigAmount('daily_limit_micro_usd').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.feature] }),
    check('ai_budgets_limit_ck', sql`${t.dailyLimitMicroUsd} >= 0`),
  ],
);

/** Idempotency ledger: the same (org, rule, key) can only ever succeed once (BR-M15-04, CR-10). */
export const automationRuns = pgTable(
  'automation_runs',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    rule: text('rule').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    ranAt: tstz('ran_at').defaultNow().notNull(),
    result: jsonb('result'),
  },
  (t) => [uniqueIndex('uq_automation_runs_key').on(t.orgId, t.rule, t.dedupeKey)],
);

/**
 * Append-only audit trail (BR-M15-01). A database trigger (migration guard_append_only) rejects UPDATE and DELETE.
 * Written in the same transaction as the change it describes (BR-M15-03).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    /** user:<id> | ai:<run_id> | system:<rule> (BR-M15-02) */
    actor: text('actor').notNull(),
    actorUserId: text('actor_user_id'),
    aiRunId: text('ai_run_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
    createdAt: tstz('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_audit_log_entity').on(t.orgId, t.entityType, t.entityId, t.createdAt),
    index('idx_audit_log_time').on(t.orgId, t.createdAt),
  ],
);

/** Postgres-backed job queue (D-008). Workers claim rows with FOR UPDATE SKIP LOCKED. */
export const jobs = pgTable(
  'jobs',
  {
    id: idColumn(),
    orgId: text('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    status: jobStatus('status').notNull().default('queued'),
    attempts: smallint('attempts').notNull().default(0),
    maxAttempts: smallint('max_attempts').notNull().default(3),
    runAfter: tstz('run_after').defaultNow().notNull(),
    lockedAt: tstz('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    result: jsonb('result'),
    createdAt: tstz('created_at').defaultNow().notNull(),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    index('idx_jobs_queue').on(t.runAfter).where(sql`${t.status} = 'queued'`),
    check('jobs_attempts_ck', sql`${t.attempts} >= 0 and ${t.maxAttempts} > 0`),
  ],
);

