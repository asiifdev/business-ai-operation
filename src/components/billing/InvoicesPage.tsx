import { useEffect, useState } from 'react';
import type { InvoiceRow } from '../../domain/billing/invoices';
import { api, errorKey } from '../../lib/api-client';
import { formatDate, formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { SelectMenu } from '../forms/SelectMenu';
import { Icon } from '../shell/Icon';
import { buttonClasses } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';
import { InvoiceStatusBadge } from './status';

type Row = Jsonify<InvoiceRow>;
type Filter = '' | 'draft' | 'sent' | 'paid' | 'void' | 'overdue';

const query = (filter: Filter) => (filter === 'overdue' ? '?overdue=1' : filter ? `?status=${filter}` : '');

/** All invoices, newest first, with a status filter that lives in the URL (so "overdue" can be linked to from the dashboard). */
export function InvoicesPage() {
  const t = useT();
  const [filter, setFilter] = useState<Filter>('');
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setFilter(p.get('overdue') === '1' ? 'overdue' : ((['draft', 'sent', 'paid', 'void'] as const).find((s) => s === p.get('status')) ?? ''));
  }, []);
  const pick = (next: string) => {
    setFilter(next as Filter);
    window.history.replaceState(null, '', `${window.location.pathname}${query(next as Filter)}`);
  };
  const list = useLoad(() => api<{ invoices: Row[] }>('GET', `/api/invoices${query(filter)}`), [filter]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('invoicesTitle')}
        intro={t('invoicesIntro')}
        action={
          <a href="/app/invoice/baru" className={buttonClasses('primary')}>
            <Icon name="plus" className="size-4" />
            {t('newInvoice')}
          </a>
        }
      />
      <Panel aria-busy={list.value.state === 'loading'} className="flex flex-col gap-4">
        <div className="w-full max-w-xs">
          <SelectMenu
            value={filter}
            onChange={pick}
            includeAll={t('all')}
            searchable={false}
            options={[
              { value: 'draft', label: t('invStatusDraft') },
              { value: 'sent', label: t('invStatusSent') },
              { value: 'overdue', label: t('filterOverdue') },
              { value: 'paid', label: t('invStatusPaid') },
              { value: 'void', label: t('invStatusVoid') },
            ]}
          />
        </div>
        {list.value.state === 'loading' && <Skeleton rows={6} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry}>{t(errorKey(list.value.error))}</ErrorBox>}
        {list.value.state === 'ready' && list.value.data.invoices.length === 0 && (
          <EmptyState action={!filter ? <a href="/app/invoice/baru" className={buttonClasses('primary')}>{t('newInvoice')}</a> : undefined}>{filter ? t('noInvoiceMatch') : t('emptyInvoices')}</EmptyState>
        )}
        {list.value.state === 'ready' && list.value.data.invoices.length > 0 && (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[44rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colNumber')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colClient')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colDue')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colTotal')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colBalance')}</th>
                  <th scope="col" className="py-2 font-medium">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {list.value.data.invoices.map((i) => (
                  <tr key={i.id} role="row" className={tbl.row}>
                    <td data-label={t('colNumber')} className={`py-3 pr-3 ${tbl.label}`}>
                      <a href={`/app/invoice/${i.id}`} className="font-mono font-medium text-ink no-underline hover:text-accent">{i.number ?? t('invStatusDraft')}</a>
                      {i.isAiDraft && <span className="ml-2 text-xs text-muted">{t('invAuto')}</span>}
                    </td>
                    <td data-label={t('colClient')} className={`py-3 pr-3 ${tbl.label}`}>
                      <a href={`/app/klien/${i.clientId}`} className="text-ink no-underline hover:text-accent">{i.clientName}</a>
                    </td>
                    <td data-label={t('colDue')} className={`py-3 pr-3 ${tbl.label}`}>{formatDate(i.dueDate)}</td>
                    <td data-label={t('colTotal')} className={`py-3 pr-3 font-mono tabular-nums sm:text-right ${tbl.label}`}>{formatRupiah(i.total)}</td>
                    <td data-label={t('colBalance')} className={`py-3 pr-3 font-mono tabular-nums sm:text-right ${tbl.label}`}>{i.status === 'sent' ? formatRupiah(i.balance) : '—'}</td>
                    <td data-label={t('colStatus')} className={`py-3 ${tbl.label}`}><InvoiceStatusBadge status={i.status} overdue={i.overdue} daysOverdue={i.daysOverdue} /></td>
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
