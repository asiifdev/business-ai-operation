import { Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes, type OnConnect, type OnEdgesChange, type OnNodesChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useState } from 'react';
import type { Definition } from '../../domain/flows/definition';
import type { MessageKey } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';

/** The editor and the run view draw the same diagram: a node is a tool of the catalogue, a line is an order and a data dependency. */
export interface CatalogField {
  key: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  options?: string[];
  optional: boolean;
  default?: string | number | boolean;
  multiline: boolean;
  secret: boolean;
}
export interface CatalogTool {
  id: string;
  needs: Array<'github' | 'ssh' | 'aapanel'>;
  tier: 'read' | 'change';
  available: boolean;
  ownerOnly: boolean;
  allowed: boolean;
  outputs: string[];
  fields: CatalogField[];
  secretKeys: string[];
  producesSecretFrom: string | null;
  creates: 'database' | 'proxy' | null;
  deletes: { kind: 'database' | 'proxy'; key: string } | null;
}
export interface Catalog {
  tools: CatalogTool[];
  productFields: string[];
}

export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface ToolNodeData extends Record<string, unknown> {
  tool: string;
  label: string;
  bind: Record<string, string>;
  config: Record<string, string | number | boolean>;
  tier: 'read' | 'change';
  available: boolean;
  status?: NodeStatus;
  problem?: boolean;
}
export type ToolNode = Node<ToolNodeData, 'tool'>;

export const toolLabelKey = (id: string) => `tool_${id.replace('.', '_')}` as MessageKey;

const STATUS_STYLE: Record<NodeStatus, string> = {
  pending: 'border-rule-2',
  running: 'border-accent ring-2 ring-accent-wash',
  done: 'border-success',
  failed: 'border-danger ring-2 ring-danger-wash',
  skipped: 'border-rule-2 opacity-60',
};
const STATUS_DOT: Record<NodeStatus, string> = { pending: 'bg-rule-2', running: 'bg-accent animate-pulse', done: 'bg-success', failed: 'bg-danger', skipped: 'bg-rule-2' };

