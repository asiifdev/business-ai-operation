import { useEffect, useState } from 'react';
import { TASK_KINDS, TASK_STATUSES, type TaskStatus } from '../../domain/tasks/rules';
import type { TaskFormOptions, TaskRow, TaskSummary } from '../../domain/tasks/service';
import { api, errorKey } from '../../lib/api-client';
import { formatDate } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { Toggle } from '../forms/Toggle';
import { Icon } from '../shell/Icon';
import { Button } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { KIND_LABEL, moveLabel, PRIORITY_LABEL, STATUS_LABEL, TaskBadges } from './labels';
import { TaskForm, taskPayload } from './TaskForm';
import { Tabs } from '../ui/Tabs';

type Task = Jsonify<TaskRow>;
type Data = { tasks: Task[]; summary: TaskSummary };
type View = 'list' | 'board';

interface Filters {
  view: View;
  status: string;
  kind: string;
  assignee: string;
  clientId: string;
  late: boolean;
  done: boolean;
}

const EMPTY: Filters = { view: 'list', status: '', kind: '', assignee: '', clientId: '', late: false, done: false };

function readFilters(): Filters {
  if (typeof window === 'undefined') return EMPTY;
  const p = new URLSearchParams(window.location.search);
  return {
    view: p.get('view') === 'board' ? 'board' : 'list',
    status: TASK_STATUSES.find((s) => s === p.get('status')) ?? '',
    kind: TASK_KINDS.find((k) => k === p.get('kind')) ?? '',
    assignee: p.get('assignee') ?? '',
    clientId: p.get('clientId') ?? '',
    late: p.get('late') === '1',
    done: p.get('done') === '1',
  };
}

/** The filters as a query string, shared by the address bar and the API call so a link reproduces the view. */
function toQuery(f: Filters, forApi: boolean): string {
  const p = new URLSearchParams();
  if (!forApi && f.view === 'board') p.set('view', 'board');
  if (f.status) p.set('status', f.status);
  if (f.kind) p.set('kind', f.kind);
  if (f.assignee) p.set('assignee', f.assignee);
  if (f.clientId) p.set('clientId', f.clientId);
  if (f.late) p.set('late', '1');
  // The board always has a Done column, so it asks for finished work too.
  if (f.done || (forApi && f.view === 'board')) p.set('done', '1');
  const q = p.toString();
  return q ? `?${q}` : '';
}

