import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/** Reads one key from .env without loading the rest (so the dev DATABASE_URL never leaks into tests). */
function fromDotEnv(key: string): string | undefined {
  if (!existsSync('.env')) return undefined;
  const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim() || undefined;
}

/** The only database tests may touch. Comes from the environment or .env; there is no silent default. */
const url = process.env.DATABASE_URL_TEST ?? fromDotEnv('DATABASE_URL_TEST');
if (!url) throw new Error('DATABASE_URL_TEST is not set. Add it to .env (see .env.example); its database name must end in _test.');
export const TEST_URL: string = url;

export const TEST_DB_NAME = new URL(TEST_URL).pathname.slice(1);
if (!/^[a-z0-9_]+_test$/.test(TEST_DB_NAME)) throw new Error(`Refusing to run: "${TEST_DB_NAME}" is not a *_test database`);

/** The public address the site was built with (same source as astro.config.mjs), so SEO tests expect the same canonical URLs. */
export const TEST_APP_URL: string | undefined = process.env.APP_URL ?? fromDotEnv('APP_URL');

/** A fresh random secret for every test run: nothing static that looks like (or could be reused as) a real secret. */
export const TEST_AUTH_SECRET = randomBytes(32).toString('hex');
