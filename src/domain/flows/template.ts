/**
 * Variables in a flow (BRD-M17 section 13, D-061). A string in a node's configuration may contain `{{ref}}`:
 *   `{{params.slug}}`          a parameter of the run
 *   `{{nodes.<id>.<output>}}`  an output of an earlier node
 *   `{{product.repo}}`         a default from the product profile
 *   `{{secrets.<name>}}`       a secret the run generated (only where a tool allows it)
 * A value is put into the text according to its CONTEXT, never as raw text unless the author asked for text:
 *   `shell`  becomes ONE single-quoted literal, so it cannot end the quote or start another command (BR-M17-18)
 *   `text`   inserted as is (file contents, URLs the tool validates afterwards)
 *   `json`   a JSON literal
 */
export type Context = 'shell' | 'text' | 'json';
export type Scalar = string | number | boolean;

export interface Scope {
  params: Record<string, Scalar>;
  nodes: Record<string, Record<string, Scalar>>;
  product: Record<string, Scalar>;
  secrets: Record<string, string>;
}

export class TemplateError extends Error {
  constructor(
    public readonly code: 'unknown_ref' | 'secret_not_allowed' | 'bad_value',
    public readonly ref: string,
  ) {
    super(`${code}: ${ref}`);
    this.name = 'TemplateError';
  }
}

const REF = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;

/** Every reference a template contains, in order, without duplicates. */
export function referencesOf(template: string): string[] {
  return [...new Set([...template.matchAll(REF)].map((m) => m[1]))];
}

/** One single-quoted shell literal: `'` becomes `'\''`. A NUL byte cannot be passed in a command line at all, so it is refused. */
export function shellQuote(value: string): string {
  if (value.includes('\0')) throw new TemplateError('bad_value', 'NUL byte');
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Own properties only, and only plain values: `params.__proto__` or `nodes.x.constructor` must never reach JavaScript internals. */
const own = (o: Record<string, unknown> | undefined, key: string): unknown => (o && Object.hasOwn(o, key) ? o[key] : undefined);
const scalar = (v: unknown): Scalar | undefined => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : undefined);

export function lookup(scope: Scope, ref: string): Scalar | undefined {
  const [root, ...rest] = ref.split('.');
  if (root === 'params') return rest.length === 1 ? scalar(own(scope.params, rest[0])) : undefined;
  if (root === 'product') return rest.length === 1 ? scalar(own(scope.product, rest[0])) : undefined;
  if (root === 'secrets') return rest.length === 1 ? scalar(own(scope.secrets, rest[0])) : undefined;
  if (root === 'nodes') return rest.length === 2 ? scalar(own(own(scope.nodes, rest[0]) as Record<string, unknown> | undefined, rest[1])) : undefined;
  return undefined;
}

export interface Rendered {
  text: string;
  /** The secret values that went into the text, so the caller can scrub them from any output (BR-M17-03). */
  usedSecrets: string[];
}

export function render(template: string, scope: Scope, options: { context: Context; allowSecrets?: boolean }): Rendered {
  const usedSecrets: string[] = [];
  const text = template.replace(REF, (_m, ref: string) => {
    const isSecret = ref.startsWith('secrets.');
    if (isSecret && !options.allowSecrets) throw new TemplateError('secret_not_allowed', ref);
    const value = lookup(scope, ref);
    if (value === undefined) throw new TemplateError('unknown_ref', ref);
    const asText = String(value);
    if (isSecret) usedSecrets.push(asText);
    if (options.context === 'shell') return shellQuote(asText);
    if (options.context === 'json') return JSON.stringify(value);
    return asText;
  });
  return { text, usedSecrets };
}