/** All tasks (BRD-M05): counts, filters that live in the URL, a list or a board, and AI drafts waiting for a decision. */
export function TasksPage() {
  const t = useT();
  const [filters, setFilters] = useState<Filters | null>(null);
  useEffect(() => setFilters(readFilters()), []);
  const f = filters ?? EMPTY;
  const list = useLoad(() => (filters ? api<Data>('GET', `/api/tasks${toQuery(filters, true)}`) : new Promise<Data>(() => undefined)), [filters ? toQuery(filters, true) : null]);
  const options = useLoad(() => api<Jsonify<TaskFormOptions>>('GET', '/api/tasks/options'), []);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  function update(patch: Partial<Filters>) {
    const next = { ...f, ...patch };
    setFilters(next);
    // The table keeps its own search, sort and page in the URL beside the filters, so only the filter keys are rewritten.
    const p = new URLSearchParams(window.location.search);
    for (const k of ['view', 'status', 'kind', 'assignee', 'clientId', 'late', 'done']) p.delete(k);
    for (const [k, v] of new URLSearchParams(toQuery(next, false).slice(1))) p.set(k, v);
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      await list.reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyId(null);
    }
  }

  const move = (task: Task, to: TaskStatus) => act(task.id, () => api('POST', `/api/tasks/${task.id}/status`, { to }));
  const accept = (task: Task) => act(task.id, () => api('POST', `/api/tasks/${task.id}/accept`));
  const discard = (task: Task) => act(task.id, () => api('POST', `/api/tasks/${task.id}/discard`));
  const opts = options.value.state === 'ready' ? options.value.data : null;
  const clientName = f.clientId && opts ? opts.clients.find((c) => c.id === f.clientId)?.name : null;
  const filtered = Boolean(f.status || f.kind || f.assignee || f.clientId || f.late);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={clientName ? `${t('tasksTitle')} · ${clientName}` : t('tasksTitle')}
        intro={t('tasksIntro')}
        action={<Button variant="primary" aria-expanded={adding} disabled={!opts} onClick={() => setAdding((v) => !v)}><Icon name="plus" className="size-4" />{t('newTask')}</Button>}
      />

      {adding && opts && (
        <Panel aria-label={t('newTask')}>
          <TaskForm
            options={opts}
            initial={{ title: '', description: '', kind: 'task', priority: 'medium', dueDate: '', assigneeId: '', clientId: f.clientId, productId: '', deploymentId: '' }}
            submitLabel={t('add')}
            request={(v) => api('POST', '/api/tasks', taskPayload(v))}
            onDone={() => { setAdding(false); void list.reload(); }}
            onCancel={() => setAdding(false)}
          />
        </Panel>
      )}

      {list.value.state === 'ready' && (
        <dl className="m-0 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Figure label={t('taskSumOpen')} value={list.value.data.summary.open} />
          <Figure label={t('taskSumLate')} value={list.value.data.summary.late} alert={list.value.data.summary.late > 0} onClick={() => update({ late: !f.late, status: '' })} pressed={f.late} />
          <Figure label={t('taskSumMine')} value={list.value.data.summary.mine} onClick={() => update({ assignee: f.assignee === 'me' ? '' : 'me' })} pressed={f.assignee === 'me'} />
          <Figure label={t('taskSumDrafts')} value={list.value.data.summary.drafts} />
        </dl>
      )}

      <Panel className="flex flex-col gap-4" aria-busy={list.value.state === 'loading'}>
        <div className="flex flex-wrap items-end gap-3">
          <Tabs
            label={t('taskViews')}
            items={[{ id: 'list', label: t('taskViewList') }, { id: 'board', label: t('taskViewBoard') }] as const}
            value={f.view}
            onChange={(v) => update({ view: v })}
            className="mr-auto"
          />
          {f.view === 'list' && (
            <FormField label={t('taskFilterStatus')} className="w-40">
              <SelectMenu size="sm" searchable={false} value={f.status} onChange={(v) => update({ status: v })} includeAll={t('all')} options={TASK_STATUSES.map((s) => ({ value: s, label: t(STATUS_LABEL[s]) }))} />
            </FormField>
          )}
          <FormField label={t('taskFilterKind')} className="w-40">
            <SelectMenu size="sm" searchable={false} value={f.kind} onChange={(v) => update({ kind: v })} includeAll={t('all')} options={TASK_KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))} />
          </FormField>
          <FormField label={t('taskFilterAssignee')} className="w-48">
            <SelectMenu
              size="sm"
              value={f.assignee}
              onChange={(v) => update({ assignee: v })}
              includeAll={t('all')}
              options={[{ value: 'me', label: t('taskAssigneeMe') }, { value: 'none', label: t('taskAssigneeNone') }, ...(opts?.canAssignOthers ? opts.assignees.map((u) => ({ value: u.id, label: u.name })) : [])]}
            />
          </FormField>
          {f.clientId && (
            <Button size="sm" onClick={() => update({ clientId: '' })}>{t('clear')} · {clientName ?? t('fTaskClient')}</Button>
          )}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Toggle label={t('taskLateOnly')} checked={f.late} onChange={(v) => update({ late: v })} />
          {f.view === 'list' && <Toggle label={t('taskShowDone')} checked={f.done} onChange={(v) => update({ done: v })} />}
        </div>

        {actionError != null && <p role="alert" className="m-0 text-danger">{t(errorKey(actionError))}</p>}
        {list.value.state === 'loading' && <Skeleton rows={6} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry}>{t(errorKey(list.value.error))}</ErrorBox>}
        {list.value.state === 'ready' && list.value.data.tasks.length === 0 && (
          <EmptyState action={!filtered ? <Button variant="primary" disabled={!opts} onClick={() => setAdding(true)}>{t('newTask')}</Button> : undefined}>{filtered ? t('tasksNoMatch') : t('tasksEmpty')}</EmptyState>
        )}
        {list.value.state === 'ready' && list.value.data.tasks.length > 0 && (
          <>
            <Drafts tasks={list.value.data.tasks.filter((x) => x.isDraft)} busyId={busyId} onAccept={accept} onDiscard={discard} />
            {f.view === 'list' ? (
              <TaskTable tasks={list.value.data.tasks.filter((x) => !x.isDraft)} busyId={busyId} onMove={move} />
            ) : (
              <Board tasks={list.value.data.tasks.filter((x) => !x.isDraft)} busyId={busyId} onMove={move} />
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function Figure({ label, value, alert = false, onClick, pressed }: { label: string; value: number; alert?: boolean; onClick?: () => void; pressed?: boolean }) {
  const body = (
    <>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`m-0 mt-1 text-2xl font-semibold tabular-nums ${alert ? 'text-danger' : 'text-ink'}`}>{value}</dd>
    </>
  );
  const box = 'rounded-card border bg-key-face p-4 text-left shadow-soft';
  if (!onClick) return <div className={`${box} border-rule`}>{body}</div>;
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={`${box} transition-colors duration-(--duration-micro) hover:border-accent ${pressed ? 'border-accent' : 'border-rule'}`}>
      {body}
    </button>
  );
}

/** AI drafts sit apart until a person accepts or discards them (BR-M05-05). */
function Drafts({ tasks, busyId, onAccept, onDiscard }: { tasks: Task[]; busyId: string | null; onAccept: (t: Task) => void; onDiscard: (t: Task) => void }) {
  const t = useT();
  if (tasks.length === 0) return null;
  return (
    <section aria-label={t('taskSumDrafts')} className="flex flex-col gap-3 rounded-card border border-dashed border-accent p-3">
      <div>
        <h2 className="m-0 text-base font-semibold text-ink">{t('taskSumDrafts')}</h2>
        <p className="m-0 mt-1 text-sm text-muted">{t('taskDraftHelp')}</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {tasks.map((task) => (
          <li key={task.id} className="flex flex-wrap items-center gap-3 rounded border border-rule bg-key-face px-3 py-2">
            <a href={`/app/task/${task.id}`} className="min-w-0 flex-1 font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{task.title}</a>
            <span className="text-sm text-muted">{t(KIND_LABEL[task.kind])}{task.clientName ? ` · ${task.clientName}` : ''}</span>
            {task.canEdit && (
              <span className="flex gap-2">
                <Button size="sm" variant="primary" loading={busyId === task.id} onClick={() => onAccept(task)}>{t('taskAccept')}</Button>
                <Button size="sm" disabled={busyId === task.id} onClick={() => onDiscard(task)}>{t('taskDiscard')}</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function About({ task }: { task: Task }) {
  const t = useT();
  const parts = [
    task.clientId && task.clientName ? <a key="c" href={`/app/klien/${task.clientId}`} className="text-ink-2 no-underline hover:text-accent">{task.clientName}</a> : null,
    task.productName ? <span key="p" className="text-muted">{task.deploymentLabel ?? task.productName}</span> : null,
    task.leadId && task.leadName ? <a key="l" href={`/app/lead/${task.leadId}`} className="text-ink-2 no-underline hover:text-accent">{task.leadName}</a> : null,
  ].filter(Boolean);
  return parts.length ? <span className="flex flex-col gap-0.5">{parts}</span> : <span className="text-muted">{t('taskNone')}</span>;
}

function TaskTable({ tasks, busyId, onMove }: { tasks: Task[]; busyId: string | null; onMove: (t: Task, to: TaskStatus) => void }) {
  const t = useT();
  if (tasks.length === 0) return null;
  return (
    <DataTable
      label={t('tasksTitle')}
      rows={tasks}
      rowKey={(task) => task.id}
      search={(task) => `${task.title} ${task.clientName ?? ''} ${task.productName ?? ''} ${task.leadName ?? ''} ${task.assigneeName ?? ''}`}
      minWidth="52rem"
      columns={[
        {
          id: 'task',
          header: t('colTask'),
          sortValue: (task) => task.title,
          full: true,
          cell: (task) => (
            <>
              <a href={`/app/task/${task.id}`} className="font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{task.title}</a>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {t(KIND_LABEL[task.kind])} · {t(PRIORITY_LABEL[task.priority])}
              </span>
            </>
          ),
        },
        { id: 'about', header: t('colAbout'), sortValue: (task) => task.clientName ?? task.productName ?? task.leadName, cell: (task) => <About task={task} /> },
        { id: 'assignee', header: t('colAssignee'), sortValue: (task) => task.assigneeName, cell: (task) => task.assigneeName ?? <span className="text-muted">{t('taskAssigneeNone')}</span> },
        { id: 'due', header: t('colDue'), sortValue: (task) => task.dueDate, cell: (task) => <span className="tabular-nums">{task.dueDate ? formatDate(task.dueDate) : '—'}</span> },
        { id: 'status', header: t('colStatus'), cell: (task) => <TaskBadges task={task} showStatus /> },
        {
          id: 'actions',
          header: t('taskDetails'),
          full: true,
          cell: (task) => (
            <span className="flex flex-wrap justify-end gap-1.5">
              {task.nextStatuses.filter((s) => s !== 'open' || task.status === 'done').map((to) => (
                <Button key={to} size="sm" variant={to === 'done' ? 'primary' : 'secondary'} loading={busyId === task.id} onClick={() => onMove(task, to)}>{t(moveLabel(task.status, to))}</Button>
              ))}
            </span>
          ),
        },
      ]}
    />
  );
}

/** One column per status; cards move with buttons, so the board works by keyboard and on a phone. */
function Board({ tasks, busyId, onMove }: { tasks: Task[]; busyId: string | null; onMove: (t: Task, to: TaskStatus) => void }) {
  const t = useT();
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {TASK_STATUSES.map((status) => {
        const inColumn = tasks.filter((x) => x.status === status);
        return (
          <section key={status} aria-label={t(STATUS_LABEL[status])} className="flex min-w-0 flex-col gap-3 rounded-card border border-dashed border-rule p-3">
            <header className="flex items-baseline justify-between gap-2">
              <h2 className="m-0 text-base font-semibold text-ink">{t(STATUS_LABEL[status])}</h2>
              <span className="text-sm text-muted tabular-nums">{inColumn.length}</span>
            </header>
            {inColumn.length === 0 ? (
              <p className="m-0 text-sm text-muted">{t('taskColumnEmpty')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {inColumn.map((task) => (
                  <li key={task.id} aria-busy={busyId === task.id} className="flex min-w-0 flex-col gap-2 rounded-card border border-rule bg-key-face p-3 shadow-soft">
                    <a href={`/app/task/${task.id}`} className="font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{task.title}</a>
                    <TaskBadges task={task} />
                    <p className="m-0 text-xs text-muted">
                      {t(KIND_LABEL[task.kind])}
                      {task.clientName ? ` · ${task.clientName}` : ''}
                      {task.dueDate ? ` · ${formatDate(task.dueDate)}` : ''}
                    </p>
                    <p className="m-0 text-xs text-muted">{task.assigneeName ?? t('taskAssigneeNone')}</p>
                    {task.nextStatuses.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {task.nextStatuses.map((to) => (
                          <Button key={to} size="sm" variant={to === 'done' ? 'primary' : 'secondary'} disabled={busyId === task.id} onClick={() => onMove(task, to)}>{t(moveLabel(task.status, to))}</Button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
