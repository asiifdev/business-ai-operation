import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, pgEnum, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, lower, tstz, updatedAtColumn } from './_shared';
import { organizations } from './auth';

export const deploymentStatus = pgEnum('deployment_status', ['active', 'inactive']);

/** ERD 3.2. A product the organization sells or runs for clients. Its packages are the only source of prices (CR-05). */
export const products = pgTable(
  'products',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    /** The version clients should be on. "Behind" is derived from this, never stored (BR-M02-05). */
    currentVersion: text('current_version'),
    archivedAt: tstz('archived_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_products_org_id').on(t.orgId, t.id),
    uniqueIndex('uq_products_name_active').on(t.orgId, lower(t.name)).where(sql`${t.archivedAt} is null`),
  ],
);

/** Official packages and monthly prices in whole Rupiah (BR-M02-01, -02). Subscriptions copy the price when created. */
export const packages = pgTable(
  'packages',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    productId: text('product_id').notNull(),
    name: text('name').notNull(),
    monthlyPrice: bigint('monthly_price', { mode: 'number' }).notNull(),
    features: text('features'),
    archivedAt: tstz('archived_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_packages_org_id').on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id], name: 'fk_packages_product' }),
    uniqueIndex('uq_packages_name').on(t.productId, lower(t.name)),
    check('packages_price_ck', sql`${t.monthlyPrice} >= 0`),
  ],
);

/** A client. `nameKey` is the name lower-cased with spaces tidied, so "Aksara  Studio" and "aksara studio" collide (BR-M02-10). */
export const clients = pgTable(
  'clients',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    notes: text('notes'),
    archivedAt: tstz('archived_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [unique('uq_clients_org_id').on(t.orgId, t.id), unique('uq_clients_name_key').on(t.orgId, t.nameKey)],
);

/**
 * A product installed for a client (BR-M02-03). There is deliberately no column for passwords, tokens or environment
 * variables (BR-M02-07): this system never holds deployment secrets.
 */
export const deployments = pgTable(
  'deployments',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    productId: text('product_id').notNull(),
    clientId: text('client_id').notNull(),
    environment: text('environment').notNull(),
    label: text('label'),
    domain: text('domain'),
    installedVersion: text('installed_version'),
    status: deploymentStatus('status').notNull().default('active'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_deployments_org_id').on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id], name: 'fk_deployments_product' }),
    foreignKey({ columns: [t.orgId, t.clientId], foreignColumns: [clients.orgId, clients.id], name: 'fk_deployments_client' }),
    unique('uq_deployments_slot').on(t.productId, t.clientId, t.environment),
    index('idx_deployments_client').on(t.orgId, t.clientId),
  ],
);
