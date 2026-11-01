import { Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, Panel as CanvasPanel, Position, ReactFlow, type Edge, type EdgeProps, type EdgeTypes, type Node, type NodeProps, type NodeTypes, type OnConnect, type OnEdgesChange, type OnNodesChange, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Definition } from '../../domain/flows/definition';
import { isLegacyGrid, layoutSteps, NODE_HEIGHT, NODE_WIDTH, runsLeft } from '../../domain/flows/layout';
import type { MessageKey } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';
import type { IconName } from '../../lib/nav';

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
  /** The step sits in a row that runs right to left: its line comes in on the right and goes out on the left. */
  reverse?: boolean;
  /** Set on the last step of a branch: the "+" at its right edge adds a step after it. */
  onAdd?: () => void;
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

/** What kind of tool a step is, for its colour and icon: the connection it uses, or Orbyte's own tools. */
export type ToolGroup = 'ssh' | 'aapanel' | 'github' | 'orbyte';
export const toolGroup = (tool: string): ToolGroup => (tool.startsWith('ssh.') ? 'ssh' : tool.startsWith('panel.') ? 'aapanel' : tool.startsWith('github.') ? 'github' : 'orbyte');
export const GROUP_ICON: Record<ToolGroup, IconName> = { ssh: 'terminal', aapanel: 'panel', github: 'github', orbyte: 'pulse' };
export const GROUP_TILE: Record<ToolGroup, string> = { ssh: 'bg-accent-wash text-accent', aapanel: 'bg-mint-wash text-mint-ink', github: 'bg-paper-3 text-ink', orbyte: 'bg-paper-3 text-warm-ink' };

function ToolNodeView({ data, selected }: NodeProps<ToolNode>) {
  const t = useT();
  const status = data.status;
  const group = toolGroup(data.tool);
  return (
    <div style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }} className={cx('relative flex items-center gap-3 rounded-card border bg-paper p-3 text-left shadow-card transition-shadow hover:shadow-md', status ? STATUS_STYLE[status] : selected ? 'border-accent ring-2 ring-accent-wash' : data.problem ? 'border-danger' : 'border-rule-2')}>
      <Handle type="target" position={data.reverse ? Position.Right : Position.Left} className="!size-3 !border-2 !border-rule-2 !bg-paper" />
      <span aria-hidden="true" className={cx('grid size-10 shrink-0 place-items-center rounded-input', GROUP_TILE[group])}><Icon name={GROUP_ICON[group]} className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-medium leading-snug text-ink">{data.label || t(toolLabelKey(data.tool))}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          {data.tier === 'change' && <span className="shrink-0 rounded-full border border-warm px-1.5 text-[10px] leading-4 text-warm-ink">{t('flowTierChange')}</span>}
          <span className="truncate font-mono text-[11px]">{data.tool.split('.').pop()}{!data.available ? ` · ${t('flowToolSoon')}` : ''}</span>
        </div>
      </div>
      {status && <span aria-hidden="true" className={cx('absolute right-2 top-2 size-2.5 rounded-full', STATUS_DOT[status])} />}
      {status && <div className="sr-only">{t(`flowStatus_${status}` as MessageKey)}</div>}
      <Handle type="source" position={data.reverse ? Position.Left : Position.Right} className="!size-3 !border-2 !border-rule-2 !bg-paper" />
      {data.onAdd && (
        <button type="button" onClick={(e) => { e.stopPropagation(); data.onAdd?.(); }} aria-label={t('flowAddStep')} title={t('flowAddStep')} className={cx('nodrag nopan absolute top-1/2 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-rule-2 bg-paper p-0 text-muted shadow-card hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', data.reverse ? '-left-11' : '-right-11')}>
          <Icon name="plus" className="size-4" />
        </button>
      )}
    </div>
  );
}

/** A line between two steps; in the editor it carries a "+" that inserts a step right there. */
function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps<Edge<{ onInsert?: (edgeId: string) => void }>>) {
  const t = useT();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {data?.onInsert && (
        <EdgeLabelRenderer>
          <button type="button" onClick={() => data.onInsert?.(id)} aria-label={t('flowInsertStep')} title={t('flowInsertStep')} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }} className="nodrag nopan absolute grid size-6 cursor-pointer place-items-center rounded-full border border-rule-2 bg-paper p-0 text-muted opacity-70 shadow-card hover:border-accent hover:text-accent hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <Icon name="plus" className="size-3.5" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes: NodeTypes = { tool: ToolNodeView };
const edgeTypes: EdgeTypes = { insert: InsertEdge };

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
  onPaneClick?: () => void;
  label: string;
  /** Size of the frame; the default suits a page, the editor passes its own to fill the screen. */
  className?: string;
  /** Buttons on the canvas itself, top right (add a step, tidy, full screen). */
  toolbar?: ReactNode;
  /** Drawn over the right edge of the canvas (the settings of the chosen step). */
  overlay?: ReactNode;
  /** A step to bring into view and keep in view as it changes (the run view follows the step that is running or failed). */
  focusNode?: string | null;
}

