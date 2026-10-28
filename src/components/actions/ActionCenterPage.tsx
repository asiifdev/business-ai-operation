import { useEffect, useState } from 'react';
import type { ApprovalCard as Approval } from '../../domain/action-center/approvals';
import type { FindingCard as Finding, FindingView } from '../../domain/action-center/findings';
import type { Role } from '../../domain/permissions';
import { api, errorKey } from '../../lib/api-client';
import { refreshAttention } from '../../lib/attention';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { buttonClasses } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { ApprovalCard } from './ApprovalCard';
import { FindingCard } from './FindingCard';

type Data = { today: string; findings: Jsonify<Finding>[]; approvals: Jsonify<Approval>[] };

const VIEWS: Array<{ id: FindingView; label: MessageKey; empty: MessageKey }> = [
  { id: 'open', label: 'acViewOpen', empty: 'acEmptyOpen' },
  { id: 'snoozed', label: 'acViewSnoozed', empty: 'acEmptySnoozed' },
  { id: 'closed', label: 'acViewClosed', empty: 'acEmptyClosed' },
];

function readView(): FindingView {
  if (typeof window === 'undefined') return 'open';
  const v = new URL(window.location.href).searchParams.get('view');
  return v === 'snoozed' || v === 'closed' ? v : 'open';
}

/**
 * The Action Center (BRD-M08): approvals waiting for a decision on top, then the findings of the chosen view, open ones in
 * the fixed priority order. The view lives in the URL (`?view=`) so a link or a reload keeps it.
 */
export function ActionCenterPage({ role, timezone }: { role: Role; timezone: string }) {
  const t = useT();
  const [view, setView] = useState<FindingView>('open');
  useEffect(() => setView(readView()), []);
  const load = useLoad(() => api<Data>('GET', `/api/action-center?view=${view}`), [view]);

  function changed() {
    void load.reload();
    refreshAttention();
  }

  function choose(next: FindingView) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === 'open') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.replaceState(null, '', url);
  }

  const current = VIEWS.find((v) => v.id === view)!;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('acTitle')}
        intro={t('acIntro')}
        action={role !== 'staff' ? <a href="/app/briefing" className={buttonClasses('secondary', 'sm')}>{t('navBriefing')}</a> : undefined}
      />

      {load.value.state === 'ready' && load.value.data.approvals.length > 0 && (
        <Panel className="flex flex-col gap-4" aria-label={t('apTitle')}>
          <div className="max-w-prose">
            <h2 className="m-0 text-lg font-semibold text-ink">{t('apTitle')} <span className="font-mono text-base text-muted tabular-nums">{load.value.data.approvals.length}</span></h2>
            <p className="mt-1 mb-0 text-sm text-muted">{t('apIntro')}</p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {load.value.data.approvals.map((a) => (
              <ApprovalCard key={a.id} approval={a} timezone={timezone} onDecided={changed} />
            ))}
          </div>
        </Panel>
      )}

      <section className="flex flex-col gap-4" aria-label={t('acFindingsTitle')}>
        <div role="tablist" aria-label={t('acViews')} className="flex gap-1 border-b border-rule">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={view === item.id}
              onClick={() => choose(item.id)}
              className={
                'inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors duration-(--duration-micro) ' +
                (view === item.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')
              }
            >
              {t(item.label)}
            </button>
          ))}
        </div>

        {load.value.state === 'loading' && <Panel aria-busy="true"><Skeleton rows={5} /></Panel>}
        {load.value.state === 'error' && <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>}
        {load.value.state === 'ready' &&
          (load.value.data.findings.length === 0 ? (
            <Panel>
              <EmptyState>{t(current.empty)}</EmptyState>
              {role === 'staff' && <p className="mt-3 mb-0 text-sm text-muted">{t('acStaffNote')}</p>}
            </Panel>
          ) : (
            <div className="flex flex-col gap-4">
              {load.value.data.findings.map((f) => (
                <FindingCard key={`${f.id}:${f.status}`} finding={f} timezone={timezone} onChanged={changed} />
              ))}
            </div>
          ))}
      </section>
    </div>
  );
}
