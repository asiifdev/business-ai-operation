import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { TEST_DB_NAME, TEST_URL } from './test-env';

/** Rebuilds the throwaway test database from the migrations once per `pnpm test` run. */
export default async function setup() {
  const adminUrl = new URL(TEST_URL);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  const client = postgres(TEST_URL, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  await client.end();
}
