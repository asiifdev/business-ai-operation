import { readdirSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * React empties `event.currentTarget` as soon as the handler returns. A state updater (`setX((p) => ...)`) may run after
 * that, so reading `e.currentTarget.value` inside one throws "Cannot read properties of null" at random while typing, and
 * the whole island disappears. The value must be read first, then handed to the updater (company profile form, 2026-10-31).
 */
const UPDATER_READS_EVENT = /\bset[A-Z]\w*\(\s*\(?\s*\w+\s*\)?\s*=>[^;]{0,240}?\.currentTarget\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = posix.join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('event values', () => {
  it('are read before a state updater, never inside one', () => {
    const offenders = walk('src/components')
      .filter((f) => /\.tsx$/.test(f) && !f.includes('__tests__'))
      .filter((f) => UPDATER_READS_EVENT.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('would have caught the company profile bug', () => {
    expect(UPDATER_READS_EVENT.test("const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.currentTarget.value }));")).toBe(true);
    expect(UPDATER_READS_EVENT.test("const set = (k) => (e) => { const value = e.currentTarget.value; setV((p) => ({ ...p, [k]: value })); };")).toBe(false);
  });
});
