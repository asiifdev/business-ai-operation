import { describe, expect, it } from 'vitest';
import { hasCommandNode, validateDefinition } from '../definition';
import { TEMPLATES } from '../templates';

describe('built-in templates', () => {
  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s is a valid flow, for an Admin too, without a free command', (_k, t) => {
    const def = t.build();
    const r = validateDefinition(def, { canUseCommand: false });
    expect(r.problems).toEqual([]);
    expect(r.order).toHaveLength(def.nodes.length);
    expect(hasCommandNode(def)).toBe(false);
  });
});
