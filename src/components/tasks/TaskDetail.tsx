import { AuditTimeline } from '../audit/AuditTimeline';
import { useState } from 'react';
import type { SimilarTask, TaskDetail as Detail, TaskFormOptions } from '../../domain/tasks/service';
import { api, errorKey } from '../../lib/api-client';
import { formatDate, formatDateTime } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { KIND_LABEL, moveLabel, PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, TaskBadges } from './labels';
import { TaskForm, taskPayload, type TaskValues } from './TaskForm';

type Task = Jsonify<Detail>;

/** One task: its state and next steps, the draft decision, its details, related tasks and suggestions of similar ones. */
export function TaskDetail({ id, timezone, canSeeHistory = false }: { id: string; timezone: string; /** Owner and Admin (`audit.read`) see the change history. */ canSeeHistory?: boolean }) {
  const t = useT();
  const load = useLoad(() => api<Task>('GET', `/api/tasks/${id}`), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);

  async function act(key: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      if (after) after();
      else await load.reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  }

  if (load.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={6} /></Panel>;
  if (load.value.state === 'error') return <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>;

  const task = load.value.data;
  const initial: TaskValues = {
    title: task.title,
    description: task.description ?? '',
    kind: task.kind,
    priority: task.priority,
    dueDate: task.dueDate ?? '',
    assigneeId: task.assigneeId ?? '',
    clientId: task.clientId ?? '',
    productId: task.productId ?? '',
    deploymentId: task.deploymentId ?? '',
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <a href="/app/task" className="w-fit text-sm text-accent underline underline-offset-4">{t('taskBack')}</a>
        <h1 className="m-0 flex min-w-0 flex-wrap items-center gap-3 text-2xl font-semibold text-ink lg:text-3xl">
          <span className="[overflow-wrap:anywhere]">{task.title}</span>
          <Badge tone={STATUS_TONE[task.status]}>{t(STATUS_LABEL[task.status])}</Badge>
          <TaskBadges task={task} />
        </h1>
        <p className="m-0 text-sm text-muted">
          {t(KIND_LABEL[task.kind])} · {t(PRIORITY_LABEL[task.priority])} · {t('taskCreatedOn', { date: formatDateTime(task.createdAt, timezone) })}
          {task.completedAt ? ` · ${t('taskCompletedOn', { date: formatDateTime(task.completedAt, timezone) })}` : ''}
        </p>
        {!task.canEdit && <p className="m-0 text-sm text-muted">{t('taskReadOnly')}</p>}
        {actionError != null && <p role="alert" className="m-0 text-danger">{t(errorKey(actionError))}</p>}
      </header>

      {task.isDraft && (
        <Panel aria-label={t('taskAiDraft')} className="flex flex-col items-start gap-3">
          <p className="m-0 max-w-prose text-ink">{t('taskDraftHelp')}</p>
          {task.canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy === 'accept'} disabled={busy !== null} onClick={() => act('accept', () => api('POST', `/api/tasks/${id}/accept`))}>{t('taskAccept')}</Button>
              <ConfirmButton message={t('cfmDiscardDraft')} busy={busy === 'discard'} disabled={busy !== null} onConfirm={() => act('discard', () => api('POST', `/api/tasks/${id}/discard`), () => window.location.assign('/app/task'))}>{t('taskDiscard')}</ConfirmButton>
            </div>
          )}
        </Panel>
      )}

      {task.nextStatuses.length > 0 && (
        <Panel aria-label={t('colStatus')} className="flex flex-wrap gap-2">
          {task.nextStatuses.map((to) => (
            <Button key={to} variant={to === 'done' ? 'primary' : 'secondary'} loading={busy === to} disabled={busy !== null} onClick={() => act(to, () => api('POST', `/api/tasks/${id}/status`, { to }))}>
              {t(moveLabel(task.status, to))}
            </Button>
          ))}
        </Panel>
      )}

      <Panel aria-label={t('taskDetails')} className="flex flex-col gap-4">
        {editing ? (
          <EditTask id={id} initial={initial} onDone={() => { setEditing(false); void load.reload(); }} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t('fAssignee')} value={task.assigneeName ?? t('taskAssigneeNone')} />
              <Field label={t('fDueDate')} value={task.dueDate ? formatDate(task.dueDate) : t('taskNone')} />
              <Field label={t('fTaskClient')} value={task.clientName} href={task.clientId ? `/app/klien/${task.clientId}` : null} />
              <Field label={t('fTaskProduct')} value={task.productName} href={task.productId ? `/app/produk/${task.productId}` : null} />
              <Field label={t('fTaskDeployment')} value={task.deploymentLabel} />
              {task.leadId && <Field label={t('navPipeline')} value={task.leadName} href={`/app/lead/${task.leadId}`} />}
              {task.source && SOURCE_LABEL[task.source] && <Field label={t('taskSource')} value={t(SOURCE_LABEL[task.source])} />}
              <div className="sm:col-span-2 lg:col-span-3"><Field label={t('fDescription')} value={task.description} /></div>
              {task.sourceQuote && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-sm text-muted">{t('taskSourceQuote')}</dt>
                  <dd className="m-0 mt-1 max-w-prose border-l-2 border-rule-2 pl-3 text-ink-2 italic whitespace-pre-line">{task.sourceQuote}</dd>
                </div>
              )}
            </dl>
            {task.canEdit && <Button className="w-fit" onClick={() => setEditing(true)}>{t('edit')}</Button>}
          </>
        )}
      </Panel>

      <Related task={task} busy={busy} onUnlink={() => act('unlink', () => api('POST', `/api/tasks/${id}/link`, { relatedTo: null }))} />
      {task.canEdit && <Similar taskId={id} linkedTo={task.duplicateOfTaskId} onLinked={() => void load.reload()} />}
      {canSeeHistory && <AuditTimeline entityType="task" entityId={id} timezone={timezone} />}
    </div>
  );
}