function ToolNodeView({ data, selected }: NodeProps<ToolNode>) {
  const t = useT();
  const status = data.status;
  return (
    <div className={cx('w-56 rounded-input border bg-paper px-3 py-2 text-left shadow-card', status ? STATUS_STYLE[status] : selected ? 'border-accent ring-2 ring-accent-wash' : data.problem ? 'border-danger' : 'border-rule-2')}>
      <Handle type="target" position={Position.Left} className="!size-2.5 !border-rule-2 !bg-paper-3" />
      <div className="flex items-center gap-2">
        {status && <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-full', STATUS_DOT[status])} />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{data.label || t(toolLabelKey(data.tool))}</span>
        {data.tier === 'change' && <span className="shrink-0 rounded-full border border-warm px-1.5 text-[10px] text-warm-ink">{t('flowTierChange')}</span>}
      </div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{data.tool}{!data.available ? ` · ${t('flowToolSoon')}` : ''}</div>
      {status && <div className="sr-only">{t(`flowStatus_${status}` as MessageKey)}</div>}
      <Handle type="source" position={Position.Right} className="!size-2.5 !border-rule-2 !bg-paper-3" />
    </div>
  );
}

const nodeTypes: NodeTypes = { tool: ToolNodeView };

/** `light` or `dark`, following the app's own switch (`html[data-theme]`) and, without one, the system. */
export function useColorMode(): 'light' | 'dark' {
  const read = () => {
    const d = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
    if (d === 'dark' || d === 'light') return d;
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [mode, setMode] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setMode(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

export interface CanvasProps {
  nodes: ToolNode[];
  edges: Edge[];
  readOnly?: boolean;
  onNodesChange?: OnNodesChange<ToolNode>;
  onEdgesChange?: OnEdgesChange;
  onConnect?: OnConnect;
  isValidConnection?: (c: { source: string; target: string }) => boolean;
  onNodeClick?: (id: string) => void;
  label: string;
}

export function FlowCanvas({ nodes, edges, readOnly, onNodesChange, onEdgesChange, onConnect, isValidConnection, onNodeClick, label }: CanvasProps) {
  const colorMode = useColorMode();
  return (
    <div role="group" aria-label={label} className="h-[62vh] min-h-[420px] w-full overflow-hidden rounded-card border border-rule bg-paper-2">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={colorMode}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection ? (c) => isValidConnection({ source: c.source, target: c.target }) : undefined}
        onNodeClick={onNodeClick ? (_e, n) => onNodeClick(n.id) : undefined}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesReconnectable={!readOnly}
        elementsSelectable
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!hidden sm:!block" />
      </ReactFlow>
    </div>
  );
}

// ------------------------------------------------------------------ definition <-> canvas

export function toCanvas(def: Definition, catalog: Catalog, statuses?: Record<string, NodeStatus>): { nodes: ToolNode[]; edges: Edge[] } {
  const byId = new Map(catalog.tools.map((t) => [t.id, t]));
  return {
    nodes: def.nodes.map((n) => ({
      id: n.id,
      type: 'tool' as const,
      position: n.position,
      data: { tool: n.tool, label: n.label ?? '', bind: n.bind as Record<string, string>, config: n.config as Record<string, string | number | boolean>, tier: byId.get(n.tool)?.tier ?? 'read', available: byId.get(n.tool)?.available ?? false, status: statuses?.[n.id] },
    })),
    edges: def.edges.map((e) => ({ id: `${e.from}->${e.to}`, source: e.from, target: e.to, animated: statuses?.[e.to] === 'running' })),
  };
}

export function fromCanvas(nodes: ToolNode[], edges: Edge[], slots: Definition['slots'], params: Definition['params']): Definition {
  return {
    slots,
    params,
    nodes: nodes.map((n) => ({ id: n.id, tool: n.data.tool, ...(n.data.label ? { label: n.data.label } : {}), position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, bind: n.data.bind as Definition['nodes'][number]['bind'], config: n.data.config })),
    edges: edges.map((e) => ({ from: e.source, to: e.target })),
  };
}

/** Whether a line from `from` to `to` would close a loop: `to` already leads back to `from`. */
export function wouldCycle(edges: Array<{ source: string; target: string }>, from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  return false;
}

/** A name for a new node of `tool`: the tool's own short name, numbered when it is taken (ids are `[a-z][a-z0-9_]*`). */
export function newNodeId(existing: Iterable<string>, tool: string): string {
  const taken = new Set(existing);
  const base = (tool.split('.').pop() ?? 'node').replace(/[^a-z0-9_]/g, '_').slice(0, 30);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now() % 100000}`;
}

/** The variables a node may use: parameters, product defaults, outputs of the nodes before it, and the secrets they make. */
export function availableRefs(def: Definition, nodeId: string, catalog: Catalog): Array<{ ref: string; group: 'params' | 'product' | 'nodes' | 'secrets' }> {
  const byId = new Map(catalog.tools.map((t) => [t.id, t]));
  const parents = new Map<string, string[]>();
  for (const e of def.edges) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  const before = new Set<string>();
  const stack = [...(parents.get(nodeId) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (before.has(cur)) continue;
    before.add(cur);
    stack.push(...(parents.get(cur) ?? []));
  }
  const out: Array<{ ref: string; group: 'params' | 'product' | 'nodes' | 'secrets' }> = [];
  for (const p of def.params) out.push({ ref: `params.${p.name}`, group: 'params' });
  for (const f of catalog.productFields) out.push({ ref: `product.${f}`, group: 'product' });
  for (const n of def.nodes) {
    if (!before.has(n.id)) continue;
    const tool = byId.get(n.tool);
    for (const o of tool?.outputs ?? []) out.push({ ref: `nodes.${n.id}.${o}`, group: 'nodes' });
    if (tool?.producesSecretFrom && typeof n.config[tool.producesSecretFrom] === 'string') out.push({ ref: `secrets.${n.config[tool.producesSecretFrom]}`, group: 'secrets' });
  }
  return out;
}
