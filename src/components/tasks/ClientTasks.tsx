import type { TaskRow, TaskSummary } from '../../domain/tasks/service';
import { api, errorKey } from '../../lib/api-client';
import { formatDate } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { KIND_LABEL, TaskBadges } from './labels';

const SHOWN = 8;

/** The open work for one client, on its 360 view (PRD M05). The full list, with the add form, is one link away. */
export function ClientTasks({ clientId }: { clientId: string }) {
  const t = useT();
  const load = useLoad(() => api<{ tasks: Array<Jsonify<TaskRow>>; summary: TaskSummary }>('GET', `/api/tasks?clientId=${encodeURIComponent(clientId)}`), [clientId]);
  const all = `/app/task?clientId=${encodeURIComponent(clientId)}`;
  return (
    <Panel className="flex flex-col gap-4" aria-label={t('clientTasksTitle')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('clientTasksTitle')}</h2>
        <a href={all} className="text-sm text-accent no-underline hover:underline">{t('clientTasksAll')}</a>
      </div>
      {load.value.state === 'loading' && <Skeleton rows={3} />}
      {load.value.state === 'error' && <ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox>}
      {load.value.state === 'ready' && load.value.data.tasks.length === 0 && <EmptyState>{t('clientTasksEmpty')}</EmptyState>}
      {load.value.state === 'ready' && load.value.data.tasks.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {load.value.data.tasks.slice(0, SHOWN).map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule py-2.5 first:border-t-0">
              <a href={`/app/task/${task.id}`} className="min-w-0 flex-1 font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{task.title}</a>
              <span className="text-sm text-muted">
                {t(KIND_LABEL[task.kind])}
                {task.dueDate ? ` · ${formatDate(task.dueDate)}` : ''}
              </span>
              <TaskBadges task={task} showStatus />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
