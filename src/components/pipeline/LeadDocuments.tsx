import type { DocumentRow } from '../../domain/documents/service';
import { api, errorKey } from '../../lib/api-client';
import { formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { DocumentStatusBadge, KIND_LABEL } from '../documents/status';
import { buttonClasses } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';

/**
 * The proposals and quotations made for this lead (BRD-M04 section 4, step 2: the Proposal stage is tied to its documents),
 * latest version of each, with the way to make another one while the lead is still open.
 */
export function LeadDocuments({ leadId, canCreate }: { leadId: string; canCreate: boolean }) {
  const t = useT();
  const load = useLoad(() => api<{ documents: Array<Jsonify<DocumentRow>> }>('GET', `/api/documents?${new URLSearchParams({ leadId })}`), [leadId]);
  const docs = load.value.state === 'ready' ? load.value.data.documents.filter((d) => d.kind !== 'minutes') : [];

  return (
    <Panel aria-label={t('leadDocsTitle')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-base font-semibold text-ink">{t('leadDocsTitle')}</h2>
        {canCreate && <a href={`/app/dokumen/baru?leadId=${leadId}`} className={buttonClasses('secondary', 'sm')}>{t('docCreateProposal')}</a>}
      </div>
      {load.value.state === 'loading' && <Skeleton rows={2} />}
      {load.value.state === 'error' && <ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox>}
      {load.value.state === 'ready' && docs.length === 0 && <p className="m-0 text-sm text-muted">{t('leadDocsEmpty')}</p>}
      {docs.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-rule p-0">
          {docs.map((d) => (
            <li key={d.id}>
              <a href={`/app/dokumen/${d.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-ink no-underline hover:text-accent">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="block text-sm text-muted">{t(KIND_LABEL[d.kind])}{d.number ? <span className="font-mono"> · {d.number}</span> : null}{d.version > 1 ? ` · ${t('docVersionN', { n: d.version })}` : ''}</span>
                </span>
                <span className="font-mono text-sm tabular-nums">{formatRupiah(d.total)}</span>
                <DocumentStatusBadge status={d.status} aiDraft={d.isAiDraft} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
