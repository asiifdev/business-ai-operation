import { sql } from 'drizzle-orm';
import { bigint, text, timestamp } from 'drizzle-orm/pg-core';
import { newId } from '../ids';

/** ULID primary key (ERD section 1). Better Auth tables use the same generator via auth config. */
export const idColumn = () => text('id').primaryKey().$defaultFn(newId);

/** Integer Rupiah and other whole-number amounts: bigint, never float (CR-04). */
export const bigAmount = (name: string) => bigint(name, { mode: 'number' });

/** Timestamps are always timestamptz. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAtColumn = () => tstz('created_at').defaultNow().notNull();
export const updatedAtColumn = () =>
  tstz('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const lower = (column: unknown) => sql`lower(${column})`;
