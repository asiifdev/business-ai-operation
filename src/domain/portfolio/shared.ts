import { z } from 'zod';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';

export const who = (ctx: Ctx) => ({ orgId: ctx.orgId, actor: ctx.actor, userId: ctx.userId, aiRunId: ctx.aiRunId });

/** Tidies a name: trims and collapses runs of spaces, so "Aksara   Studio " is stored as "Aksara Studio". */
export const tidyName = (name: string) => name.replace(/\s+/g, ' ').trim();

/** Case-insensitive key used to keep names unique (BR-M02-10). */
export const nameKey = (name: string) => tidyName(name).toLowerCase();

/** Empty input becomes null, so a cleared field really clears the column. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const nameField = z.string().transform(tidyName).pipe(z.string().min(2).max(120));

/** Maps a duplicate-name database error to a domain error the UI can explain. */
export function duplicate(message: string): never {
  throw new DomainError('duplicate', message);
}

/** The largest price we accept: 1 trillion Rupiah a month, far above any real package and well inside a bigint. */
export const MAX_PRICE = 1_000_000_000_000;
