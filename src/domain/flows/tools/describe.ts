import type { z } from 'zod';
import type { ToolDef } from './types';

/**
 * What the editor needs to draw the settings form of a tool, read from the SAME Zod schema the server checks with, so a
 * form and its validation cannot drift apart. Zod 4 keeps its structure in `def`; anything not understood falls back to text.
 */
export interface FieldSpec {
  key: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  options?: string[];
  optional: boolean;
  default?: string | number | boolean;
  multiline: boolean;
  /** May hold `{{secrets.x}}` (the tool says so). */
  secret: boolean;
}

type Def = { type?: string; innerType?: unknown; entries?: Record<string, string>; defaultValue?: unknown; in?: unknown; out?: unknown };
const defOf = (s: unknown): Def => ((s as { def?: Def; _def?: Def })?.def ?? (s as { _def?: Def })?._def ?? {}) as Def;

function unwrap(schema: unknown): { base: unknown; optional: boolean; default?: unknown } {
  let cur = schema;
  let optional = false;
  let dflt: unknown;
  for (let i = 0; i < 6; i++) {
    const d = defOf(cur);
    if (d.type === 'optional' || d.type === 'nullable') {
      optional = true;
      cur = d.innerType;
    } else if (d.type === 'default') {
      optional = true;
      dflt = typeof d.defaultValue === 'function' ? (d.defaultValue as () => unknown)() : d.defaultValue;
      cur = d.innerType;
    } else if (d.type === 'pipe') {
      cur = d.in; // `z.coerce.number()` and friends
    } else break;
  }
  return { base: cur, optional, default: dflt };
}

const MULTILINE = new Set(['content', 'entries', 'script']);

export function describeFields(tool: ToolDef): FieldSpec[] {
  const shape = (tool.schema as unknown as { shape?: Record<string, z.ZodType> }).shape ?? {};
  return Object.entries(shape).map(([key, field]) => {
    const { base, optional, default: dflt } = unwrap(field);
    const d = defOf(base);
    const type: FieldSpec['type'] = d.type === 'enum' ? 'select' : d.type === 'number' ? 'number' : d.type === 'boolean' ? 'boolean' : 'text';
    const scalarDefault = typeof dflt === 'string' || typeof dflt === 'number' || typeof dflt === 'boolean' ? dflt : undefined;
    return { key, type, ...(d.type === 'enum' && d.entries ? { options: Object.values(d.entries) } : {}), optional, ...(scalarDefault !== undefined ? { default: scalarDefault } : {}), multiline: MULTILINE.has(key), secret: (tool.secretKeys ?? []).includes(key) };
  });
}
