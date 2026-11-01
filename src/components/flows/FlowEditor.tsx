import { addEdge, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type Connection, type Edge } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Definition, Problem } from '../../domain/flows/definition';
import { columnsPerRow, layoutSteps } from '../../domain/flows/layout';
import { cx } from '../../lib/cx';
import { api, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import { useLoad } from '../../lib/use-load';
import { fieldText, optionLabel } from '../../lib/flow-labels';
import { useLocale, useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Toggle } from '../forms/Toggle';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Modal } from '../ui/Modal';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import { availableRefs, FlowCanvas, fromCanvas, GROUP_ICON, GROUP_TILE, markDirections, newNodeId, toCanvas, toolGroup, toolLabelKey, wouldCycle, type Catalog, type CatalogField, type CatalogTool, type ToolNode } from './shared';

interface FlowDto {
  flow: { id: string; name: string; kind: 'setup' | 'update'; description: string | null; currentVersion: number };
  definition: Definition;
  hasCommandNode: boolean;
  aiAssisted: boolean;
  version: number;
  versions: Array<{ version: number; createdAt: string; hasCommandNode: boolean }>;
}
interface ValidationDto {
  ok: boolean;
  problems: Problem[];
  order: string[] | null;
}

const KINDS = ['github', 'ssh', 'aapanel'] as const;
const GROUPS = ['ssh', 'aapanel', 'github', 'orbyte'] as const;
const GROUP_LABEL = { ssh: 'flowGroupSsh', aapanel: 'flowGroupAapanel', github: 'flowGroupGithub', orbyte: 'flowGroupOrbyte' } as const satisfies Record<(typeof GROUPS)[number], MessageKey>;
const SLOT_DEFAULT = { ssh: 'server', aapanel: 'panel', github: 'github' } as const;
const PATTERNS = ['free', 'slug', 'domain', 'branch', 'repo', 'path', 'identifier'] as const;
const PATTERN_LABEL = { free: 'flowPatternFree', slug: 'flowPatternSlug', domain: 'flowPatternDomain', branch: 'flowPatternBranch', repo: 'flowPatternRepo', path: 'flowPatternPath', identifier: 'flowPatternIdentifier' } as const satisfies Record<(typeof PATTERNS)[number], MessageKey>;

