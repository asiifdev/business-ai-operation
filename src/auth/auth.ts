import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { newId } from '../db/ids';
import { env } from '../lib/env';

/**
 * Email + password only (PRD section 0). Users are created by the app (registration creates the
 * organization and its Owner; Owners/Admins add colleagues), so the extra fields are never client input.
 */
export const auth = betterAuth({
  baseURL: env('BETTER_AUTH_URL'),
  secret: env('BETTER_AUTH_SECRET'),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  user: {
    additionalFields: {
      orgId: { type: 'string', required: true, input: false },
      role: { type: ['owner', 'admin', 'staff'], required: true, defaultValue: 'staff', input: false },
      locale: { type: ['id', 'en'], required: false, defaultValue: 'id' },
      isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
      mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },
  advanced: { database: { generateId: () => newId() } },
});
