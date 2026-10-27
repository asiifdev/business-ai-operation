import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireEnv } from '../lib/env';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

// One connection pool per server process (survives dev-server module reloads).
const sql = globalForDb.__sql ?? postgres(requireEnv('DATABASE_URL'), { max: 10 });
if (import.meta.env?.DEV) globalForDb.__sql = sql;

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { sql as pg };
