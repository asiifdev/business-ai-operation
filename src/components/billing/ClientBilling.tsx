import type { InvoiceRow } from '../../domain/billing/invoices';
import type { SubscriptionRow } from '../../domain/billing/subscriptions';
import { formatDate, formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { buttonClasses } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { InvoiceStatusBadge } from './status';

/** The billing part of the client page: what this client subscribes to and its latest invoices. Managers only. */
export function ClientBilling({ clientId, subscriptions, invoices }: { clientId: string; subscriptions: Jsonify<SubscriptionRow>[]; invoices: Jsonify<InvoiceRow>[] }) {
  const t = useT();
  return (
    <Panel className="flex flex-col gap-5" aria-label={t('clientBillingTitle')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('clientBillingTitle')}</h2>
        <div className="flex flex-wrap gap-2">
          <a href="/app/langganan?new=1" className={buttonClasses('secondary', 'sm')}>{t('newSubscription')}</a>
          <a href={`/app/invoice/baru?clientId=${clientId}`} className={buttonClasses('secondary', 'sm')}>
            <Icon name="plus" className="size-4" />
            {t('invoiceForClient')}
          </a>
        </div>
      </div>

      <section className="flex flex-col gap-2" aria-label={t('clientSubsTitle')}>
        <h3 className="m-0 text-sm font-medium text-muted">{t('clientSubsTitle')}</h3>
        {subscriptions.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t('emptyClientSubs')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {subscriptions.map((s) => (
              <li key={s.id} className="border-t border-rule first:border-t-0">
                <a href={`/app/langganan/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm no-underline">
                  <span className="min-w-0 flex-1 text-ink">{s.productName} · {s.packageName}</span>
                  <span className="font-mono tabular-nums text-ink">{formatRupiah(s.amount)}</span>
                  <span className="text-xs text-muted">{t('everyMonths', { n: s.intervalMonths })}</span>
                  {s.status === 'active' ? <span className="text-xs text-muted">{t('colNextDue')}: {formatDate(s.nextDueDate)}</span> : <Badge>{t('subStatusStopped')}</Badge>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label={t('clientInvoicesTitle')}>
        <h3 className="m-0 text-sm font-medium text-muted">{t('clientInvoicesTitle')}</h3>
        {invoices.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t('emptyClientInvoices')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {invoices.map((i) => (
              <li key={i.id} className="border-t border-rule first:border-t-0">
                <a href={`/app/invoice/${i.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm no-underline">
                  <span className="font-mono font-medium text-ink">{i.number ?? t('invStatusDraft')}</span>
                  <span className="text-xs text-muted">{formatDate(i.dueDate)}</span>
                  <span className="ml-auto font-mono tabular-nums text-ink">{formatRupiah(i.total)}</span>
                  <InvoiceStatusBadge status={i.status} overdue={i.overdue} daysOverdue={i.daysOverdue} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Panel>
  );
}
