import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup, referencesOf, render, shellQuote, TemplateError, type Scope } from '../template';

const scope = (over: Partial<Scope> = {}): Scope => ({ params: { slug: 'demo-main', n: 3, on: true }, nodes: { db: { name: 'db_demo' } }, product: { repo: 'asiifdev/app' }, secrets: { pw: 's3cr3t-value' }, ...over });

describe('references', () => {
  it('lists each reference once, in order', () => {
    expect(referencesOf('a {{params.x}} b {{ nodes.db.name }} c {{params.x}}')).toEqual(['params.x', 'nodes.db.name']);
    expect(referencesOf('no variables, {not} {{ }} {{1bad}}')).toEqual([]);
  });
  it('resolves params, product, node outputs and secrets, and nothing else', () => {
    const s = scope();
    expect(lookup(s, 'params.slug')).toBe('demo-main');
    expect(lookup(s, 'nodes.db.name')).toBe('db_demo');
    expect(lookup(s, 'product.repo')).toBe('asiifdev/app');
    expect(lookup(s, 'secrets.pw')).toBe('s3cr3t-value');
    for (const bad of ['params', 'params.a.b', 'nodes.db', 'nodes.x.y', 'env.HOME', 'process.env.SECRET', '__proto__.x', 'params.__proto__']) expect(lookup(s, bad)).toBeUndefined();
  });
});

describe('rendering', () => {
  it('puts text as is, json as a literal', () => {
    expect(render('x={{params.slug}}', scope(), { context: 'text' }).text).toBe('x=demo-main');
    expect(render('{"n":{{params.n}},"s":{{params.slug}}}', scope(), { context: 'json' }).text).toBe('{"n":3,"s":"demo-main"}');
  });
  it('refuses an unknown reference, and a secret where it is not allowed', () => {
    expect(() => render('{{params.nope}}', scope(), { context: 'text' })).toThrow(TemplateError);
    expect(() => render('{{secrets.pw}}', scope(), { context: 'text' })).toThrow(/secret_not_allowed/);
    const r = render('p={{secrets.pw}}', scope(), { context: 'text', allowSecrets: true });
    expect(r).toEqual({ text: 'p=s3cr3t-value', usedSecrets: ['s3cr3t-value'] });
  });
});

/**
 * The quoting is proved with a REAL shell, not by reading the string: every hostile value must arrive at the program as ONE
 * argument, byte for byte, and must never run anything.
 */
describe('shell quoting, run through /bin/sh', () => {
  const HOSTILE = [
    "plain", "with space", "semi;colon", "$(touch PWNED)", "`touch PWNED`", "a && touch PWNED", "a | touch PWNED", "a > PWNED", "$HOME", "${IFS}x",
    "it's", "''", "'\"'\"'", "new\nline", "tab\there", "../../etc/passwd", "--option=x", "-rf", "*", "~", "!history", "\\", "\\'; touch PWNED; '", "é ü 日本語", "", " ",
  ];
  it.each(HOSTILE.map((v) => [JSON.stringify(v), v]))('%s arrives intact as one argument and runs nothing', (_label, value) => {
    const dir = mkdtempSync(join(tmpdir(), 'orbyte-quote-'));
    const script = `printf '%s' ${render('{{params.v}}', scope({ params: { v: value } }), { context: 'shell' }).text} > out.txt; printf '%s' ${shellQuote(value)} > out2.txt; set -- ${shellQuote(value)}; printf '%s' "$#" > argc.txt`;
    execFileSync('/bin/sh', ['-c', script], { cwd: dir });
    expect(readdirSync(dir).sort()).toEqual(['argc.txt', 'out.txt', 'out2.txt']); // nothing else was created: no PWNED
    const read = (f: string) => execFileSync('cat', [join(dir, f)]).toString('utf8');
    expect(read('out.txt')).toBe(value);
    expect(read('argc.txt')).toBe('1');
  });
  it('refuses a NUL byte, which no command line can carry', () => {
    expect(() => shellQuote('a\0b')).toThrow(TemplateError);
  });
});
