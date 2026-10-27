import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { newId } from '../db/ids';
import { env } from '../lib/env';

const isDev = Boolean(import.meta.env?.DEV);
const isTest = import.meta.env?.MODE === 'test';

/** A weak or missing secret must never reach production: sessions would be forgeable. */
function authSecret(): string | undefined {
  const secret = env('BETTER_AUTH_SECRET');
  if (!isDev && !isTest && (!secret || secret.length < 32)) {
    throw new Error('BETTER_AUTH_SECRET must be set to a random value of at least 32 characters in production');
  }
  return secret;
}

const DEV_ORIGIN = 'http://localhost:4321';
const publicOrigin = env('APP_URL') ?? env('BETTER_AUTH_URL');

/**
 * Email + password only (PRD section 0). Users are created by our services (registration creates the
 * organization and its Owner; Owners/Admins add colleagues), so the extra fields are never client input.
 */
export const auth = betterAuth({
  // In development the app is served from localhost even if .env holds the public address.
  baseURL: isTest ? (env('BETTER_AUTH_URL') ?? DEV_ORIGIN) : isDev ? DEV_ORIGIN : env('BETTER_AUTH_URL'),
  secret: authSecret(),
  // localhost is trusted only while developing or testing, never in production.
  trustedOrigins: [...(isDev || isTest ? [DEV_ORIGIN] : []), ...(publicOrigin ? [new URL(publicOrigin).origin] : [])],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  // Login attempts are limited per IP (BR-M01-09). Calls through auth.api (server side) bypass this limiter.
  rateLimit: { enabled: true, window: 60, max: 60, customRules: { '/sign-in/email': { window: 60, max: 5 } } },
  user: {
    additionalFields: {
      orgId: { type: 'string', required: true, input: false },
      role: { type: ['owner', 'admin', 'staff'], required: true, defaultValue: 'staff', input: false },
      locale: { type: ['id', 'en'], required: false, defaultValue: 'id' },
      isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
      mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // A deactivated user can never obtain a session (BR-M01-06).
        before: async (session) => {
          const [user] = await db.select({ active: schema.users.isActive }).from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
          if (!user?.active) return false;
          return { data: session };
        },
      },
    },
  },
  advanced: { database: { generateId: () => newId() } },
});
