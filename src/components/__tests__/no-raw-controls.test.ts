import { readdirSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

// BR-M14-03: pages and non-form components must use the shared form components, never raw controls.
const ROOTS = ['src/pages', 'src/layouts', 'src/components'];
const ALLOWED = ['src/components/forms', 'src/components/__tests__'];
// Tag names are matched case-sensitively so <Textarea> / <SelectMenu> components are not flagged.
const RAW = /<select[\s>]|<textarea[\s>]|<input[^>]*type=["'{]*(checkbox|radio|number|file)/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = posix.join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('raw form controls', () => {
  it('are used only inside src/components/forms', () => {
    const offenders = ROOTS.flatMap(walk)
      .filter((f) => /\.(astro|tsx|jsx)$/.test(f) && !ALLOWED.some((a) => f.startsWith(a)))
      .filter((f) => RAW.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
