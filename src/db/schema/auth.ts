import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, foreignKey, index, integer, pgEnum, pgTable, smallint, text, unique, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { bigAmount, createdAtColumn, idColumn, lower, tstz, updatedAtColumn } from './_shared';

export const userRole = pgEnum('user_role', ['owner', 'admin', 'staff']);

/** ERD 3.1. Tenant root: every business table carries org_id pointing here. */
export const organizations = pgTable(
  'organizations',
  {
    id: idColumn(),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('IDR'),
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
    locale: text('locale', { enum: ['id', 'en'] }).notNull().default('id'),
    graceDays: smallint('grace_days').notNull().default(7),
    draftOffsetDays: smallint('draft_offset_days').notNull().default(7),
    schedulerHour: smallint('scheduler_hour').notNull().default(8),
    briefingHour: smallint('briefing_hour').notNull().default(8),
    /** M17 (D-055): how often uptime and installed code are checked, and how long one run step may take. */
    uptimeIntervalMin: smallint('uptime_interval_min').notNull().default(5),
    stepTimeoutSec: integer('step_timeout_sec').notNull().default(300),
    codeCheckIntervalMin: smallint('code_check_interval_min').notNull().default(30),
    invoiceNumberFormat: text('invoice_number_format').notNull().default('INV-{YYYY}-{NNNN}'),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    stagnantDays: smallint('stagnant_days').notNull().default(14),
    approvalTtlHours: smallint('approval_ttl_hours').notNull().default(24),
    /** D-082: how much the assistant may do on its own for the person who asked. Risky actions always wait for a click. */
    aiAutonomy: text('ai_autonomy', { enum: ['careful', 'balanced', 'autonomous'] }).notNull().default('balanced'),
    bankName: text('bank_name'),
    bankAccountName: text('bank_account_name'),
    bankAccountNumber: text('bank_account_number'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check('organizations_hours_ck', sql`${t.schedulerHour} between 0 and 23 and ${t.briefingHour} between 0 and 23`),
    check('organizations_days_ck', sql`${t.graceDays} >= 0 and ${t.draftOffsetDays} >= 0 and ${t.stagnantDays} >= 0 and ${t.approvalTtlHours} > 0`),
    check('organizations_tax_ck', sql`${t.taxRateBps} between 0 and 10000`),
  ],
);

/**
 * Better Auth "user" table mapped to `users` (D-009). One user belongs to exactly one organization (BR-M01-02).
 * role/orgId/isActive are never client input (see src/auth/auth.ts additionalFields).
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: userRole('role').notNull().default('staff'),
    locale: text('locale', { enum: ['id', 'en'] }).notNull().default('id'),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('uq_users_email_lower').on(lower(t.email)),
    unique('uq_users_org_id').on(t.orgId, t.id),
    index('idx_users_org').on(t.orgId),
  ],
);

/** Better Auth "session" (generated shape, plural table name). */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: tstz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('idx_sessions_user').on(t.userId)],
);

/** Better Auth "account": holds the password HASH in `password` (BR-M01-05). Never logged. */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tstz('access_token_expires_at'),
    refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index('idx_accounts_user').on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index('idx_verifications_identifier').on(t.identifier)],
);

/** ERD 3.1. A Telegram chat linked to one user. Active link = unlinked_at IS NULL (BR-M11, BR-M01-08). */
export const telegramLinks = pgTable(
  'telegram_links',
  {
    id: idColumn(),
    orgId: text('org_id').notNull(),
    userId: text('user_id').notNull(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    username: text('username'),
    linkedAt: tstz('linked_at').defaultNow().notNull(),
    unlinkedAt: tstz('unlinked_at'),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.userId], foreignColumns: [users.orgId, users.id], name: 'fk_telegram_links_user' }),
    uniqueIndex('uq_telegram_links_user_active').on(t.userId).where(sql`${t.unlinkedAt} is null`),
    uniqueIndex('uq_telegram_links_chat_active').on(t.chatId).where(sql`${t.unlinkedAt} is null`),
  ],
);

/** One-time pairing codes; only the hash is stored (10 minute lifetime, PRD section 6). */
export const telegramPairingCodes = pgTable(
  'telegram_pairing_codes',
  {
    id: idColumn(),
    orgId: text('org_id').notNull(),
    userId: text('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.userId], foreignColumns: [users.orgId, users.id], name: 'fk_telegram_pairing_user' }),
    index('idx_telegram_pairing_hash').on(t.codeHash),
  ],
);

/** Remembers processed webhook update ids so Telegram retries are ignored (idempotency, CR-10). */
export const telegramUpdates = pgTable('telegram_updates', {
  updateId: bigAmount('update_id').primaryKey(),
  receivedAt: tstz('received_at').defaultNow().notNull(),
});
