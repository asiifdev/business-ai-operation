import { foreignKey, index, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './_shared';
import { aiRuns } from './ai';
import { organizations } from './auth';
import { files } from './meetings';
import { products } from './portfolio';

export const marketingPurpose = pgEnum('marketing_purpose', ['launch', 'promo', 'education', 'release']);

/** ERD 3.7, BRD-M10. One brand kit per organization: the words and colours every generated image and caption follows. */
export const brandKits = pgTable('brand_kits', {
  id: idColumn(),
  orgId: text('org_id').notNull().unique('uq_brand_kits_org').references(() => organizations.id, { onDelete: 'restrict' }),
  brandName: text('brand_name').notNull(),
  /** Free text list of colour codes, for example `#1F3A5F, #F4E9D8`. */
  colors: text('colors'),
  tone: text('tone'),
  prohibitions: text('prohibitions'),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/**
 * ERD 3.7. One generated image. A revision is a new row whose `parent_asset_id` is the image it came from; the old one
 * stays (BRD-M10 section 10). The picture itself is a `files` row marked as AI generated (BR-M10-04, -09).
 */
export const marketingAssets = pgTable(
  'marketing_assets',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    productId: text('product_id').notNull(),
    purpose: marketingPurpose('purpose').notNull(),
    prompt: text('prompt').notNull(),
    parentAssetId: text('parent_asset_id'),
    fileId: text('file_id').notNull(),
    caption: text('caption'),
    aiRunId: text('ai_run_id').references(() => aiRuns.id, { onDelete: 'restrict' }),
    createdBy: text('created_by').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique('uq_marketing_assets_org_id').on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id], name: 'fk_marketing_assets_product' }),
    foreignKey({ columns: [t.orgId, t.parentAssetId], foreignColumns: [t.orgId, t.id], name: 'fk_marketing_assets_parent' }),
    foreignKey({ columns: [t.orgId, t.fileId], foreignColumns: [files.orgId, files.id], name: 'fk_marketing_assets_file' }),
    index('idx_marketing_assets_org_created').on(t.orgId, t.createdAt),
  ],
);