function Field({ label, value, href }: { label: string; value: string | null; href?: string | null }) {
  const t = useT();
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="m-0 mt-0.5 whitespace-pre-line text-ink [overflow-wrap:anywhere]">
        {value && href ? <a href={href} className="text-ink underline-offset-4 hover:text-accent">{value}</a> : value || t('noValue')}
      </dd>
    </div>
  );
}

function EditTask({ id, initial, onDone, onCancel }: { id: string; initial: TaskValues; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const options = useLoad(() => api<Jsonify<TaskFormOptions>>('GET', '/api/tasks/options'), []);
  if (options.value.state === 'loading') return <Skeleton rows={4} />;
  if (options.value.state === 'error') return <ErrorBox onRetry={options.retry}>{t(errorKey(options.value.error))}</ErrorBox>;
  return <TaskForm options={options.value.data} initial={initial} submitLabel={t('save')} request={(v) => api('PATCH', `/api/tasks/${id}`, taskPayload(v))} onDone={onDone} onCancel={onCancel} />;
}

function Related({ task, busy, onUnlink }: { task: Task; busy: string | null; onUnlink: () => void }) {
  const t = useT();
  if (task.related.length === 0) return null;
  return (
    <Panel aria-label={t('taskRelatedTitle')} className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold text-ink">{t('taskRelatedTitle')}</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {task.related.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">{t(r.direction === 'parent' ? 'taskRelatedParent' : 'taskRelatedChild')}</span>
            <a href={`/app/task/${r.id}`} className="font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{r.title}</a>
            <Badge tone={STATUS_TONE[r.status]}>{t(STATUS_LABEL[r.status])}</Badge>
            {r.direction === 'parent' && task.canEdit && <Button size="sm" loading={busy === 'unlink'} disabled={busy !== null} onClick={onUnlink}>{t('taskUnlink')}</Button>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Suggestions only: word overlap finds candidates, a person decides whether to link (BR-M05-06). Loaded on request. */
function Similar({ taskId, linkedTo, onLinked }: { taskId: string; linkedTo: string | null; onLinked: () => void }) {
  const t = useT();
  const [list, setList] = useState<Array<Jsonify<SimilarTask>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const find = () => run('find', async () => setList((await api<{ similar: Array<Jsonify<SimilarTask>> }>('GET', `/api/tasks/${taskId}/similar`)).similar));
  const link = (relatedTo: string) => run(relatedTo, async () => {
    await api('POST', `/api/tasks/${taskId}/link`, { relatedTo });
    setList(null);
    onLinked();
  });

  return (
    <Panel aria-label={t('taskSimilarTitle')} className="flex flex-col gap-3">
      <div className="max-w-prose">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('taskSimilarTitle')}</h2>
        <p className="m-0 mt-1 text-sm text-muted">{t('taskSimilarHelp')}</p>
      </div>
      {list === null ? (
        <Button className="w-fit" loading={busy === 'find'} onClick={find}>{t('taskSimilarFind')}</Button>
      ) : list.length === 0 ? (
        <EmptyState>{t('taskSimilarNone')}</EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded border border-rule px-3 py-2">
              <a href={`/app/task/${s.id}`} className="min-w-0 flex-1 font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{s.title}</a>
              <span className="text-sm text-muted">{t(KIND_LABEL[s.kind])}{s.clientName ? ` · ${s.clientName}` : ''}</span>
              <Badge tone={STATUS_TONE[s.status]}>{t(STATUS_LABEL[s.status])}</Badge>
              <span className="font-mono text-xs text-muted tabular-nums">{t('taskMatch', { n: Math.round(s.score * 100) })}</span>
              {s.id !== linkedTo && <Button size="sm" loading={busy === s.id} disabled={busy !== null} onClick={() => link(s.id)}>{t('taskLink')}</Button>}
            </li>
          ))}
        </ul>
      )}
      {error != null && <p role="alert" className="m-0 text-sm text-danger">{t(errorKey(error))}</p>}
    </Panel>
  );
}
