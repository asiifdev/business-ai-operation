import { readdirSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { competitors } from '../src/content/pricing';
import { processors, storageItems } from '../src/content/data-practices';
import { CONSENT_KEY } from '../src/lib/consent';

/**
 * BR-M16-32: the privacy page is generated from src/content/data-practices.ts. This test keeps that registry honest:
 * anything the code stores in the browser or talks to must be listed, so the page cannot silently go stale.
 */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = posix.join(dir, n);
    return statSync(p).isDirectory() ? (n === '__tests__' ? [] : walk(p)) : [p];
  });
const sources = walk('src').filter((f) => /\.(ts|tsx|astro)$/.test(f));
const code = sources.map((f) => ({ f, text: readFileSync(f, 'utf8') }));

describe('data-practices registry', () => {
  it('lists every localStorage key the code reads or writes', () => {
    const used = new Set<string>([CONSENT_KEY]);
    for (const { text } of code) for (const m of text.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)) used.add(m[1]);
    const listed = new Set(storageItems.filter((s) => s.kind === 'localStorage').map((s) => s.name));
    expect([...used].filter((k) => !listed.has(k)), 'localStorage keys missing from the registry').toEqual([]);
    expect([...listed].filter((k) => !used.has(k)), 'registry lists keys the code no longer uses').toEqual([]);
  });

  it('lists every external host the code can reach', () => {
    const allowed = new Set<string>([
      ...processors.flatMap((p) => p.hosts),
      ...competitors.map((c) => new URL(c.source).hostname),
      // Namespaces and links that are not requests to a third party:
      'schema.org', 'www.w3.org', 'www.sitemaps.org', 'localhost', '127.0.0.1', 'asiifdev.com', 'github.com', 'llmstxt.org',
    ]);
    const found = new Map<string, string>();
    for (const { f, text } of code) for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|127\.0\.0\.1)/gi)) if (!allowed.has(m[1].toLowerCase())) found.set(m[1], f);
    expect([...found.entries()], 'hosts missing from the registry (add them, with purpose and data, or remove them)').toEqual([]);
  });

  it('gates every Google host behind the consent module', () => {
    for (const { f, text } of code) {
      if (/googletagmanager|google-analytics/.test(text)) expect(f, 'Google hosts may only appear in the consent module and the registry').toMatch(/lib\/consent\.ts|content\/data-practices\.ts/);
    }
  });

  it('marks analytics cookies as consent-only and everything else the app sets as essential', () => {
    for (const s of storageItems) if (s.name.startsWith('_ga')) expect(s.consentOnly).toBe(true);
    for (const s of storageItems.filter((x) => !x.consentOnly)) expect(s.essential).toBe(true);
  });

  it('describes every entry in both languages', () => {
    for (const s of storageItems) for (const l of ['en', 'id'] as const) expect(s.purpose[l].length).toBeGreaterThan(10);
    for (const p of processors) for (const l of ['en', 'id'] as const) expect(p.data[l].length).toBeGreaterThan(10);
  });
});
