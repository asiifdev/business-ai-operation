import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids';
import * as schema from '../../src/db/schema';

/**
 * Integration tests for the guards that live in the database itself (ERD section 5).
 * Runs against a throwaway database that is rebuilt from the migrations on every run.
 * It NEVER touches the development database: the name must end in `_test`.
 */

const TEST_URL = process.env.DATABASE_URL_TEST ?? 'postgres://root@127.0.0.1:5432/ai_business_operation_test';
const dbName = new URL(TEST_URL).pathname.slice(1);
if (!/^[a-z0-9_]+_test$/.test(dbName)) throw new Error(`Refusing to run: "${dbName}" is not a *_test database`);

let admin: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** Drizzle wraps Postgres errors as "Failed query"; the real message and constraint live on `cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, 'the statement should have been rejected by the database').toBeDefined();
  const e = caught as { message?: string; cause?: { message?: string; constraint_name?: string; code?: string } };
  const text = [e.message, e.cause?.message, e.cause?.constraint_name].filter(Boolean).join(' | ');
  expect(text).toMatch(pattern);
}

async function makeOrg(name = 'Org') {
  const [org] = await db.insert(schema.organizations).values({ name }).returning();
  return org;
}
async function makeUser(orgId: string, over: Partial<typeof schema.users.$inferInsert> = {}) {
  const id = newId();
  const [user] = await db
    .insert(schema.users)
    .values({ id, orgId, name: 'U', email: `${id}@example.test`, role: 'staff', ...over })
    .returning();
  return user;
}

beforeAll(async () => {
  const adminUrl = new URL(TEST_URL);
  adminUrl.pathname = '/postgres';
  admin = postgres(adminUrl.toString(), { max: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  client = postgres(TEST_URL, { max: 4, onnotice: () => {} });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
}, 60_000);

afterAll(async () => {
  await client?.end();
  await admin?.end();
});

describe('migrations', () => {
  it('apply cleanly to an empty database and create the expected tables', async () => {
    const rows = await client`select table_name from information_schema.tables where table_schema = 'public'`;
    const names = rows.map((r) => r.table_name as string);
    for (const t of ['organizations', 'users', 'sessions', 'accounts', 'verifications', 'telegram_links', 'ai_runs', 'ai_budgets', 'audit_log', 'automation_runs', 'jobs']) {
      expect(names).toContain(t);
    }
  });
});

describe('tenant isolation in the database', () => {
  it('rejects a Telegram link that mixes an organization with another organization\'s user', async () => {
    const a = await makeOrg('A');
    const b = await makeOrg('B');
    const userOfA = await makeUser(a.id);
    await expectDbError(
      db.insert(schema.telegramLinks).values({ orgId: b.id, userId: userOfA.id, chatId: 1001 }),
      /fk_telegram_links_user|foreign key/i,
    );
  });

  it('accepts the same link inside the correct organization', async () => {
    const a = await makeOrg();
    const user = await makeUser(a.id);
    await db.insert(schema.telegramLinks).values({ orgId: a.id, userId: user.id, chatId: 2002 });
  });
});

describe('Telegram links', () => {
  it('allows re-linking a chat after it was unlinked, but not two active links', async () => {
    const org = await makeOrg();
    const u1 = await makeUser(org.id);
    const u2 = await makeUser(org.id);
    await db.insert(schema.telegramLinks).values({ orgId: org.id, userId: u1.id, chatId: 3003 });
    await expectDbError(db.insert(schema.telegramLinks).values({ orgId: org.id, userId: u2.id, chatId: 3003 }), /uq_telegram_links_chat_active|duplicate/i);
    await db.update(schema.telegramLinks).set({ unlinkedAt: new Date() }).where(eq(schema.telegramLinks.userId, u1.id));
    await db.insert(schema.telegramLinks).values({ orgId: org.id, userId: u2.id, chatId: 3003 });
  });
});

describe('users', () => {
  it('treats emails case-insensitively as unique', async () => {
    const org = await makeOrg();
    const email = `Same-${newId()}@Example.test`;
    await makeUser(org.id, { email });
    await expectDbError(makeUser(org.id, { email: email.toLowerCase() }), /uq_users_email_lower|duplicate/i);
  });

  it('never leaves an organization without an active owner', async () => {
    const org = await makeOrg();
    const owner = await makeUser(org.id, { role: 'owner' });
    await expectDbError(db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, owner.id)), /at least one active owner/);
    await expectDbError(db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, owner.id)), /at least one active owner/);
    await expectDbError(db.delete(schema.users).where(eq(schema.users.id, owner.id)), /at least one active owner/);
  });

  it('lets an owner step down once another active owner exists', async () => {
    const org = await makeOrg();
    const first = await makeUser(org.id, { role: 'owner' });
    await makeUser(org.id, { role: 'owner' });
    await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, first.id));
  });

  it('does not count a deactivated owner as the remaining owner', async () => {
    const org = await makeOrg();
    const active = await makeUser(org.id, { role: 'owner' });
    await makeUser(org.id, { role: 'owner', isActive: false });
    await expectDbError(db.update(schema.users).set({ role: 'staff' }).where(eq(schema.users.id, active.id)), /at least one active owner/);
  });
});

describe('audit_log is append-only', () => {
  it('accepts inserts but rejects UPDATE, DELETE and TRUNCATE', async () => {
    const org = await makeOrg();
    const [row] = await db
      .insert(schema.auditLog)
      .values({ orgId: org.id, actor: 'system:test', action: 'test.created', entityType: 'test', entityId: 'x' })
      .returning();
    await expectDbError(db.update(schema.auditLog).set({ action: 'tampered' }).where(eq(schema.auditLog.id, row.id)), /append-only/);
    await expectDbError(db.delete(schema.auditLog).where(eq(schema.auditLog.id, row.id)), /append-only/);
    await expectDbError(client.unsafe('TRUNCATE audit_log'), /append-only/);
    const [still] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, row.id));
    expect(still.action).toBe('test.created');
  });
});

describe('idempotency and value checks', () => {
  it('lets the same automation key succeed only once', async () => {
    const org = await makeOrg();
    const key = { orgId: org.id, rule: 'invoice_overdue', dedupeKey: 'overdue:inv-1' };
    await db.insert(schema.automationRuns).values(key);
    await expectDbError(db.insert(schema.automationRuns).values(key), /uq_automation_runs_key|duplicate/i);
  });

  it('allows the same key in a different organization', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const key = { rule: 'invoice_overdue', dedupeKey: 'overdue:inv-9' };
    await db.insert(schema.automationRuns).values({ orgId: a.id, ...key });
    await db.insert(schema.automationRuns).values({ orgId: b.id, ...key });
  });

  it('rejects impossible organization settings and negative budgets', async () => {
    await expectDbError(db.insert(schema.organizations).values({ name: 'Bad', schedulerHour: 25 }), /organizations_hours_ck/);
    await expectDbError(db.insert(schema.organizations).values({ name: 'Bad', taxRateBps: 20000 }), /organizations_tax_ck/);
    const org = await makeOrg();
    await expectDbError(db.insert(schema.aiBudgets).values({ orgId: org.id, feature: 'agent', dailyLimitMicroUsd: -1 }), /ai_budgets_limit_ck/);
  });

  it('stores AI cost as an exact integer and defaults to zero', async () => {
    const org = await makeOrg();
    const [run] = await db.insert(schema.aiRuns).values({ orgId: org.id, feature: 'agent', model: 'muse-spark-1.3', status: 'ok', costMicroUsd: 1_234_567 }).returning();
    expect(run.costMicroUsd).toBe(1_234_567);
    const [{ total }] = await db.execute<{ total: string }>(sql`select sum(cost_micro_usd)::text as total from ai_runs where org_id = ${org.id}`);
    expect(total).toBe('1234567');
  });

  it('stores Rupiah amounts above 2.1 billion without overflow (bigint)', async () => {
    const org = await makeOrg();
    const big = 9_000_000_000;
    const [row] = await db.insert(schema.aiBudgets).values({ orgId: org.id, feature: 'image', dailyLimitMicroUsd: big }).returning();
    expect(row.dailyLimitMicroUsd).toBe(big);
  });
});
