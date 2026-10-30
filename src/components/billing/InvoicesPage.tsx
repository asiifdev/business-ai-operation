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
import { DataTable } from '../ui/DataTable';
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
    // The status filter is the server's; the table keeps its own search, sort and page in the URL beside it.
    const p = new URLSearchParams(window.location.search);
    p.delete('status');
    p.delete('overdue');
    p.delete('page');
    for (const [k, v] of new URLSearchParams(query(next as Filter).slice(1))) p.set(k, v);
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
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
        {list.value.state === 'loading' && <Skeleton rows={6} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry}>{t(errorKey(list.value.error))}</ErrorBox>}
        {list.value.state === 'ready' && list.value.data.invoices.length === 0 && !filter && (
          <EmptyState action={<a href="/app/invoice/baru" className={buttonClasses('primary')}>{t('newInvoice')}</a>}>{t('emptyInvoices')}</EmptyState>
        )}
        {list.value.state === 'ready' && (list.value.data.invoices.length > 0 || filter) && (
          <DataTable
            label={t('invoicesTitle')}
            rows={list.value.data.invoices}
            rowKey={(i) => i.id}
            search={(i) => `${i.number ?? ''} ${i.clientName}`}
            emptyMatch={() => t('noInvoiceMatch')}
            minWidth="44rem"
            toolbar={
              <div className="w-full sm:w-52">
                <SelectMenu
                  size="sm"
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
            }
            columns={[
              {
                id: 'number',
                header: t('colNumber'),
                sortValue: (i) => i.number,
                cell: (i) => (
                  <>
                    <a href={`/app/invoice/${i.id}`} className="font-mono font-medium text-ink no-underline hover:text-accent">{i.number ?? t('invStatusDraft')}</a>
                    {i.isAiDraft && <span className="ml-2 text-xs text-muted">{t('invAuto')}</span>}
                  </>
                ),
              },
              { id: 'client', header: t('colClient'), sortValue: (i) => i.clientName, cell: (i) => <a href={`/app/klien/${i.clientId}`} className="text-ink no-underline hover:text-accent">{i.clientName}</a> },
              { id: 'due', header: t('colDue'), sortValue: (i) => i.dueDate, cell: (i) => formatDate(i.dueDate) },
              { id: 'total', header: t('colTotal'), align: 'right', sortValue: (i) => i.total, cell: (i) => <span className="font-mono tabular-nums">{formatRupiah(i.total)}</span> },
              { id: 'balance', header: t('colBalance'), align: 'right', sortValue: (i) => (i.status === 'sent' ? i.balance : null), cell: (i) => <span className="font-mono tabular-nums">{i.status === 'sent' ? formatRupiah(i.balance) : '—'}</span> },
              { id: 'status', header: t('colStatus'), cell: (i) => <InvoiceStatusBadge status={i.status} overdue={i.overdue} daysOverdue={i.daysOverdue} /> },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
