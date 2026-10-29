import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, files } from '../../../db/schema';
import { setStorage, type Storage } from '../../../integrations/storage';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { MAX_LOGO_BYTES, readProductLogo, removeProductLogo, setProductLogo, sniffImage } from '../logo';
import { createProduct, deleteProduct, listProducts } from '../products';

afterAll(async () => {
  setStorage(undefined);
  await pg.end();
});

function memoryStorage(): Storage & { keys: () => string[] } {
  const objects = new Map<string, Uint8Array>();
  return {
    put: async (key, bytes) => void objects.set(key, bytes),
    get: async (key) => {
      const v = objects.get(key);
      if (!v) throw new Error('missing object');
      return v;
    },
    delete: async (key) => void objects.delete(key),
    keys: () => [...objects.keys()],
  };
}
let store: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  store = memoryStorage();
  setStorage(store);
});

const png = (w = 900, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: '#1F3A5F' } }).png().toBuffer();
const rejects = async (promise: Promise<unknown>, code: string, message?: RegExp) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (message) expect((err as DomainError).message).toMatch(message);
};

describe('D-065 product logo', () => {
  it('recognises pictures from their bytes and refuses SVG and other files', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0]))).toBe('png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('MZ executable'))).toBeNull();
  });

  it('stores a resized WebP of at most 512 px, marks the product, audits, and serves it back by organization', async () => {
    const o = await makeOrg();
    const { id } = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
    await setProductLogo(o.adminCtx, id, new Uint8Array(await png()));
    const logo = await readProductLogo(o.staffCtx, id);
    const meta = await sharp(logo.bytes).metadata();
    expect(logo.mime).toBe('image/webp');
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(512);
    expect((await listProducts(o.ownerCtx)).find((p) => p.id === id)?.hasLogo).toBe(true);
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'product.logo_set')));
    expect(rows).toHaveLength(1);
  });

  it('does not enlarge a small picture', async () => {
    const o = await makeOrg();
    const { id } = await createProduct(o.ownerCtx, { name: 'Kecil' });
    await setProductLogo(o.ownerCtx, id, new Uint8Array(await png(64, 64)));
    expect((await sharp((await readProductLogo(o.ownerCtx, id)).bytes).metadata()).width).toBe(64);
  });

  it('replacing the logo removes the old file from the database and storage', async () => {
    const o = await makeOrg();
    const { id } = await createProduct(o.ownerCtx, { name: 'Ganti' });
    await setProductLogo(o.ownerCtx, id, new Uint8Array(await png(100, 100)));
    await setProductLogo(o.ownerCtx, id, new Uint8Array(await png(120, 120)));
    expect(store.keys()).toHaveLength(1);
    expect(await db.select().from(files).where(and(eq(files.orgId, o.orgId), eq(files.kind, 'product_logo')))).toHaveLength(1);
  });

  it('removes the logo, and deleting a product removes its logo too', async () => {
    const o = await makeOrg();
    const a = await createProduct(o.ownerCtx, { name: 'Satu' });
    const b = await createProduct(o.ownerCtx, { name: 'Dua' });
    await setProductLogo(o.ownerCtx, a.id, new Uint8Array(await png(100, 100)));
    await setProductLogo(o.ownerCtx, b.id, new Uint8Array(await png(100, 100)));
    await removeProductLogo(o.ownerCtx, a.id);
    await rejects(readProductLogo(o.ownerCtx, a.id), 'not_found');
    expect(store.keys()).toHaveLength(1);
    await deleteProduct(o.ownerCtx, b.id);
    expect(store.keys()).toHaveLength(0);
    expect(await db.select().from(files).where(and(eq(files.orgId, o.orgId), eq(files.kind, 'product_logo')))).toHaveLength(0);
  });

  it('refuses SVG, a corrupt picture, an empty file and an oversize one, leaving nothing stored', async () => {
    const o = await makeOrg();
    const { id } = await createProduct(o.ownerCtx, { name: 'Tolak' });
    await rejects(setProductLogo(o.ownerCtx, id, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'validation', /format/);
    await rejects(setProductLogo(o.ownerCtx, id, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9])), 'validation', /format/);
    await rejects(setProductLogo(o.ownerCtx, id, new Uint8Array(0)), 'validation', /size/);
    await rejects(setProductLogo(o.ownerCtx, id, new Uint8Array(MAX_LOGO_BYTES + 1)), 'validation', /size/);
    expect(store.keys()).toHaveLength(0);
  });

  it('Staff cannot change a logo, and another organization cannot see or change it', async () => {
    const o = await makeOrg();
    const other = await makeOrg();
    const { id } = await createProduct(o.ownerCtx, { name: 'Rahasia' });
    await rejects(setProductLogo(o.staffCtx, id, new Uint8Array(await png(50, 50))), 'forbidden');
    await setProductLogo(o.ownerCtx, id, new Uint8Array(await png(50, 50)));
    await rejects(readProductLogo(other.ownerCtx, id), 'not_found');
    await rejects(setProductLogo(other.ownerCtx, id, new Uint8Array(await png(50, 50))), 'not_found');
    await rejects(removeProductLogo(other.ownerCtx, id), 'not_found');
  });
});
