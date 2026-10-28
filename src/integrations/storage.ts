import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { env } from '../lib/env';

/**
 * Where uploaded files live (D-023). Callers only ever pass keys built by the application (`org/<org_id>/…`), never a
 * path from a request; the disk driver still refuses any key that would leave its folder.
 */
export interface Storage {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Removing an object that is already gone is not an error. */
  delete(key: string): Promise<void>;
}

const KEY = /^org\/[0-9A-Za-z]+\/[0-9A-Za-z/_.-]+$/;

function assertKey(key: string) {
  if (!KEY.test(key) || key.includes('..')) throw new Error('invalid storage key');
}

/** Local folder (development, tests, and a single server without R2). */
export function diskStorage(root: string): Storage {
  const base = resolve(root);
  const pathOf = (key: string) => {
    assertKey(key);
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new Error('invalid storage key');
    return full;
  };
  return {
    async put(key, bytes) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      return new Uint8Array(await readFile(pathOf(key)));
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}

const globalForStorage = globalThis as unknown as { __storage?: Storage };

/**
 * The configured store. `STORAGE_DRIVER=disk` (default) writes under `STORAGE_DIR`. `r2` is the target for the live
 * server (D-023) but is not implemented yet: it fails loudly instead of silently writing somewhere else.
 */
export function storage(): Storage {
  if (globalForStorage.__storage) return globalForStorage.__storage;
  const driver = env('STORAGE_DRIVER') ?? 'disk';
  if (driver !== 'disk') throw new Error(`STORAGE_DRIVER=${driver} is not available yet; use disk`);
  globalForStorage.__storage = diskStorage(env('STORAGE_DIR') ?? './storage');
  return globalForStorage.__storage;
}

/** For tests: replace the store (pass undefined to go back to the configured one). */
export function setStorage(next: Storage | undefined) {
  globalForStorage.__storage = next;
}
