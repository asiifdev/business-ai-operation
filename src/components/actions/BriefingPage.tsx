import { useState } from 'react';
import type { BriefingView } from '../../domain/action-center/briefing';
import { api, errorKey } from '../../lib/api-client';
import { formatDateTime, formatFullDate, formatRupiah } from '../../lib/format';
import { getLocale } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';

type Data = { today: string; briefing: Jsonify<BriefingView> | null };

/**
 * Today's briefing (BR-M08-13): the numbers as they were when it was written, from the same services as the dashboard,
 * and a few sentences of AI wording labelled as such. Without AI it is numbers only, labelled "not an AI result".
 */
export function BriefingPage({ timezone }: { timezone: string }) {
  const t = useT();
  const load = useLoad(() => api<Data>('GET', '/api/briefing'), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/briefing', { locale: getLocale() });
      await load.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('briefingTitle')} intro={t('briefingIntro')} action={<a href="/app/action-center" className={buttonClasses('secondary', 'sm')}>{t('navActionCenter')}</a>} />
      {load.value.state === 'loading' && <Panel aria-busy="true"><Skeleton rows={5} /></Panel>}
      {load.value.state === 'error' && <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>}
      {load.value.state === 'ready' && !load.value.data.briefing && (
        <Panel>
          <EmptyState action={<Button variant="primary" loading={busy} onClick={generate}>{t('briefingGenerate')}</Button>}>{t('briefingNone')}</EmptyState>
          {error ? <p role="alert" className="mt-3 mb-0 text-danger">{t(errorKey(error))}</p> : null}
        </Panel>
      )}
      {load.value.state === 'ready' && load.value.data.briefing && <Briefing briefing={load.value.data.briefing} timezone={timezone} />}
    </div>
  );
}

function Briefing({ briefing, timezone }: { briefing: Jsonify<BriefingView>; timezone: string }) {
  const t = useT();
  const f = briefing.facts;
  const money = [
    { label: t('financeReceived'), value: formatRupiah(f.receivedThisMonth) },
    { label: t('financeMrr'), value: formatRupiah(f.mrr) },
    { label: t('financeOutstanding'), value: `${formatRupiah(f.outstanding.amount)} · ${f.outstanding.count}` },
    { label: t('financeOverdue'), value: `${formatRupiah(f.overdue.amount)} · ${f.overdue.count}`, danger: f.overdue.count > 0 },
  ];
  const counts = [
    { label: t('briefingOpenFindings'), value: f.openFindings, href: '/app/action-center' },
    { label: t('prioHigh'), value: f.highPriorityFindings, href: '/app/action-center' },
    { label: t('briefingPending'), value: f.pendingApprovals, href: '/app/action-center' },
    { label: t('briefingDueToday'), value: f.dueToday, href: '/app/invoice' },
    { label: t('briefingRenewals'), value: f.renewalsSoon, href: '/app/langganan' },
    { label: t('briefingDrafts'), value: f.draftsToReview, href: '/app/invoice?status=draft' },
  ];
  return (
    <>
      <Panel className="flex flex-col gap-3" aria-label={t('briefingSummary')}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-lg font-semibold text-ink">{formatFullDate(briefing.date)}</h2>
          {briefing.isAi ? <Badge tone="accent">{t('aiAssistedLabel')}</Badge> : <Badge>{t('notAiLabel')}</Badge>}
        </div>
        {briefing.narrative ? <p className="m-0 max-w-prose text-base whitespace-pre-line text-ink-2">{briefing.narrative}</p> : <p className="m-0 text-sm text-muted">{t('briefingNarrativeNone')}</p>}
        <p className="m-0 text-xs text-muted">{t('briefingWritten', { when: formatDateTime(briefing.createdAt, timezone) })}</p>
      </Panel>

      <Panel className="flex flex-col gap-4" aria-label={t('briefingNumbers')}>
        <h2 className="m-0 text-lg font-semibold text-ink">{t('briefingNumbers')}</h2>
        <dl className="m-0 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {money.map((m) => (
            <div key={m.label} className="flex flex-col gap-1">
              <dt className="text-sm text-muted">{m.label}</dt>
              <dd className={`m-0 font-mono text-lg tabular-nums ${m.danger ? 'text-danger' : 'text-ink'}`}>{m.value}</dd>
            </div>
          ))}
        </dl>
        <dl className="m-0 grid gap-x-4 gap-y-2 border-t border-rule pt-4 sm:grid-cols-2 xl:grid-cols-3">
          {counts.map((c) => (
            <div key={c.label} className="flex items-baseline justify-between gap-3 text-sm">
              <dt><a href={c.href} className="text-ink-2 no-underline hover:text-accent">{c.label}</a></dt>
              <dd className="m-0 font-mono text-ink tabular-nums">{c.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </>
  );
}
