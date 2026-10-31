import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { db } from '../../db/client';
import { newId } from '../../db/ids';
import { files, organizationProfiles, products } from '../../db/schema';
import { storage } from '../../integrations/storage';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { who } from './shared';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_PIXELS = 512;

/** PNG, JPEG or WebP, recognised from the first bytes. SVG is refused on purpose: it can carry script (D-065). */
export function sniffImage(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | null {
  const at = (i: number) => bytes[i];
  if (bytes.length > 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png';
  if (bytes.length > 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg';
  if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
  return null;
}

async function loadProduct(orgId: string, id: string) {
  const [row] = await db.select({ id: products.id, logoFileId: products.logoFileId, archivedAt: products.archivedAt }).from(products).where(and(eq(products.orgId, orgId), eq(products.id, id)));
  if (!row) throw new DomainError('not_found', 'product');
  return row;
}

/** Checks and re-encodes an uploaded logo: PNG, JPEG or WebP under 2 MB, as a WebP of at most 512 px (metadata dropped). */
export async function encodeLogo(bytes: Uint8Array): Promise<Buffer> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) throw new DomainError('validation', 'logo:size');
  if (!sniffImage(bytes)) throw new DomainError('validation', 'logo:format');
  try {
    return await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(LOGO_PIXELS, LOGO_PIXELS, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
  } catch {
    throw new DomainError('validation', 'logo:format');
  }
}

/**
 * Sets a product's logo. The picture is re-encoded to a WebP of at most 512 px, which drops any embedded metadata and
 * anything that is not really a picture. The old logo's file is removed once the new one is in place.
 */
export async function setProductLogo(ctx: Ctx, productId: string, bytes: Uint8Array): Promise<void> {
  assertCan(ctx, 'catalog.write');
  const product = await loadProduct(ctx.orgId, productId);
  if (product.archivedAt) throw new DomainError('invalid_state', 'archived product');
  const webp = await encodeLogo(bytes);
  const fileId = newId();
  const key = `org/${ctx.orgId}/products/${fileId}.webp`;
  await storage().put(key, webp, 'image/webp');
  let oldKey: string | undefined;
  try {
    oldKey = await db.transaction(async (tx) => {
      await tx.insert(files).values({ id: fileId, orgId: ctx.orgId, kind: 'product_logo', storageKey: key, mime: 'image/webp', sizeBytes: webp.byteLength, sha256: createHash('sha256').update(webp).digest('hex'), createdBy: ctx.userId });
      await tx.update(products).set({ logoFileId: fileId }).where(and(eq(products.orgId, ctx.orgId), eq(products.id, productId)));
      const [old] = product.logoFileId ? await tx.delete(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, product.logoFileId))).returning({ key: files.storageKey }) : [];
      await recordAudit(tx, who(ctx), { action: 'product.logo_set', entityType: 'product', entityId: productId, summary: { bytes: webp.byteLength } });
      return old?.key;
    });
  } catch (err) {
    await storage().delete(key).catch(() => undefined);
    throw err;
  }
  if (oldKey) await storage().delete(oldKey).catch(() => undefined);
}

export async function removeProductLogo(ctx: Ctx, productId: string): Promise<void> {
  assertCan(ctx, 'catalog.write');
  const product = await loadProduct(ctx.orgId, productId);
  if (!product.logoFileId) return;
  const key = await db.transaction(async (tx) => {
    await tx.update(products).set({ logoFileId: null }).where(and(eq(products.orgId, ctx.orgId), eq(products.id, productId)));
    const [old] = await tx.delete(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, product.logoFileId!))).returning({ key: files.storageKey });
    await recordAudit(tx, who(ctx), { action: 'product.logo_removed', entityType: 'product', entityId: productId });
    return old?.key;
  });
  if (key) await storage().delete(key).catch(() => undefined);
}

