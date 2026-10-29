import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { organizations } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { optionalText, who } from '../portfolio/shared';

const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** `INV-{YYYY}-{NNNN}`: the number needs at least one `{N}` so invoices never share a number (BR-M03). */
const numberFormat = z.string().trim().max(40).regex(/\{N+\}/, 'format').regex(/^[A-Za-z0-9{}\-_/.]+$/, 'format');

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().max(60).refine(validZone, 'timezone'),
  locale: z.enum(['id', 'en']),
  graceDays: z.number().int().min(0).max(365),
  draftOffsetDays: z.number().int().min(0).max(90),
  schedulerHour: z.number().int().min(0).max(23),
  briefingHour: z.number().int().min(0).max(23),
  invoiceNumberFormat: numberFormat,
  /** Basis points: 1100 = 11%. */
  taxRateBps: z.number().int().min(0).max(10_000),
  stagnantDays: z.number().int().min(1).max(365),
  approvalTtlHours: z.number().int().min(1).max(720),
  bankName: optionalText(80),
  bankAccountName: optionalText(120),
  bankAccountNumber: optionalText(40),
});

const KEYS = Object.keys(orgSettingsSchema.shape) as Array<keyof z.infer<typeof orgSettingsSchema>>;
/** Payment details are not copied into the audit trail (BR-M15-06): only that they changed. */
const PRIVATE = new Set(['bankName', 'bankAccountName', 'bankAccountNumber']);

/** Everyone in the organization may read; invoices and the briefing already depend on these values. Currency is fixed to IDR. */
export async function getOrgSettings(ctx: Ctx) {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!row) throw new DomainError('not_found', 'organization');
  return { ...Object.fromEntries(KEYS.map((k) => [k, row[k]])), currency: row.currency } as z.infer<typeof orgSettingsSchema> & { currency: string };
}

/** Owner only (BR-M01-07, D-025). The audit row lists what changed, with values except payment details. */
export async function updateOrgSettings(ctx: Ctx, raw: z.input<typeof orgSettingsSchema>) {
  assertCan(ctx, 'org.settings.update');
  const input = orgSettingsSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId)).for('update');
    if (!before) throw new DomainError('not_found', 'organization');
    const next = { ...input, bankName: input.bankName ?? null, bankAccountName: input.bankAccountName ?? null, bankAccountNumber: input.bankAccountNumber ?? null };
    const changed = KEYS.filter((k) => before[k] !== next[k]);
    if (changed.length === 0) return { changed: [] as string[] };
    await tx.update(organizations).set(next).where(eq(organizations.id, ctx.orgId));
    const summary = Object.fromEntries(changed.map((k) => [k, PRIVATE.has(k) ? 'changed' : { from: before[k], to: next[k] }]));
    await recordAudit(tx, who(ctx), { action: 'org.settings_updated', entityType: 'organization', entityId: ctx.orgId, summary });
    return { changed: changed as string[] };
  });
}
