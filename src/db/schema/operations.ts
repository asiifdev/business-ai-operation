import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgEnum, pgTable, smallint, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, lower, tstz, updatedAtColumn } from './_shared';
import { approvals } from './ai';
import { organizations } from './auth';
import { clients, deployments, products } from './portfolio';

export const connectionKind = pgEnum('connection_kind', ['github', 'ssh', 'aapanel']);
export const connectionTest = pgEnum('connection_test', ['untested', 'ok', 'failed']);
export const setupMode = pgEnum('setup_mode', ['branch_per_client', 'shared_branch']);
export const runKind = pgEnum('run_kind', ['setup', 'update']);
export const runStatus = pgEnum('run_status', ['planned', 'awaiting_approval', 'running', 'paused', 'done', 'failed', 'cancelled']);
export const stepStatus = pgEnum('step_status', ['pending', 'running', 'done', 'failed', 'skipped']);

/**
 * ERD 3.9, BRD-M17. A connection an organization owns: its GitHub installation, an SSH login, or an aaPanel API. `config`
 * holds only what is not secret; `secretCiphertext` is the encrypted secret (AES-256-GCM, key version noted for rotation)
 * and is never returned by any API nor shown to a model (BR-M17-02, -03).
 */
export const connections = pgTable(
  'connections',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    kind: connectionKind('kind').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    secretCiphertext: text('secret_ciphertext'),
    secretKeyVersion: smallint('secret_key_version'),
    secretHint: text('secret_hint'),
    hostKeyFingerprint: text('host_key_fingerprint'),
    testStatus: connectionTest('test_status').notNull().default('untested'),
    testedAt: tstz('tested_at'),
    testMessage: text('test_message'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [unique('uq_connections_org_id').on(t.orgId, t.id), uniqueIndex('uq_connections_name').on(t.orgId, lower(t.name))],
);

/** ERD 3.9. The setup profile of one product: where its code lives and how a client is brought online. */
export const productSetups = pgTable(
  'product_setups',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    productId: text('product_id').notNull(),
    githubConnectionId: text('github_connection_id'),
    repo: text('repo'),
    defaultBranch: text('default_branch'),
    mode: setupMode('mode').notNull().default('branch_per_client'),
    folderPattern: text('folder_pattern'),
    serverConnectionId: text('server_connection_id'),
    steps: jsonb('steps').$type<Array<{ key: string; options?: Record<string, unknown> }>>().notNull().default([]),
    nginxTemplate: text('nginx_template'),
    envTemplate: text('env_template'),
    rulesNotes: text('rules_notes'),
    isAiDraft: boolean('is_ai_draft').notNull().default(false),
    updatedBy: text('updated_by'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_product_setups_product').on(t.productId),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id], name: 'fk_product_setups_product' }),
    foreignKey({ columns: [t.orgId, t.githubConnectionId], foreignColumns: [connections.orgId, connections.id], name: 'fk_product_setups_github' }),
    foreignKey({ columns: [t.orgId, t.serverConnectionId], foreignColumns: [connections.orgId, connections.id], name: 'fk_product_setups_server' }),
  ],
);

/** ERD 3.9. One run of a playbook on one server. At most one run is `running` per server (BR-M17-15). */
export const playbookRuns = pgTable(
  'playbook_runs',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    productId: text('product_id').notNull(),
    clientId: text('client_id'),
    deploymentId: text('deployment_id'),
    serverConnectionId: text('server_connection_id').notNull(),
    kind: runKind('kind').notNull(),
    status: runStatus('status').notNull().default('planned'),
    /** Validated parameters. Never a secret. */
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    approvalId: text('approval_id'),
    summary: text('summary'),
    error: text('error'),
    createdBy: text('created_by').notNull(),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_playbook_runs_org_id').on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id], name: 'fk_playbook_runs_product' }),
    foreignKey({ columns: [t.orgId, t.clientId], foreignColumns: [clients.orgId, clients.id], name: 'fk_playbook_runs_client' }),
    foreignKey({ columns: [t.orgId, t.deploymentId], foreignColumns: [deployments.orgId, deployments.id], name: 'fk_playbook_runs_deployment' }),
    foreignKey({ columns: [t.orgId, t.serverConnectionId], foreignColumns: [connections.orgId, connections.id], name: 'fk_playbook_runs_server' }),
    foreignKey({ columns: [t.orgId, t.approvalId], foreignColumns: [approvals.orgId, approvals.id], name: 'fk_playbook_runs_approval' }),
    uniqueIndex('uq_playbook_runs_running').on(t.serverConnectionId).where(sql`${t.status} = 'running'`),
    index('idx_playbook_runs_org').on(t.orgId, t.createdAt),
  ],
);

/** ERD 3.9. A step of a run: the key names a step of the catalogue in code; output is cut and scrubbed of secrets. */
export const playbookSteps = pgTable(
  'playbook_steps',
  {
    id: idColumn(),
    orgId: text('org_id').notNull(),
    runId: text('run_id').notNull(),
    position: integer('position').notNull(),
    stepKey: text('step_key').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    status: stepStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    output: text('output'),
    error: text('error'),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    unique('uq_playbook_steps_position').on(t.runId, t.position),
    foreignKey({ columns: [t.orgId, t.runId], foreignColumns: [playbookRuns.orgId, playbookRuns.id], name: 'fk_playbook_steps_run' }),
    check('playbook_steps_position_ck', sql`${t.position} >= 1`),
  ],
);
