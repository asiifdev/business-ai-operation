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
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';
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
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[46rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('docColTitle')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('docColKind')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('docColFor')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colTotal')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('docColValid')}</th>
                  <th scope="col" className="py-2 font-medium">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {list.value.data.documents.map((d) => (
                  <tr key={d.id} role="row" className={tbl.row}>
                    <td data-label={t('docColTitle')} className={`py-3 pr-3 ${tbl.label} ${tbl.full}`}>
                      <a href={`/app/dokumen/${d.id}`} className="font-medium text-ink no-underline hover:text-accent">{d.title}</a>
                      <span className="ml-2 font-mono text-xs text-muted">{d.number ?? ''}{d.version > 1 ? ` · ${t('docVersionN', { n: d.version })}` : ''}</span>
                    </td>
                    <td data-label={t('docColKind')} className={`py-3 pr-3 ${tbl.label}`}>{t(KIND_LABEL[d.kind])}</td>
                    <td data-label={t('docColFor')} className={`py-3 pr-3 ${tbl.label}`}>{d.clientName ?? d.leadName ?? '—'}</td>
                    <td data-label={t('colTotal')} className={`py-3 pr-3 font-mono tabular-nums sm:text-right ${tbl.label}`}>{d.kind === 'minutes' ? '—' : formatRupiah(d.total)}</td>
                    <td data-label={t('docColValid')} className={`py-3 pr-3 ${tbl.label}`}>{d.validUntil ? formatDate(d.validUntil) : '—'}</td>
                    <td data-label={t('colStatus')} className={`py-3 ${tbl.label}`}><DocumentStatusBadge status={d.status} aiDraft={d.isAiDraft} /></td>
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
