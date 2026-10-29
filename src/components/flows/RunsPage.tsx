import { api, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { buttonClasses } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { RUN_TONE } from './RunView';

interface RunRow { id: string; status: keyof typeof RUN_TONE; kind: 'setup' | 'update'; error: string | null; createdAt: string; finishedAt: string | null; domain: string }

export function RunsPage({ canRun }: { canRun: boolean }) {
  const t = useT();
  const runs = useLoad(() => api<{ runs: RunRow[] }>('GET', '/api/runs'), []);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('navRuns')} intro={t('runsIntro')} action={canRun ? <a href="/app/setup/baru" className={buttonClasses('primary')}>{t('runNewTitle')}</a> : undefined} />
      {runs.value.state === 'loading' ? <Panel aria-busy="true"><Skeleton rows={4} /></Panel>
        : runs.value.state === 'error' ? <Panel><ErrorBox onRetry={runs.retry}>{t(errorKey(runs.value.error))}</ErrorBox></Panel>
        : runs.value.data.runs.length === 0 ? <EmptyState>{t('runsEmpty')}</EmptyState>
        : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {runs.value.data.runs.map((r) => (
              <li key={r.id}>
                <a href={`/app/setup/${r.id}`} className="flex flex-wrap items-center gap-3 rounded-card border border-rule bg-paper p-3 no-underline hover:border-rule-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.domain || r.id}</span>
                  <Badge tone="neutral">{t(r.kind === 'setup' ? 'flowKindSetup' : 'flowKindUpdate')}</Badge>
                  <Badge tone={RUN_TONE[r.status]}>{t(`runStatus_${r.status}` as MessageKey)}</Badge>
                  <time className="text-xs text-muted" dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
                </a>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
