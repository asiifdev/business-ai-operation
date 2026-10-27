import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against documents drifting apart (README vs PLAN vs BRD/PRD/ERD vs CHANGELOG).
 * Single source of truth for stage status: docs/PLAN.md section 1. Other files must agree with it or link to it.
 */

const read = (p: string) => readFileSync(p, 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const MD_FILES = ['README.md', 'CHANGELOG.md', 'CLAUDE.md', ...walk('docs').filter((f) => f.endsWith('.md'))];
const ICON = /^(✅|📝|🚧|⬜|🟢)/;

/** First status icon in the "| **Status** | ... |" header row of a document. */
function headerStatus(file: string): string | null {
  const row = read(file).split('\n').find((l) => l.startsWith('| **Status**'));
  const cell = row?.split('|')[2]?.trim() ?? '';
  return ICON.exec(cell)?.[1] ?? null;
}

function planRow(label: string): string {
  const row = read('docs/PLAN.md').split('\n').find((l) => l.startsWith(`| ${label} |`));
  if (!row) throw new Error(`docs/PLAN.md has no stage row "${label}"`);
  return row;
}
const planIcon = (label: string) => ICON.exec(planRow(label).split('|')[3].trim())?.[1] ?? null;

describe('links and references', () => {
  it('has no broken relative markdown links', () => {
    const broken: string[] = [];
    for (const file of MD_FILES) {
      for (const m of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1].split('#')[0];
        if (!target || /^(https?:|mailto:)/.test(target)) continue;
        if (!existsSync(normalize(join(dirname(file), target)))) broken.push(`${file} -> ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('only mentions docs files that exist', () => {
    const missing: string[] = [];
    for (const file of MD_FILES) {
      for (const m of read(file).matchAll(/`(docs\/[\w./-]+\.md)`/g)) {
        if (!existsSync(m[1]) && !m[1].includes('Mxx') && !m[1].includes('*')) missing.push(`${file} -> ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('only cites decisions that exist in DECISIONS.md', () => {
    const known = new Set([...read('docs/DECISIONS.md').matchAll(/^\| (D-\d{3}) \|/gm)].map((m) => m[1]));
    const unknown: string[] = [];
    for (const file of MD_FILES.filter((f) => f !== 'docs/DECISIONS.md')) {
      for (const m of read(file).matchAll(/\bD-\d{3}\b/g)) if (!known.has(m[0])) unknown.push(`${file} -> ${m[0]}`);
    }
    expect(unknown).toEqual([]);
  });
});

describe('index completeness', () => {
  it('README lists every top-level docs file', () => {
    const readme = read('README.md');
    const missing = readdirSync('docs')
      .filter((f) => f.endsWith('.md'))
      .filter((f) => !readme.includes(`docs/${f}`));
    expect(missing).toEqual([]);
  });

  it('docs/brd/README.md lists every BRD module file', () => {
    const index = read('docs/brd/README.md');
    const missing = readdirSync('docs/brd')
      .filter((f) => /^BRD-M\d+/.test(f))
      .filter((f) => !index.includes(f));
    expect(missing).toEqual([]);
  });
});

describe('status consistency (source of truth: docs/PLAN.md)', () => {
  it('PLAN, BRD, PRD and ERD headers agree', () => {
    const mismatches: string[] = [];
    const check = (label: string, files: string[]) => {
      for (const f of files) {
        if (headerStatus(f) !== planIcon(label)) mismatches.push(`${f}: header ${headerStatus(f)} vs PLAN ${label} ${planIcon(label)}`);
      }
    };
    check('BRD', ['docs/BRD.md', ...readdirSync('docs/brd').filter((f) => /^BRD-M\d+/.test(f)).map((f) => `docs/brd/${f}`)]);
    check('PRD', ['docs/PRD.md']);
    check('ERD', ['docs/ERD.md']);
    expect(mismatches).toEqual([]);
  });

  it('docs/brd/README.md module statuses match each BRD file', () => {
    const rows = read('docs/brd/README.md').split('\n').filter((l) => /\]\(BRD-M\d+/.test(l));
    const mismatches: string[] = [];
    for (const row of rows) {
      const file = /\((BRD-M[^)]+\.md)\)/.exec(row)![1];
      const cells = row.split('|').map((c) => c.trim());
      const shown = ICON.exec(cells[cells.length - 2])?.[1] ?? null;
      if (shown !== headerStatus(`docs/brd/${file}`)) mismatches.push(`${file}: index ${shown} vs file ${headerStatus(`docs/brd/${file}`)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('does not describe the project as still being in the documentation phase once coding is open', () => {
    if (planIcon('Coding') !== '🟢') return;
    const stale = ['README.md', 'CLAUDE.md']
      .filter((f) => /fase dokumentasi|scaffold saja|belum ada skema database/i.test(read(f)));
    expect(stale).toEqual([]);
  });

  it('README does not copy stage statuses; it points to docs/PLAN.md', () => {
    const readme = read('README.md');
    expect(readme).toContain('docs/PLAN.md');
    expect(/\|\s*(✅|📝|⬜)\s*(disetujui|draf|menunggu)/i.test(readme)).toBe(false);
  });
});

describe('README commands', () => {
  it('only mentions pnpm scripts that exist in package.json', () => {
    const scripts = Object.keys(JSON.parse(read('package.json')).scripts);
    const builtins = new Set(['install', 'add', 'exec', 'dlx', 'run']);
    const unknown = [...read('README.md').matchAll(/^pnpm (\w[\w:-]*)/gm)].map((m) => m[1]).filter((c) => !scripts.includes(c) && !builtins.has(c));
    expect(unknown).toEqual([]);
  });
});

describe('CHANGELOG', () => {
  it('has a non-empty Unreleased section', () => {
    const section = /## \[Unreleased\]([\s\S]*?)(\n## \[|$)/.exec(read('CHANGELOG.md'))?.[1] ?? '';
    expect(section.replace(/### \w+/g, '').trim().length).toBeGreaterThan(0);
  });

  it('mentions the database schema once schema files exist', () => {
    const schemaFiles = existsSync('src/db/schema') ? readdirSync('src/db/schema').filter((f) => f !== 'index.ts' && f.endsWith('.ts')) : [];
    if (schemaFiles.length === 0) return;
    expect(/skema|schema|migrasi|migration/i.test(read('CHANGELOG.md'))).toBe(true);
  });
});