/** The first look at a flow: its beginning at a size that can be read, never the whole of a long flow squeezed into the frame. */
function showStart(rf: ReactFlowInstance<ToolNode>, frame: HTMLElement | null) {
  const nodes = rf.getNodes();
  if (!nodes.length || !frame) return;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const maxX = Math.max(...nodes.map((n) => n.position.x + NODE_WIDTH));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const maxY = Math.max(...nodes.map((n) => n.position.y + NODE_HEIGHT));
  const width = frame.clientWidth;
  const height = frame.clientHeight;
  const fits = Math.min(width / (maxX - minX + 160), height / (maxY - minY + 160));
  const zoom = Math.min(1, Math.max(0.85, fits));
  const x = fits >= zoom ? (width - (maxX - minX) * zoom) / 2 - minX * zoom : 56 - minX * zoom;
  const y = (height - (maxY - minY) * zoom) / 2 - minY * zoom;
  void rf.setViewport({ x, y, zoom });
}

export function FlowCanvas({ nodes, edges, readOnly, onNodesChange, onEdgesChange, onConnect, isValidConnection, onNodeClick, onPaneClick, label, className, toolbar, overlay, focusNode }: CanvasProps) {
  const colorMode = useColorMode();
  const frame = useRef<HTMLDivElement>(null);
  const instance = useRef<ReactFlowInstance<ToolNode> | null>(null);
  // Only when the step to follow changes, not on every refresh of its status, so the person can still look around.
  useEffect(() => {
    const rf = instance.current;
    const node = focusNode ? rf?.getNode(focusNode) : null;
    if (rf && node) void rf.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, { zoom: Math.max(0.85, Math.min(1, rf.getZoom())), duration: 400 });
  }, [focusNode]);
  return (
    <div ref={frame} data-flow-frame="" role="group" aria-label={label} className={cx('relative w-full overflow-hidden rounded-card border border-rule bg-paper-2', className ?? 'h-[62vh] min-h-[420px]')}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={colorMode}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection ? (c) => isValidConnection({ source: c.source, target: c.target }) : undefined}
        onNodeClick={onNodeClick ? (_e, n) => onNodeClick(n.id) : undefined}
        onPaneClick={onPaneClick}
        onInit={(rf) => {
          instance.current = rf;
          showStart(rf, frame.current);
          const node = focusNode ? rf.getNode(focusNode) : null;
          if (node) void rf.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, { zoom: 0.9 });
        }}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesReconnectable={!readOnly}
        elementsSelectable
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        panOnScroll
        zoomOnScroll={false}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'default' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
        {toolbar && <CanvasPanel position="top-right" className="flex flex-wrap items-center justify-end gap-2">{toolbar}</CanvasPanel>}
      </ReactFlow>
      {overlay}
    </div>
  );
}

// ------------------------------------------------------------------ definition <-> canvas

/** Marks the steps that sit in a row running right to left, so their line comes in and goes out on the right sides. */
export function markDirections(nodes: ToolNode[], edges: Array<{ source: string; target: string }>): ToolNode[] {
  const at = new Map(nodes.map((n) => [n.id, n.position]));
  const lines = edges.map((e) => ({ from: e.source, to: e.target }));
  return nodes.map((n) => {
    const reverse = runsLeft(n.id, at, lines);
    return n.data.reverse === reverse ? n : { ...n, data: { ...n.data, reverse } };
  });
}

export function toCanvas(def: Definition, catalog: Catalog, statuses?: Record<string, NodeStatus>): { nodes: ToolNode[]; edges: Edge[] } {
  const byId = new Map(catalog.tools.map((t) => [t.id, t]));
  // A flow drawn in the old four-column grid is redrawn left to right on opening; nothing is saved until the person saves.
  const tidy = isLegacyGrid(def.nodes, def.edges) ? layoutSteps(def.nodes.map((n) => n.id), def.edges) : null;
  const nodes = def.nodes.map((n) => ({
      id: n.id,
      type: 'tool' as const,
      position: tidy?.get(n.id) ?? n.position,
      data: { tool: n.tool, label: n.label ?? '', bind: n.bind as Record<string, string>, config: n.config as Record<string, string | number | boolean>, tier: byId.get(n.tool)?.tier ?? 'read', available: byId.get(n.tool)?.available ?? false, status: statuses?.[n.id] },
    }));
  const edges = def.edges.map((e) => ({ id: `${e.from}->${e.to}`, source: e.from, target: e.to, animated: statuses?.[e.to] === 'running' }));
  return { nodes: markDirections(nodes, edges), edges };
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
