/**
 * Version comparison for "behind" (BR-M02-05, BR-M02-06). Semantic versions are compared by precedence; anything else is
 * "unknown" (shown as "cannot be compared"), never guessed. Build metadata (`+abc`) is ignored, a leading `v` is allowed.
 */
interface Parsed {
  core: [number, number, number];
  pre: string[];
}

const PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemver(version: string | null | undefined): Parsed | null {
  const match = version ? PATTERN.exec(version.trim()) : null;
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] };
}

const isNumeric = (s: string) => /^\d+$/.test(s);

function comparePre(a: string[], b: string[]): number {
  // A version without a pre-release is higher than the same version with one.
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const [x, y] = [a[i], b[i]];
    if (x === y) continue;
    if (isNumeric(x) && isNumeric(y)) return Number(x) < Number(y) ? -1 : 1;
    if (isNumeric(x)) return -1; // numeric identifiers rank below alphanumeric ones
    if (isNumeric(y)) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Negative when `a < b`, 0 when equal, positive when `a > b`, or null when either is not a semantic version. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const [pa, pb] = [parseSemver(a), parseSemver(b)];
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  return comparePre(pa.pre, pb.pre);
}

export type VersionState = 'current' | 'behind' | 'ahead' | 'unknown';

/** Where an installed version stands against the product's current one. Missing or non-semver versions are `unknown`. */
export function versionState(installed: string | null | undefined, current: string | null | undefined): VersionState {
  const order = compareVersions(installed, current);
  if (order === null) return 'unknown';
  return order < 0 ? 'behind' : order > 0 ? 'ahead' : 'current';
}

export const isBehind = (installed: string | null | undefined, current: string | null | undefined) => versionState(installed, current) === 'behind';
