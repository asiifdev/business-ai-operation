import { readdirSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The built server is plain Node ESM. CommonJS packages expose only a default export there, so `import { x } from 'pkg'`
 * works under Vitest and tsx and then crashes `pnpm start` ("does not provide an export named"). This once broke the whole
 * app after `ssh2` was added. Such packages must be imported as a whole and destructured.
 */
const CJS_PACKAGES = ['ssh2'];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = posix.join(dir, n);
    return statSync(p).isDirectory() ? (n === '__tests__' ? [] : walk(p)) : [p];
  });

describe('CommonJS packages in the built server', () => {
  it('are never imported by name in application code', () => {
    const offenders: string[] = [];
    for (const file of walk('src').filter((f) => /\.(ts|tsx|astro)$/.test(f))) {
      const text = readFileSync(file, 'utf8');
      for (const pkg of CJS_PACKAGES) {
        for (const m of text.matchAll(new RegExp(`import\\s+(?!type\\b)([^;]*?)\\s+from\\s+['"]${pkg}['"]`, 'g'))) {
          // `import x, { type A } from` is fine: type-only names disappear at build time. A value name inside braces is not.
          const braces = /\{([^}]*)\}/.exec(m[1])?.[1] ?? '';
          const valueNames = braces.split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('type '));
          if (valueNames.length > 0 || !/^\w+/.test(m[1].trim())) offenders.push(`${file}: ${m[0]}`);
        }
      }
    }
    expect(offenders, 'import the package as a default and destructure it').toEqual([]);
  });
});
