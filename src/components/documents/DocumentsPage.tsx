import { useState } from 'react';
import type { DocumentRow } from '../../domain/documents/service';
import { api, errorKey } from '../../lib/api-client';
import { formatDate, formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { SelectMenu } from '../forms/SelectMenu';
import { Icon } from '../shell/Icon';
import { buttonClasses } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { DocumentStatusBadge, KIND_LABEL } from './status';

type Row = Jsonify<DocumentRow>;

/** Proposals, quotations and minutes: the latest version of each, with filters by type and state. */
export function DocumentsPage({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams();
  if (kind) qs.set('kind', kind);
  if (status) qs.set('status', status);
  const list = useLoad(() => api<{ documents: Row[] }>('GET', `/api/documents${qs.size ? `?${qs}` : ''}`), [kind, status]);
  const newLink = canWrite ? (
    <a href="/app/dokumen/baru" className={buttonClasses('primary')}>
      <Icon name="plus" className="size-4" />
      {t('newDocument')}
    </a>
  ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('docTitle')} intro={t('docIntro')} action={newLink} />
      <Panel aria-busy={list.value.state === 'loading'} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:max-w-lg sm:grid-cols-2">
          <SelectMenu value={kind} onChange={setKind} includeAll={t('docColKind')} searchable={false} options={(['proposal', 'quotation', 'minutes'] as const).map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))} />
          <SelectMenu value={status} onChange={setStatus} includeAll={t('colStatus')} searchable={false} options={[{ value: 'draft', label: t('docStatusDraft') }, { value: 'final', label: t('docStatusFinal') }]} />
        </div>
        {list.value.state === 'loading' && <Skeleton rows={6} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry}>{t(errorKey(list.value.error))}</ErrorBox>}
        {list.value.state === 'ready' && list.value.data.documents.length === 0 && <EmptyState action={!kind && !status ? newLink : undefined}>{kind || status ? t('noDocumentMatch') : t('emptyDocuments')}</EmptyState>}
        {list.value.state === 'ready' && list.value.data.documents.length > 0 && (
          <DataTable
            label={t('docTitle')}
            rows={list.value.data.documents}
            rowKey={(d) => d.id}
            search={(d) => `${d.title} ${d.number ?? ''} ${d.clientName ?? ''} ${d.leadName ?? ''}`}
            minWidth="46rem"
            columns={[
              {
                id: 'title',
                header: t('docColTitle'),
                sortValue: (d) => d.title,
                full: true,
                cell: (d) => (
                  <>
                    <a href={`/app/dokumen/${d.id}`} className="font-medium text-ink no-underline hover:text-accent">{d.title}</a>
                    <span className="ml-2 font-mono text-xs text-muted">{d.number ?? ''}{d.version > 1 ? ` · ${t('docVersionN', { n: d.version })}` : ''}</span>
                  </>
                ),
              },
              { id: 'kind', header: t('docColKind'), sortValue: (d) => t(KIND_LABEL[d.kind]), cell: (d) => t(KIND_LABEL[d.kind]) },
              { id: 'for', header: t('docColFor'), sortValue: (d) => d.clientName ?? d.leadName, cell: (d) => d.clientName ?? d.leadName ?? '—' },
              { id: 'total', header: t('colTotal'), align: 'right', sortValue: (d) => (d.kind === 'minutes' ? null : d.total), cell: (d) => <span className="font-mono tabular-nums">{d.kind === 'minutes' ? '—' : formatRupiah(d.total)}</span> },
              { id: 'valid', header: t('docColValid'), sortValue: (d) => d.validUntil, cell: (d) => (d.validUntil ? formatDate(d.validUntil) : '—') },
              { id: 'status', header: t('colStatus'), cell: (d) => <DocumentStatusBadge status={d.status} aiDraft={d.isAiDraft} /> },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
