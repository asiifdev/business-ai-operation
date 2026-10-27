import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { features } from '../src/content/features';

/**
 * BR-M16-02: the public site may only claim what is built. Each feature points at a row of docs/PLAN.md section 1a
 * and its status must match the row's icon: ✅ available, 🚧 in development, ⬜ planned.
 */
const plan = readFileSync('docs/PLAN.md', 'utf8');
const section = /## 1a\.[\s\S]*?(?=\n## )/.exec(plan)?.[0] ?? '';
const rows = new Map<string, string>();
for (const line of section.split('\n')) {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length > 3 && cells[1] && /^(✅|🚧|⬜)/u.test(cells[2])) rows.set(cells[1], cells[2].startsWith('✅') ? 'available' : cells[2].startsWith('🚧') ? 'in_development' : 'planned');
}

describe('public feature claims follow docs/PLAN.md', () => {
  it('finds the implementation status table', () => {
    expect(rows.size).toBeGreaterThan(5);
  });

  it.each(features.map((f) => [f.id, f] as const))('%s matches its PLAN row', (_id, f) => {
    expect(rows.has(f.planRow), `docs/PLAN.md section 1a has no row "${f.planRow}"`).toBe(true);
    expect(f.status, `"${f.planRow}" is ${rows.get(f.planRow)} in PLAN`).toBe(rows.get(f.planRow));
  });

  it('never marks something available without a finished PLAN row', () => {
    for (const f of features.filter((x) => x.status === 'available')) expect(rows.get(f.planRow)).toBe('available');
  });
});
