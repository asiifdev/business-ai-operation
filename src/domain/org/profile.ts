import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { organizationProfiles, organizations, orgServices, products } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { duplicate, who } from '../portfolio/shared';
import { profileSchema, profileText, serviceSchema, SOCIAL_KEYS, type ProfileFacts, type ProfileInput, type ServiceInput } from './profile-rules';

type Row = typeof organizationProfiles.$inferSelect;
type ServiceRow = typeof orgServices.$inferSelect;

const FIELDS = ['tagline', 'description', 'industry', 'website', 'contactEmail', 'contactPhone', 'address', 'targetAudience', 'valueProps'] as const;

export interface CompanyProfile {
  name: string;
  tagline: string | null;
  description: string | null;
  industry: string | null;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  socials: Record<string, string>;
  targetAudience: string | null;
  valueProps: string | null;
  hasLogo: boolean;
}

function shape(name: string, row: Row | undefined): CompanyProfile {
  return {
    name,
    tagline: row?.tagline ?? null,
    description: row?.description ?? null,
    industry: row?.industry ?? null,
    website: row?.website ?? null,
    contactEmail: row?.contactEmail ?? null,
    contactPhone: row?.contactPhone ?? null,
    address: row?.address ?? null,
    socials: row?.socials ?? {},
    targetAudience: row?.targetAudience ?? null,
    valueProps: row?.valueProps ?? null,
    hasLogo: Boolean(row?.logoFileId),
  };
}

/** The profile (empty fields before anyone fills it) and the services. Everyone in the organization may read it (D-079). */
export async function getCompanyProfile(ctx: Ctx): Promise<{ profile: CompanyProfile; services: ServiceRow[] }> {
  assertCan(ctx, 'org.profile.read');
  const [[org], [row], services] = await Promise.all([
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)),
    db.select().from(organizationProfiles).where(eq(organizationProfiles.orgId, ctx.orgId)),
    db.select().from(orgServices).where(eq(orgServices.orgId, ctx.orgId)).orderBy(asc(orgServices.sortOrder), asc(orgServices.name)),
  ]);
  if (!org) throw new DomainError('not_found', 'organization');
  return { profile: shape(org.name, row), services };
}

/** Owner and Admin (D-079). The audit row names the fields that changed, never their text. Returns what changed. */
export async function saveCompanyProfile(ctx: Ctx, raw: ProfileInput): Promise<{ changed: string[] }> {
  assertCan(ctx, 'org.profile.update');
  const input = profileSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(organizationProfiles).where(eq(organizationProfiles.orgId, ctx.orgId)).for('update');
    const socials = Object.fromEntries(SOCIAL_KEYS.flatMap((k) => (input.socials?.[k] ? [[k, input.socials[k]!]] : [])));
    const next = {
      tagline: input.tagline ?? null,
      description: input.description ?? null,
      industry: input.industry ?? null,
      website: input.website ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      address: input.address ?? null,
      targetAudience: input.targetAudience ?? null,
      valueProps: input.valueProps ?? null,
    };
    const changed: string[] = FIELDS.filter((k) => (before?.[k] ?? null) !== next[k]);
    if (JSON.stringify(before?.socials ?? {}) !== JSON.stringify(socials)) changed.push('socials');
    if (changed.length === 0) return { changed: [] };
    const [row] = await tx
      .insert(organizationProfiles)
      .values({ orgId: ctx.orgId, ...next, socials })
      .onConflictDoUpdate({ target: organizationProfiles.orgId, set: { ...next, socials, updatedAt: sql`now()` } })
      .returning({ id: organizationProfiles.id });
    await recordAudit(tx, who(ctx), { action: 'org.profile_updated', entityType: 'organization_profile', entityId: row!.id, summary: { changed } });
    return { changed };
  });
}

async function loadService(orgId: string, id: string) {
  const [row] = await db.select().from(orgServices).where(and(eq(orgServices.orgId, orgId), eq(orgServices.id, id)));
  if (!row) throw new DomainError('not_found', 'service');
  return row;
}

const isDuplicate = (err: unknown) => (err as { code?: string; cause?: { code?: string } })?.code === '23505' || (err as { cause?: { code?: string } })?.cause?.code === '23505';

export async function addService(ctx: Ctx, raw: ServiceInput): Promise<ServiceRow> {
  assertCan(ctx, 'org.profile.update');
  const input = serviceSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${orgServices.sortOrder}), -1) + 1` }).from(orgServices).where(eq(orgServices.orgId, ctx.orgId));
      const [row] = await tx.insert(orgServices).values({ orgId: ctx.orgId, name: input.name, description: input.description ?? null, sortOrder: Math.min(Number(next), 32_000) }).returning();
      await recordAudit(tx, who(ctx), { action: 'org.service_added', entityType: 'org_service', entityId: row!.id, summary: { name: input.name } });
      return row!;
    });
  } catch (err) {
    if (isDuplicate(err)) duplicate('service name');
    throw err;
  }
}

export async function updateService(ctx: Ctx, id: string, raw: ServiceInput): Promise<ServiceRow> {
  assertCan(ctx, 'org.profile.update');
  const input = serviceSchema.parse(raw);
  await loadService(ctx.orgId, id);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.update(orgServices).set({ name: input.name, description: input.description ?? null, updatedAt: sql`now()` }).where(and(eq(orgServices.orgId, ctx.orgId), eq(orgServices.id, id))).returning();
      await recordAudit(tx, who(ctx), { action: 'org.service_updated', entityType: 'org_service', entityId: id, summary: { name: input.name } });
      return row!;
    });
  } catch (err) {
    if (isDuplicate(err)) duplicate('service name');
    throw err;
  }
}

export async function removeService(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, 'org.profile.update');
  const row = await loadService(ctx.orgId, id);
  await db.transaction(async (tx) => {
    await tx.delete(orgServices).where(and(eq(orgServices.orgId, ctx.orgId), eq(orgServices.id, id)));
    await recordAudit(tx, who(ctx), { action: 'org.service_removed', entityType: 'org_service', entityId: id, summary: { name: row.name } });
  });
}

/**
 * Everything the AI may know about the company, as facts (D-079): the profile, the services and the names and
 * descriptions of the active products from Portfolio. No prices and nothing financial. The caller wraps it as untrusted
 * data. Empty when nothing is filled in beyond the name.
 */
export async function companyFacts(ctx: Ctx): Promise<ProfileFacts> {
  const [[org], [row], services, prods] = await Promise.all([
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)),
    db.select().from(organizationProfiles).where(eq(organizationProfiles.orgId, ctx.orgId)),
    db.select({ name: orgServices.name, description: orgServices.description }).from(orgServices).where(eq(orgServices.orgId, ctx.orgId)).orderBy(asc(orgServices.sortOrder), asc(orgServices.name)).limit(30),
    db.select({ name: products.name, description: products.description }).from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))).orderBy(asc(products.name)).limit(20),
  ]);
  return { ...shape(org?.name ?? '', row), services, products: prods };
}

/** `companyFacts` as the plain text a prompt carries. */
export async function companyContextText(ctx: Ctx): Promise<string> {
  return profileText(await companyFacts(ctx));
}
