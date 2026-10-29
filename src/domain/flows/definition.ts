import { createHash } from 'node:crypto';
import { z } from 'zod';
import { referencesOf } from './template';
import { getTool } from './tools';
import type { ConnectionKind } from './tools';

/**
 * The definition of a flow (BRD-M17 section 13): the diagram as data. It is validated here, on the server, when it is saved
 * and again when a run is planned: the editor is only a way to write it (BR-M17-22).
 */
const id = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const kind = z.enum(['github', 'ssh', 'aapanel']);
const scalar = z.union([z.string().max(20_000), z.number(), z.boolean()]);

export const definitionSchema = z.object({
  slots: z.array(z.object({ name: id, kind, label: z.string().max(60).optional() })).max(8).default([]),
  params: z
    .array(
      z.object({
        name: id,
        label: z.string().max(60).optional(),
        type: z.enum(['string', 'number', 'boolean']).default('string'),
        required: z.boolean().default(true),
        default: scalar.optional(),
        /** What the value must look like, checked when a run is planned. */
        pattern: z.enum(['slug', 'domain', 'branch', 'repo', 'path', 'identifier', 'free']).default('free'),
      }),
    )
    .max(30)
    .default([]),
  nodes: z
    .array(
      z.object({
        id,
        tool: z.string().max(60),
        label: z.string().max(80).optional(),
        position: z.object({ x: z.number().min(-100_000).max(100_000), y: z.number().min(-100_000).max(100_000) }).default({ x: 0, y: 0 }),
        /** Connection kind to slot name, for the kinds the tool needs. */
        bind: z.partialRecord(kind, id).default({}),
        config: z.record(z.string().max(60), scalar).default({}),
      }),
    )
    .max(60),
  edges: z.array(z.object({ from: id, to: id })).max(300).default([]),
});
export type Definition = z.infer<typeof definitionSchema>;
export type FlowNode = Definition['nodes'][number];

/** The fields of the product profile a flow may read as `{{product.<field>}}`. */
export const PRODUCT_FIELDS = ['name', 'repo', 'default_branch', 'folder_pattern', 'port_range_start', 'port_range_end'] as const;

export interface Problem {
  code:
    | 'duplicate_node' | 'duplicate_slot' | 'duplicate_param' | 'unknown_tool' | 'tool_unavailable' | 'command_not_allowed' | 'slot_missing' | 'slot_unknown' | 'slot_kind'
    | 'edge_unknown' | 'edge_self' | 'cycle' | 'ref_unknown' | 'secret_not_allowed' | 'delete_target' | 'config_unknown_key';
  node?: string;
  detail?: string;
}

/** Kahn's algorithm; ties keep the order the nodes are listed in, so the same diagram always runs in the same order. */
export function topologicalOrder(def: Pick<Definition, 'nodes' | 'edges'>): string[] | null {
  const ids = def.nodes.map((n) => n.id);
  const indeg = new Map(ids.map((i) => [i, 0]));
  const next = new Map(ids.map((i) => [i, [] as string[]]));
  for (const e of def.edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to) || e.from === e.to) continue;
    indeg.set(e.to, indeg.get(e.to)! + 1);
    next.get(e.from)!.push(e.to);
  }
  const order: string[] = [];
  const ready = ids.filter((i) => indeg.get(i) === 0);
  while (ready.length) {
    const cur = ready.shift()!;
    order.push(cur);
    for (const n of next.get(cur)!) {
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) {
        ready.push(n);
        ready.sort((x, y) => ids.indexOf(x) - ids.indexOf(y));
      }
    }
  }
  return order.length === ids.length ? order : null;
}

function ancestorsOf(def: Pick<Definition, 'edges'>, node: string): Set<string> {
  const parents = new Map<string, string[]>();
  for (const e of def.edges) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  const seen = new Set<string>();
  const stack = [...(parents.get(node) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(parents.get(cur) ?? []));
  }
  return seen;
}