/** Draws and edits a deploy flow (BRD-M17 section 13). The server checks every save again: this screen only helps write a definition. */
export function FlowEditor({ id, canWrite, canCommand }: { id: string; canWrite: boolean; canCommand: boolean }) {
  const t = useT();
  const [version, setVersion] = useState<number | null>(null);
  const flow = useLoad(() => api<FlowDto>('GET', `/api/flows/${id}${version ? `?version=${version}` : ''}`), [id, version]);
  const catalog = useLoad(() => api<Catalog>('GET', '/api/flows/catalog'), []);
  if (flow.value.state === 'loading' || catalog.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={8} /></Panel>;
  if (flow.value.state === 'error') return <Panel><ErrorBox onRetry={flow.retry}>{t(errorKey(flow.value.error))}</ErrorBox></Panel>;
  if (catalog.value.state === 'error') return <Panel><ErrorBox onRetry={catalog.retry}>{t(errorKey(catalog.value.error))}</ErrorBox></Panel>;
  return (
    <ReactFlowProvider>
      <Editor key={`${id}:${flow.value.data.version}`} data={flow.value.data} catalog={catalog.value.data} canWrite={canWrite} canCommand={canCommand} onVersion={setVersion} onSaved={() => { setVersion(null); void flow.reload(); }} />
    </ReactFlowProvider>
  );
}

/** Where a new step goes: after a chosen step, on a line between two steps, or after the selected (else the last) step. */
type Where = { kind: 'after'; id: string } | { kind: 'edge'; id: string } | { kind: 'end' };

function Editor({ data, catalog, canWrite, canCommand, onVersion, onSaved }: { data: FlowDto; catalog: Catalog; canWrite: boolean; canCommand: boolean; onVersion: (v: number | null) => void; onSaved: () => void }) {
  const t = useT();
  const rf = useReactFlow();
  const initial = useMemo(() => toCanvas(data.definition, catalog), [data, catalog]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ToolNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [slots, setSlots] = useState(data.definition.slots);
  const [params, setParams] = useState(data.definition.params);
  const [name, setName] = useState(data.flow.name);
  const [description, setDescription] = useState(data.flow.description ?? '');
  const [problems, setProblems] = useState<Problem[]>([]);
  /** The panel over the right edge of the canvas: the chosen step, the flow's own settings, or closed. */
  const [drawer, setDrawer] = useState<'node' | 'flow' | null>(null);
  const [picker, setPicker] = useState<Where | null>(null);
  const pickerOpen = useRef(false);
  pickerOpen.current = picker !== null;
  const [full, setFull] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dirty, setDirty] = useState(false);
  const first = useRef(true);
  const locked = !canWrite || (data.hasCommandNode && !canCommand);
  const byId = useMemo(() => new Map(catalog.tools.map((x) => [x.id, x])), [catalog]);

  const definition = useMemo(() => fromCanvas(nodes, edges, slots, params), [nodes, edges, slots, params]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setDirty(true);
  }, [nodes.length, edges.length, slots, params, name, description, JSON.stringify(nodes.map((n) => [n.id, n.data, Math.round(n.position.x), Math.round(n.position.y)]))]);
  useEffect(() => {
    if (!dirty && !first.current) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Full screen: the browser's own full screen when it allows it, and in every case this page's frame fills the window.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pickerOpen.current && !document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  useEffect(() => {
    if (!full) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [full]);
  async function toggleFull() {
    if (full) {
      setFull(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      return;
    }
    setFull(true);
    await document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  // The server is the judge: ask it after each pause in editing.
  useEffect(() => {
    const timer = setTimeout(() => {
      api<ValidationDto>('POST', '/api/flows/validate', { definition })
        .then((r) => setProblems(r.problems))
        .catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [definition]);

  const problemNodes = useMemo(() => new Set(problems.flatMap((p) => (p.node ? [p.node] : []))), [problems]);
  const selected = nodes.find((n) => n.selected) ?? null;
  const selectNode = useCallback((nid: string) => {
    setNodes((all) => all.map((n) => ({ ...n, selected: n.id === nid })));
    setDrawer('node');
  }, [setNodes]);

  /** A step with nothing after it gets a "+" at its right edge; a line between two steps carries its own. */
  const shown = useMemo(() => {
    const hasNext = new Set(edges.map((e) => e.source));
    return markDirections(nodes, edges).map((n) => ({ ...n, data: { ...n.data, problem: problemNodes.has(n.id), onAdd: locked || hasNext.has(n.id) ? undefined : () => setPicker({ kind: 'after', id: n.id }) } }));
  }, [nodes, edges, problemNodes, locked]);
  const shownEdges = useMemo(() => edges.map((e) => ({ ...e, type: 'insert', data: { onInsert: locked ? undefined : (id: string) => setPicker({ kind: 'edge', id }) } })), [edges, locked]);

  const onConnect = useCallback((c: Connection) => setEdges((all) => addEdge({ ...c, type: 'insert' }, all)), [setEdges]);
  const isValidConnection = useCallback(({ source, target }: { source: string; target: string }) => !wouldCycle(edges, source, target) && !edges.some((e) => e.source === source && e.target === target), [edges]);

  /** Lays every step out again, left to right in the order they run. */
  function tidy(nextNodes: ToolNode[] = nodes, nextEdges: Edge[] = edges) {
    // The row is as wide as the canvas shows at a readable size, so the flow wraps instead of needing a long scroll.
    const width = document.querySelector<HTMLElement>('[data-flow-frame]')?.clientWidth ?? 1200;
    const at = layoutSteps(nextNodes.map((n) => n.id), nextEdges.map((e) => ({ from: e.source, to: e.target })), columnsPerRow(width));
    setNodes(nextNodes.map((n) => ({ ...n, position: at.get(n.id) ?? n.position })));
    window.setTimeout(() => void rf.fitView({ padding: 0.3, maxZoom: 1, minZoom: 0.85, duration: 300, nodes: [{ id: nextNodes[nextNodes.length - 1]?.id ?? '' }] }), 60);
  }

  function addTool(tool: CatalogTool, where: Where) {
    const nid = newNodeId(nodes.map((n) => n.id), tool.id);
    const config: Record<string, string | number | boolean> = {};
    for (const f of tool.fields) if (f.default !== undefined) config[f.key] = f.default;
    const nextSlots = [...slots];
    const bind: Record<string, string> = {};
    for (const need of tool.needs) {
      let slot = nextSlots.find((x) => x.kind === need);
      if (!slot) {
        slot = { name: SLOT_DEFAULT[need], kind: need };
        nextSlots.push(slot);
      }
      bind[need] = slot.name;
    }
    if (nextSlots.length !== slots.length) setSlots(nextSlots);

    const line = (from: string, to: string): Edge => ({ id: `${from}->${to}`, source: from, target: to, type: 'insert' });
    let nextEdges = edges;
    if (where.kind === 'edge') {
      // On a line A to B: A now leads to the new step and the new step leads to B.
      const cut = edges.find((e) => e.id === where.id);
      if (cut) nextEdges = [...edges.filter((e) => e.id !== cut.id), line(cut.source, nid), line(nid, cut.target)];
    } else {
      const from = where.kind === 'after' ? where.id : (selected ?? nodes[nodes.length - 1])?.id;
      if (from) {
        // After a step that already has steps behind it, the new one takes its place in the line: it goes in between.
        const behind = edges.filter((e) => e.source === from);
        nextEdges = [...edges.filter((e) => e.source !== from), line(from, nid), ...behind.map((e) => line(nid, e.target))];
      }
    }
    const node: ToolNode = { id: nid, type: 'tool', position: { x: 0, y: 0 }, selected: true, data: { tool: tool.id, label: '', bind, config, tier: tool.tier, available: tool.available } };
    const nextNodes = [...nodes.map((n) => ({ ...n, selected: false })), node];
    setEdges(nextEdges);
    tidy(nextNodes, nextEdges);
    setDrawer('node');
    setPicker(null);
  }

  const patchNode = (nid: string, patch: Partial<ToolNode['data']>) => setNodes((all) => all.map((n) => (n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)));
  const removeNode = (nid: string) => {
    // Removing a step in a line joins the step before it to the step after it, so the flow is not cut in two.
    const incoming = edges.filter((e) => e.target === nid);
    const outgoing = edges.filter((e) => e.source === nid);
    const bridge: Edge[] = incoming.flatMap((i) => outgoing.filter((o) => !edges.some((e) => e.source === i.source && e.target === o.target)).map((o) => ({ id: `${i.source}->${o.target}`, source: i.source, target: o.target, type: 'insert' })));
    const nextEdges = [...edges.filter((e) => e.source !== nid && e.target !== nid), ...bridge];
    const nextNodes = nodes.filter((n) => n.id !== nid);
    setEdges(nextEdges);
    tidy(nextNodes, nextEdges);
    setDrawer(null);
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api('PATCH', `/api/flows/${data.flow.id}`, { name, description, definition });
      setDirty(false);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const toolbar = (
    <>
      {!locked && <Button size="sm" variant="primary" onClick={() => setPicker({ kind: 'end' })}><Icon name="plus" className="size-4" />{t('flowAddStep')}</Button>}
      {!locked && nodes.length > 1 && <Button size="sm" onClick={() => tidy()} title={t('flowTidyHelp')}><Icon name="tidy" className="size-4" />{t('flowTidy')}</Button>}
      <Button size="sm" onClick={() => setDrawer(drawer === 'flow' ? null : 'flow')} aria-pressed={drawer === 'flow'}><Icon name="edit" className="size-4" />{t('flowSettingsOpen')}</Button>
      <Button size="sm" onClick={() => void toggleFull()} aria-pressed={full}><Icon name={full ? 'shrink' : 'expand'} className="size-4" />{full ? t('flowExitFullscreen') : t('flowFullscreen')}</Button>
    </>
  );

  const detail = drawer === 'flow' || (drawer === 'node' && selected) ? (
    <aside aria-label={drawer === 'flow' ? t('flowSettingsOpen') : t('flowInspector')} className="absolute inset-y-0 right-0 z-10 flex w-[min(26rem,100%)] flex-col gap-3 overflow-y-auto border-l border-rule bg-paper p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-base font-semibold text-ink">{drawer === 'flow' ? t('flowSettingsOpen') : (selected?.data.label || t(toolLabelKey(selected?.data.tool ?? '')))}</h2>
        <Button size="sm" onClick={() => setDrawer(null)} aria-label={t('flowCloseDetail')}><Icon name="close" className="size-4" /></Button>
      </div>
      {drawer === 'flow' ? (
        <FlowSettings name={name} description={description} slots={slots} params={params} locked={locked} onName={setName} onDescription={setDescription} onSlots={setSlots} onParams={setParams} />
      ) : selected ? (
        <NodeInspector node={selected} tool={byId.get(selected.data.tool)} slots={slots} refs={availableRefs(definition, selected.id, catalog)} locked={locked} onPatch={(p) => patchNode(selected.id, p)} onRemove={() => removeNode(selected.id)} onAddSlot={(x) => setSlots((all) => (all.some((y) => y.name === x.name) ? all : [...all, x]))} />
      ) : null}
    </aside>
  ) : null;

  return (
    <div className={cx('flex flex-col gap-3', full && 'fixed inset-0 z-40 h-dvh bg-paper p-3 sm:p-4')}>
      <header className="flex flex-col gap-2">
        {!full && <a href="/app/flow" className="w-fit text-sm text-accent no-underline hover:underline">{t('navFlows')}</a>}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 flex flex-wrap items-center gap-3 text-2xl font-semibold text-ink">
              {name}
              <Badge tone="neutral">{t(data.flow.kind === 'setup' ? 'flowKindSetup' : 'flowKindUpdate')}</Badge>
              <Badge tone="accent">{t('flowVersionN', { n: data.version })}</Badge>
              {data.hasCommandNode && <Badge tone="warn">{t('flowOwnerOnly')}</Badge>}
              {data.aiAssisted && <Badge tone="accent">{t('aiAssistedLabel')}</Badge>}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data.versions.length > 1 && (
              <div className="w-44">
                <SelectMenu value={String(data.version)} onChange={(v) => onVersion(Number(v) === data.flow.currentVersion ? null : Number(v))} searchable={false} options={data.versions.map((v) => ({ value: String(v.version), label: t('flowVersionN', { n: v.version }) }))} />
              </div>
            )}
            <a href={`/app/setup/baru?flowId=${data.flow.id}`} className={buttonClasses('secondary', 'sm')}><Icon name="send" className="size-4" />{t('flowRun')}</a>
            {!locked && <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty && data.version === data.flow.currentVersion}>{t('flowSave')}</Button>}
            {!locked && !full && (
              <ConfirmButton message={t('cfmArchiveFlow')} variant="danger" onConfirm={async () => { await api('DELETE', `/api/flows/${data.flow.id}`); window.location.assign('/app/flow'); }}>{t('flowArchive')}</ConfirmButton>
            )}
          </div>
        </div>
        {locked && <p className="m-0 text-sm text-muted">{canWrite ? t('flowLockedCommand') : t('flowReadOnly')}</p>}
        {data.version !== data.flow.currentVersion && <p className="m-0 text-sm text-warm-ink">{t('flowOldVersionNote', { n: data.version })}</p>}
        {error ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      </header>

      <FlowCanvas
        label={t('flowCanvas')}
        className={full ? 'min-h-0 flex-1' : 'h-[calc(100dvh-15rem)] min-h-[480px]'}
        nodes={shown}
        edges={shownEdges}
        readOnly={locked}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={selectNode}
        onPaneClick={() => setDrawer(null)}
        toolbar={toolbar}
        overlay={nodes.length === 0 && !locked ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Button variant="primary" className="pointer-events-auto" onClick={() => setPicker({ kind: 'end' })}><Icon name="plus" className="size-4" />{t('flowAddStep')}</Button>
          </div>
        ) : detail}
      />
      <Problems problems={problems} onPick={selectNode} />
      <StepPicker open={picker !== null} onClose={() => setPicker(null)} tools={catalog.tools} onPick={(tool) => picker && addTool(tool, picker)} />
    </div>
  );
}

/** "Add a step": a search over every tool, grouped by what it works on, the way n8n's node picker does. */
function StepPicker({ open, onClose, tools, onPick }: { open: boolean; onClose: () => void; tools: CatalogTool[]; onPick: (tool: CatalogTool) => void }) {
  const t = useT();
  const [search, setSearch] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setSearch('');
  }, [open]);
  const q = search.trim().toLowerCase();
  const shown = tools.filter((x) => !q || `${x.id} ${t(toolLabelKey(x.id))}`.toLowerCase().includes(q));
  return (
    <Modal open={open} onClose={onClose} title={t('flowPickerTitle')} initialFocus={field}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-muted">{t('flowPickerHint')}</p>
        <TextInput ref={field} type="search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder={t('flowSearchTool')} aria-label={t('flowSearchTool')} autoComplete="off" />
        <div className="flex max-h-[55dvh] flex-col gap-3 overflow-y-auto">
          {GROUPS.map((g) => {
            const list = shown.filter((x) => toolGroup(x.id) === g);
            if (!list.length) return null;
            return (
              <section key={g} className="flex flex-col gap-1" aria-label={t(GROUP_LABEL[g])}>
                <h3 className="m-0 text-sm font-medium text-muted">{t(GROUP_LABEL[g])}</h3>
                {list.map((x) => (
                  <button key={x.id} type="button" disabled={!x.allowed || !x.available} onClick={() => onPick(x)} className="flex w-full cursor-pointer items-center gap-3 rounded-input border border-transparent bg-transparent p-2 text-left text-sm text-ink hover:border-rule hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50">
                    <span aria-hidden="true" className={cx('grid size-9 shrink-0 place-items-center rounded-input', GROUP_TILE[g])}><Icon name={GROUP_ICON[g]} className="size-5" /></span>
                    <span className="min-w-0 flex-1 truncate font-medium">{t(toolLabelKey(x.id))}</span>
                    {!x.available ? <span className="shrink-0 text-xs text-muted">{t('flowToolSoon')}</span> : !x.allowed ? <span className="shrink-0 text-xs text-warm-ink">{t('flowOwnerOnly')}</span> : x.tier === 'change' ? <span className="shrink-0 rounded-full border border-warm px-2 text-xs text-warm-ink">{t('flowTierChange')}</span> : null}
                  </button>
                ))}
              </section>
            );
          })}
          {shown.length === 0 && <p className="m-0 text-sm text-muted">{t('flowPickerEmpty')}</p>}
        </div>
      </div>
    </Modal>
  );
}

function Problems({ problems, onPick }: { problems: Problem[]; onPick: (id: string) => void }) {
  const t = useT();
  if (problems.length === 0) return <p role="status" className="m-0 text-sm text-success">{t('flowValid')}</p>;
  return (
    <Panel className="flex flex-col gap-2 !p-3" aria-label={t('flowProblems')}>
      <h2 className="m-0 text-sm font-semibold text-ink">{t('flowProblems')} ({problems.length})</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {problems.slice(0, 12).map((p, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
            {p.node ? <button type="button" onClick={() => onPick(p.node!)} className="cursor-pointer border-0 bg-transparent p-0 font-mono text-accent underline underline-offset-2">{p.node}</button> : null}
            <span className="text-danger">{t(`flowProblem_${p.code}` as MessageKey)}</span>
            {p.detail && <span className="font-mono text-xs text-muted [overflow-wrap:anywhere]">{p.detail}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function VarPicker({ refs, disabled, onPick }: { refs: Array<{ ref: string; group: string }>; disabled: boolean; onPick: (ref: string) => void }) {
  const t = useT();
  if (refs.length === 0) return null;
  return (
    <div className="mt-1 w-full max-w-[16rem]">
      <SelectMenu value="" onChange={(v) => v && onPick(v)} disabled={disabled} size="sm" placeholder={t('flowInsertVar')} options={refs.map((r) => ({ value: r.ref, label: r.ref }))} />
    </div>
  );
}

function Field({ toolId, spec, value, refs, disabled, onChange }: { toolId: string; spec: CatalogField; value: string | number | boolean | undefined; refs: Array<{ ref: string; group: string }>; disabled: boolean; onChange: (v: string | number | boolean | undefined) => void }) {
  const t = useT();
  const locale = useLocale();
  const text = value === undefined ? '' : String(value);
  const usable = refs.filter((r) => spec.secret || r.group !== 'secrets');
  const set = (s: string) => onChange(s === '' ? undefined : spec.type === 'number' && /^-?\d+$/.test(s) ? Number(s) : s);
  const words = fieldText(locale, toolId, spec.key);
  const label = words?.label ?? spec.key;
  const help = [words?.help, spec.secret ? t('flowFieldSecretOk') : null].filter(Boolean).join(' ') || undefined;
  if (spec.type === 'boolean') return (
    <div className="flex flex-col gap-1">
      <Toggle label={label} checked={value === true || value === 'true'} onChange={onChange} disabled={disabled} />
      {help && <p className="m-0 text-sm text-muted">{help}</p>}
    </div>
  );
  if (spec.type === 'select') return (
    <FormField label={label} required={!spec.optional} help={help}>
      <SelectMenu value={text} onChange={(v) => onChange(v || undefined)} disabled={disabled} searchable={false} options={(spec.options ?? []).map((o) => ({ value: o, label: optionLabel(locale, spec.key, o) }))} />
    </FormField>
  );
  return (
    <FormField label={label} required={!spec.optional} help={help}>
      {spec.multiline ? <Textarea value={text} onChange={(e) => set(e.currentTarget.value)} rows={6} spellCheck={false} disabled={disabled} /> : <TextInput value={text} onChange={(e) => set(e.currentTarget.value)} disabled={disabled} autoComplete="off" spellCheck={false} />}
      <VarPicker refs={usable} disabled={disabled} onPick={(r) => set(`${text}{{${r}}}`)} />
    </FormField>
  );
}

function NodeInspector({ node, tool, slots, refs, locked, onPatch, onRemove, onAddSlot }: { node: ToolNode; tool: CatalogTool | undefined; slots: Definition['slots']; refs: Array<{ ref: string; group: string }>; locked: boolean; onPatch: (p: Partial<ToolNode['data']>) => void; onRemove: () => void; onAddSlot: (s: Definition['slots'][number]) => void }) {
  const t = useT();
  if (!tool) return <p className="m-0 text-sm text-danger">{t('flowUnknownTool', { tool: node.data.tool })}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-base font-semibold text-ink">{t(toolLabelKey(tool.id))}</h2>
        <p className="m-0 font-mono text-xs text-muted">{tool.id} · {node.id}</p>
        {tool.tier === 'change' && <p className="mt-1 mb-0 text-xs text-warm-ink">{t('flowTierChangeHelp')}</p>}
        {tool.ownerOnly && <p className="mt-1 mb-0 text-xs text-warm-ink">{t('flowOwnerOnlyHelp')}</p>}
        {!tool.available && <p className="mt-1 mb-0 text-xs text-muted">{t('flowToolSoonHelp')}</p>}
      </div>
      <FormField label={t('flowNodeLabel')}>
        <TextInput value={node.data.label} onChange={(e) => onPatch({ label: e.currentTarget.value })} disabled={locked} maxLength={80} autoComplete="off" />
      </FormField>
      {tool.needs.map((kind) => {
        const options = slots.filter((s) => s.kind === kind);
        return (
          <FormField key={kind} label={t(`flowSlot_${kind}` as MessageKey)} required>
            <SelectMenu value={node.data.bind[kind] ?? ''} onChange={(v) => onPatch({ bind: { ...node.data.bind, [kind]: v } })} disabled={locked} searchable={false} placeholder={t('choose')} options={options.map((s) => ({ value: s.name, label: s.label ?? s.name }))} />
            {options.length === 0 && <Button size="sm" onClick={() => onAddSlot({ name: SLOT_DEFAULT[kind], kind })} disabled={locked}>{t('flowAddSlot')}</Button>}
          </FormField>
        );
      })}
      {tool.fields.map((f) => (
        <Field key={f.key} toolId={tool.id} spec={f} value={node.data.config[f.key]} refs={refs} disabled={locked} onChange={(v) => onPatch({ config: Object.fromEntries(Object.entries({ ...node.data.config, [f.key]: v }).filter(([, x]) => x !== undefined)) as ToolNode['data']['config'] })} />
      ))}
      {tool.outputs.length > 0 && (
        <p className="m-0 text-xs text-muted">{t('flowOutputs')}: {tool.outputs.map((o) => <code key={o} className="mr-1 font-mono">{`{{nodes.${node.id}.${o}}}`}</code>)}</p>
      )}
      {tool.producesSecretFrom && typeof node.data.config[tool.producesSecretFrom] === 'string' && <p className="m-0 text-xs text-muted">{t('flowSecretMade')}: <code className="font-mono">{`{{secrets.${node.data.config[tool.producesSecretFrom]}}}`}</code></p>}
      {!locked && <div><ConfirmButton message={t('cfmRemoveNode')} variant="danger" onConfirm={onRemove}>{t('flowRemoveNode')}</ConfirmButton></div>}
    </div>
  );
}

function FlowSettings({ name, description, slots, params, locked, onName, onDescription, onSlots, onParams }: { name: string; description: string; slots: Definition['slots']; params: Definition['params']; locked: boolean; onName: (v: string) => void; onDescription: (v: string) => void; onSlots: (s: Definition['slots']) => void; onParams: (p: Definition['params']) => void }) {
  const t = useT();
  const setSlot = (i: number, patch: Partial<Definition['slots'][number]>) => onSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setParam = (i: number, patch: Partial<Definition['params'][number]>) => onParams(params.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="flex flex-col gap-4">
      <FormField label={t('fDocTitle')}>
        <TextInput value={name} onChange={(e) => onName(e.currentTarget.value)} disabled={locked} maxLength={80} autoComplete="off" />
      </FormField>
      <FormField label={t('flowDescription')}>
        <Textarea value={description} onChange={(e) => onDescription(e.currentTarget.value)} disabled={locked} rows={3} maxLength={500} />
      </FormField>

      <section className="flex flex-col gap-2" aria-label={t('flowSlots')}>
        <h2 className="m-0 text-sm font-semibold text-ink">{t('flowSlots')}</h2>
        <p className="m-0 text-xs text-muted">{t('flowSlotsHelp')}</p>
        {slots.map((s, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_9rem_auto] items-end gap-2">
            <FormField label={t('flowSlotName')}><TextInput value={s.name} onChange={(e) => setSlot(i, { name: e.currentTarget.value.toLowerCase() })} disabled={locked} autoComplete="off" /></FormField>
            <FormField label={t('flowParamType')}><SelectMenu value={s.kind} onChange={(v) => setSlot(i, { kind: v as (typeof KINDS)[number] })} disabled={locked} searchable={false} options={KINDS.map((k) => ({ value: k, label: t(`flowSlot_${k}` as MessageKey) }))} /></FormField>
            <Button size="sm" onClick={() => onSlots(slots.filter((_, j) => j !== i))} disabled={locked} aria-label={t('flowRemove')}><Icon name="close" className="size-4" /></Button>
          </div>
        ))}
        {!locked && <div><Button size="sm" onClick={() => onSlots([...slots, { name: `slot_${slots.length + 1}`, kind: 'ssh' }])}><Icon name="plus" className="size-4" />{t('flowAddSlot')}</Button></div>}
      </section>

      <section className="flex flex-col gap-2" aria-label={t('flowParams')}>
        <h2 className="m-0 text-sm font-semibold text-ink">{t('flowParams')}</h2>
        <p className="m-0 text-xs text-muted">{t('flowParamsHelp')}</p>
        {params.map((p, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-input border border-rule p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <FormField label={t('flowParamName')}><TextInput value={p.name} onChange={(e) => setParam(i, { name: e.currentTarget.value.toLowerCase() })} disabled={locked} autoComplete="off" /></FormField>
              <Button size="sm" onClick={() => onParams(params.filter((_, j) => j !== i))} disabled={locked} aria-label={t('flowRemove')}><Icon name="close" className="size-4" /></Button>
            </div>
            <p className="m-0 -mt-1 text-xs text-muted">{t('flowParamNameHelp')}</p>
            <FormField label={t('flowParamLabel')}><TextInput value={p.label ?? ''} onChange={(e) => setParam(i, { label: e.currentTarget.value })} disabled={locked} autoComplete="off" /></FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField label={t('flowParamType')}><SelectMenu value={p.type} onChange={(v) => setParam(i, { type: v as typeof p.type })} disabled={locked} searchable={false} options={[{ value: 'string', label: t('flowTypeText') }, { value: 'number', label: t('flowTypeNumber') }, { value: 'boolean', label: t('flowTypeBool') }]} /></FormField>
              <FormField label={t('flowParamPattern')}><SelectMenu value={p.pattern} onChange={(v) => setParam(i, { pattern: v as typeof p.pattern })} disabled={locked || p.type !== 'string'} searchable={false} options={PATTERNS.map((x) => ({ value: x, label: t(PATTERN_LABEL[x]) }))} /></FormField>
            </div>
            <FormField label={t('flowParamDefault')}><TextInput value={p.default === undefined ? '' : String(p.default)} onChange={(e) => setParam(i, { default: e.currentTarget.value === '' ? undefined : p.type === 'number' && /^\d+$/.test(e.currentTarget.value) ? Number(e.currentTarget.value) : e.currentTarget.value })} disabled={locked} autoComplete="off" /></FormField>
            <Toggle label={t('flowParamRequired')} checked={p.required} onChange={(v) => setParam(i, { required: v })} disabled={locked} />
          </div>
        ))}
        {!locked && <div><Button size="sm" onClick={() => onParams([...params, { name: `param_${params.length + 1}`, type: 'string', required: true, pattern: 'free' }])}><Icon name="plus" className="size-4" />{t('flowAddParam')}</Button></div>}
      </section>
    </div>
  );
}
