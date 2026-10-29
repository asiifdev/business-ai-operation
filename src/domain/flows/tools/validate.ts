import { z } from 'zod';

/** Shared checks for the values tools put into commands and requests (BR-M17-04). They run AFTER variables are rendered. */
export const repoName = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/);

export const branchName = z
  .string()
  .regex(/^[A-Za-z0-9._/-]{1,200}$/)
  .refine((b) => !b.startsWith('-') && !b.startsWith('/') && !b.endsWith('/') && !b.includes('..') && !b.includes('//') && !b.endsWith('.lock'), 'branch');

/** An absolute folder on the server: no `..`, no spaces, no shell characters, not the root. */
export const absPath = z
  .string()
  .regex(/^\/[A-Za-z0-9._/-]{1,200}$/)
  .refine((p) => !p.split('/').some((seg) => seg === '..') && p !== '/' && !p.endsWith('/'), 'path');

/** A path under a folder, relative: `storage/backups`. No hidden part (`.ssh`, `.config`) and no way up. */
export const relPath = z
  .string()
  .regex(/^[A-Za-z0-9._][A-Za-z0-9._/-]{0,199}$/)
  .refine((p) => !p.split('/').some((seg) => seg === '..' || seg.startsWith('.')) && !p.endsWith('/'), 'path');

/**
 * The folder an application lives in, for tools that run commands THERE (clone, composer, npm, artisan, pm2, env). Beyond
 * `absPath`: no hidden folder anywhere on the way (`/home/x/.ssh`) and not inside the system folders, so a flow written by an
 * Admin cannot aim these tools at the server's own configuration (security review, D-063).
 */
const SYSTEM_ROOTS = new Set(['etc', 'bin', 'sbin', 'usr', 'lib', 'lib64', 'boot', 'dev', 'proc', 'sys', 'root', 'run', 'snap']);
export const appDir = absPath.refine((p) => {
  const segments = p.split('/').filter(Boolean);
  if (segments.length === 0) return false; // the root has no first folder to look at
  return !SYSTEM_ROOTS.has(segments[0]) && !segments.some((seg) => seg.startsWith('.'));
}, 'folder');

export const domainName = z
  .string()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

export const dbIdentifier = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);

export const slotName = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

/** Numbers can arrive as text after variables are put in. */
export const intFrom = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const secretName = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const portList = (s: string): number[] =>
  s
    .split(/[,\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