export function validateDefinition(def: Definition, options: { canUseCommand: boolean }): { problems: Problem[]; order: string[] | null } {
  const problems: Problem[] = [];
  const add = (p: Problem) => problems.push(p);
  const seen = <T>(items: T[], key: (t: T) => string, code: Problem['code']) => {
    const s = new Set<string>();
    for (const i of items) {
      if (s.has(key(i))) add({ code, detail: key(i) });
      s.add(key(i));
    }
  };
  seen(def.nodes, (n) => n.id, 'duplicate_node');
  seen(def.slots, (s) => s.name, 'duplicate_slot');
  seen(def.params, (p) => p.name, 'duplicate_param');

  const nodeIds = new Set(def.nodes.map((n) => n.id));
  for (const e of def.edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) add({ code: 'edge_unknown', detail: `${e.from} -> ${e.to}` });
    else if (e.from === e.to) add({ code: 'edge_self', node: e.from });
  }
  const order = topologicalOrder(def);
  if (!order) add({ code: 'cycle' });

  const slotKind = new Map(def.slots.map((s) => [s.name, s.kind as ConnectionKind]));
  const paramNames = new Set(def.params.map((p) => p.name));
  const byId = new Map(def.nodes.map((n) => [n.id, n]));

  for (const node of def.nodes) {
    const tool = getTool(node.tool);
    if (!tool) {
      add({ code: 'unknown_tool', node: node.id, detail: node.tool });
      continue;
    }
    if (!tool.available) add({ code: 'tool_unavailable', node: node.id, detail: tool.id });
    if (tool.ownerOnly && !options.canUseCommand) add({ code: 'command_not_allowed', node: node.id, detail: tool.id });
    for (const need of tool.needs) {
      const slot = node.bind[need];
      if (!slot) add({ code: 'slot_missing', node: node.id, detail: need });
      else if (!slotKind.has(slot)) add({ code: 'slot_unknown', node: node.id, detail: slot });
      else if (slotKind.get(slot) !== need) add({ code: 'slot_kind', node: node.id, detail: `${slot} is ${slotKind.get(slot)}, the tool needs ${need}` });
    }
    const before = ancestorsOf(def, node.id);
    for (const [key, value] of Object.entries(node.config)) {
      if (typeof value !== 'string') continue;
      for (const ref of referencesOf(value)) {
        const [root, a, b] = ref.split('.');
        let ok = false;
        if (root === 'params') ok = ref.split('.').length === 2 && paramNames.has(a);
        else if (root === 'product') ok = ref.split('.').length === 2 && (PRODUCT_FIELDS as readonly string[]).includes(a);
        else if (root === 'nodes') {
          const src = byId.get(a);
          const srcTool = src && getTool(src.tool);
          ok = ref.split('.').length === 3 && Boolean(src && srcTool && before.has(a) && srcTool.outputs.includes(b));
        } else if (root === 'secrets') {
          if (!(tool.secretKeys ?? []).includes(key)) {
            add({ code: 'secret_not_allowed', node: node.id, detail: `${key}: ${ref}` });
            continue;
          }
          ok = ref.split('.').length === 2 && [...before].some((id) => {
            const s = byId.get(id);
            const st = s && getTool(s.tool);
            return st?.producesSecretFrom && s!.config[st.producesSecretFrom] === a;
          });
        }
        if (!ok) add({ code: 'ref_unknown', node: node.id, detail: ref });
      }
    }
    if (tool.deletes) {
      const target = String(node.config[tool.deletes.key] ?? '');
      const src = byId.get(target);
      const srcTool = src && getTool(src.tool);
      if (!src || srcTool?.creates !== tool.deletes.kind || !before.has(target)) add({ code: 'delete_target', node: node.id, detail: `${tool.deletes.key} must name an earlier node that creates a ${tool.deletes.kind}` });
    }
  }
  return { problems, order };
}

/** True when a node needs the Owner (BR-M17-18): it decides who may save the version. */
export const hasCommandNode = (def: Definition): boolean => def.nodes.some((n) => getTool(n.tool)?.ownerOnly);

/** The hash a person approves: what runs is exactly this diagram, these parameters, these connections (BR-M17-21). */
export function planHash(def: Definition, order: string[], params: Record<string, unknown>, bindings: Record<string, string>): string {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
  const nodes = order.map((idd) => def.nodes.find((n) => n.id === idd)!).map((n) => ({ id: n.id, tool: n.tool, bind: n.bind, config: n.config }));
  return createHash('sha256').update(JSON.stringify(canon({ nodes, params, bindings }))).digest('hex');
}
