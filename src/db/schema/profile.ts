import { sql } from 'drizzle-orm';
import { foreignKey, jsonb, pgTable, smallint, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, lower, updatedAtColumn } from './_shared';
import { organizations } from './auth';
import { files } from './meetings';

/**
 * ERD 3.1, D-079. The company profile: one row per organization, the single source of the business identity that the
 * screens show (the logo on posters) and that the AI is given as context. It never holds money figures.
 */
export const organizationProfiles = pgTable(
  'organization_profiles',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    tagline: text('tagline'),
    description: text('description'),
    industry: text('industry'),
    website: text('website'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    address: text('address'),
    /** Keys `instagram`, `facebook`, `linkedin`, `tiktok`, `youtube`, `x` mapped to https URLs. */
    socials: jsonb('socials').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    targetAudience: text('target_audience'),
    valueProps: text('value_props'),
    /** A `files` row of kind `brand_logo`. Replaces `brand_kits.logo_file_id`, which is no longer read. */
    logoFileId: text('logo_file_id'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_organization_profiles_org').on(t.orgId),
    foreignKey({ columns: [t.orgId, t.logoFileId], foreignColumns: [files.orgId, files.id], name: 'fk_organization_profiles_logo' }),
  ],
);

/** ERD 3.1, D-079. A service the company offers beyond the products in Portfolio (those stay in M02, not copied here). */
export const orgServices = pgTable(
  'org_services',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex('uq_org_services_name').on(t.orgId, lower(t.name))],
);
