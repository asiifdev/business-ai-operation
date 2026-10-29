import type { listAudit } from '../../domain/audit/read';
import { api, errorKey } from '../../lib/api-client';
import { AUDIT_LABEL } from '../../lib/audit-labels';
import { formatDateTime } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';

type Page = Jsonify<Awaited<ReturnType<typeof listAudit>>>;

/** The changes of one record, newest first (BRD-M15). Managers only: the caller decides whether to show it. */
export function AuditTimeline({ entityType, entityId, timezone }: { entityType: string; entityId: string; timezone: string }) {
  const t = useT();
  const load = useLoad(() => api<Page>('GET', `/api/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`), [entityType, entityId]);
  return (
    <Panel className="flex flex-col gap-3" aria-busy={load.value.state === 'loading'}>
      <h2 className="m-0 text-lg font-semibold text-ink">{t('auditTimelineTitle')}</h2>
      {load.value.state === 'loading' && <Skeleton rows={3} />}
      {load.value.state === 'error' && <ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox>}
      {load.value.state === 'ready' && load.value.data.entries.length === 0 && <EmptyState>{t('auditTimelineEmpty')}</EmptyState>}
      {load.value.state === 'ready' && load.value.data.entries.length > 0 && (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {load.value.data.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="whitespace-nowrap text-muted">{formatDateTime(e.createdAt, timezone)}</span>
              <span className="text-ink">{AUDIT_LABEL[e.action] ? t(AUDIT_LABEL[e.action]) : e.action}</span>
              <span className="text-muted">{e.actorName ?? (e.actor.startsWith('ai:') ? t('auditActorAi') : t('auditActorSystem'))}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
