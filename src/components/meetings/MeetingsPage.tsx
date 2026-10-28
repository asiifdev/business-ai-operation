import type { MeetingRow } from '../../domain/meetings/service';
import { api, errorKey } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { buttonClasses } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';

type Row = Jsonify<MeetingRow>;

const STATUS: Record<Row['status'], { label: MessageKey; tone: 'neutral' | 'accent' | 'success' | 'danger' }> = {
  uploaded: { label: 'mtStatusUploaded', tone: 'neutral' },
  processing: { label: 'mtStatusProcessing', tone: 'accent' },
  done: { label: 'mtStatusDone', tone: 'success' },
  failed: { label: 'mtStatusFailed', tone: 'danger' },
};

/** The state of a meeting in one badge: deleted content wins, then the processing status. */
export function MeetingStatusBadge({ status, contentDeleted }: { status: Row['status']; contentDeleted: boolean }) {
  const t = useT();
  if (contentDeleted) return <Badge>{t('mtContentDeleted')}</Badge>;
  return <Badge tone={STATUS[status].tone}>{t(STATUS[status].label)}</Badge>;
}

export const minutesOf = (ms: number | null) => (ms == null ? null : Math.max(1, Math.round(ms / 60_000)));

/** Every recording this person may see, newest first (BRD-M09). */
export function MeetingsPage({ timezone }: { timezone: string }) {
  const t = useT();
  const list = useLoad(() => api<{ meetings: Row[] }>('GET', '/api/meetings'), []);
  const newButton = (
    <a href="/app/rapat/baru" className={buttonClasses('primary')}>
      <Icon name="plus" className="size-4" />
      {t('mtNew')}
    </a>
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('mtTitle')} intro={t('mtIntro')} action={newButton} />
      <Panel aria-busy={list.value.state === 'loading'}>
        {list.value.state === 'loading' && <Skeleton rows={5} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry}>{t(errorKey(list.value.error))}</ErrorBox>}
        {list.value.state === 'ready' && list.value.data.meetings.length === 0 && <EmptyState action={newButton}>{t('mtEmpty')}</EmptyState>}
        {list.value.state === 'ready' && list.value.data.meetings.length > 0 && (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[40rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('mtColTitle')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('mtColDuration')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('mtColBy')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('mtColWhen')}</th>
                  <th scope="col" className="py-2 font-medium">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {list.value.data.meetings.map((m) => (
                  <tr key={m.id} role="row" className={tbl.row}>
                    <td data-label={t('mtColTitle')} className={`py-3 pr-3 ${tbl.label} ${tbl.full}`}>
                      <a href={`/app/rapat/${m.id}`} className="font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{m.title}</a>
                      {m.source === 'telegram' && <span className="ml-2 text-xs text-muted">{t('mtSourceTelegram')}</span>}
                    </td>
                    <td data-label={t('mtColDuration')} className={`py-3 pr-3 tabular-nums ${tbl.label}`}>{minutesOf(m.durationMs) != null ? t('mtMinutesShort', { n: minutesOf(m.durationMs)! }) : '—'}</td>
                    <td data-label={t('mtColBy')} className={`py-3 pr-3 ${tbl.label}`}>{m.createdByName ?? '—'}</td>
                    <td data-label={t('mtColWhen')} className={`py-3 pr-3 ${tbl.label}`}>{formatDateTime(m.createdAt, timezone)}</td>
                    <td data-label={t('colStatus')} className={`py-3 ${tbl.label}`}><MeetingStatusBadge status={m.status} contentDeleted={m.contentDeleted} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