/** The logo picture, found through the product's own organization. */
export async function readProductLogo(ctx: Ctx, productId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  assertCan(ctx, 'catalog.read');
  const product = await loadProduct(ctx.orgId, productId);
  if (!product.logoFileId) throw new DomainError('not_found', 'logo');
  const [file] = await db.select({ key: files.storageKey, mime: files.mime }).from(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, product.logoFileId)));
  if (!file) throw new DomainError('not_found', 'logo');
  return { bytes: await storage().get(file.key), mime: file.mime };
}

// ---------------------------------------------------------------------------------------------------------------------
// Company logo (D-066): lives on the brand kit, laid onto every poster that has no product logo.

async function loadProfileLogo(orgId: string) {
  const [row] = await db.select({ id: organizationProfiles.id, logoFileId: organizationProfiles.logoFileId }).from(organizationProfiles).where(eq(organizationProfiles.orgId, orgId));
  return row ?? null;
}

/** Owner and Admin only (D-079). The logo lives on the company profile, which is created here if it does not exist yet. */
export async function setBrandLogo(ctx: Ctx, bytes: Uint8Array): Promise<void> {
  assertCan(ctx, 'org.profile.update');
  const before = await loadProfileLogo(ctx.orgId);
  const webp = await encodeLogo(bytes);
  const fileId = newId();
  const key = `org/${ctx.orgId}/brand/${fileId}.webp`;
  await storage().put(key, webp, 'image/webp');
  let oldKey: string | undefined;
  try {
    oldKey = await db.transaction(async (tx) => {
      await tx.insert(files).values({ id: fileId, orgId: ctx.orgId, kind: 'brand_logo', storageKey: key, mime: 'image/webp', sizeBytes: webp.byteLength, sha256: createHash('sha256').update(webp).digest('hex'), createdBy: ctx.userId });
      const [profile] = await tx.insert(organizationProfiles).values({ orgId: ctx.orgId, logoFileId: fileId }).onConflictDoUpdate({ target: organizationProfiles.orgId, set: { logoFileId: fileId } }).returning({ id: organizationProfiles.id });
      const [old] = before?.logoFileId ? await tx.delete(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, before.logoFileId))).returning({ key: files.storageKey }) : [];
      await recordAudit(tx, who(ctx), { action: 'brand_logo.set', entityType: 'organization_profile', entityId: profile!.id, summary: { bytes: webp.byteLength } });
      return old?.key;
    });
  } catch (err) {
    await storage().delete(key).catch(() => undefined);
    throw err;
  }
  if (oldKey) await storage().delete(oldKey).catch(() => undefined);
}

export async function removeBrandLogo(ctx: Ctx): Promise<void> {
  assertCan(ctx, 'org.profile.update');
  const profile = await loadProfileLogo(ctx.orgId);
  if (!profile?.logoFileId) return;
  const key = await db.transaction(async (tx) => {
    await tx.update(organizationProfiles).set({ logoFileId: null }).where(eq(organizationProfiles.id, profile.id));
    const [old] = await tx.delete(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, profile.logoFileId!))).returning({ key: files.storageKey });
    await recordAudit(tx, who(ctx), { action: 'brand_logo.removed', entityType: 'organization_profile', entityId: profile.id });
    return old?.key;
  });
  if (key) await storage().delete(key).catch(() => undefined);
}

/** Reads a stored logo file of this organization, or null when the row is gone. */
export async function readLogoFile(orgId: string, fileId: string | null): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!fileId) return null;
  const [file] = await db.select({ key: files.storageKey, mime: files.mime }).from(files).where(and(eq(files.orgId, orgId), eq(files.id, fileId)));
  return file ? { bytes: await storage().get(file.key), mime: file.mime } : null;
}

export async function readBrandLogo(ctx: Ctx): Promise<{ bytes: Uint8Array; mime: string }> {
  assertCan(ctx, 'org.profile.read');
  const logo = await readLogoFile(ctx.orgId, (await loadProfileLogo(ctx.orgId))?.logoFileId ?? null);
  if (!logo) throw new DomainError('not_found', 'logo');
  return logo;
}
