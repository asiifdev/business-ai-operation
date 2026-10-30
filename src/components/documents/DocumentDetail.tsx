import { AuditTimeline } from '../audit/AuditTimeline';
import { useState } from 'react';
import type { DocumentDetail as Detail } from '../../domain/documents/service';
import { api, errorKey } from '../../lib/api-client';
import { formatDate, formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Textarea } from '../forms/Textarea';
import { Icon } from '../shell/Icon';
import { Button, buttonClasses } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';
import { DocumentForm } from './DocumentForm';
import { DocumentStatusBadge, KIND_LABEL } from './status';

type Doc = Jsonify<Detail>;
type Narrative = { ok: true; narrative: string } | { ok: false; message: string };

/** One document: its words, its priced lines, and what can still be done with it. A final document is read-only. */
export function DocumentDetail({ id, canWrite, canFinalize, timezone, canSeeHistory = false }: { id: string; canWrite: boolean; canFinalize: boolean; timezone: string; /** Owner and Admin (`audit.read`) see the change history. */ canSeeHistory?: boolean }) {
  const t = useT();
  const load = useLoad(() => api<Doc>('GET', `/api/documents/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      if (after) after();
      else await load.reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (load.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={6} /></Panel>;
  if (load.value.state === 'error') return <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>;

  const d = load.value.data;
  const draft = d.status === 'draft';
  const priced = d.kind !== 'minutes';
  const latest = d.versions[d.versions.length - 1]?.id === d.id;
  const narrative = text ?? d.narrative ?? '';

  if (editing && draft && priced) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="m-0 text-2xl font-semibold text-ink">{d.title}</h1>
        <DocumentForm documentId={id} initial={{ title: d.title, validUntil: d.validUntil ?? '', lines: d.items.map((i) => ({ packageId: i.packageId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })) }} />
      </div>
    );
  }

  async function aiNarrative() {
    await act(async () => {
      const r = await api<Narrative>('POST', `/api/documents/${id}/narrative`);
      if (!r.ok) setNotice(r.message);
      else setText(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <a href="/app/dokumen" className="w-fit text-sm text-accent no-underline hover:underline">{t('docBack')}</a>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 flex flex-wrap items-center gap-3 text-2xl font-semibold text-ink lg:text-3xl">
              {d.title}
              <span className="font-sans text-base font-normal"><DocumentStatusBadge status={d.status} aiDraft={d.isAiDraft} /></span>
            </h1>
            <p className="mt-1 mb-0 text-muted">
              {t(KIND_LABEL[d.kind])}
              {d.number ? <span className="font-mono"> · {d.number}</span> : null}
              {d.version > 1 ? ` · ${t('docVersionN', { n: d.version })}` : ''}
              {d.clientName ? <> · <a href={`/app/klien/${d.clientId}`} className="text-ink no-underline hover:text-accent">{d.clientName}</a></> : d.leadName ? <> · <a href={`/app/lead/${d.leadId}`} className="text-ink no-underline hover:text-accent">{d.leadName}</a></> : null}
              {d.meetingId && d.meetingTitle ? <> · <a href={`/app/rapat/${d.meetingId}`} className="text-ink no-underline hover:text-accent">{t('docFromMeeting', { title: d.meetingTitle })}</a></> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/documents/${id}/pdf`} download className={buttonClasses('secondary', 'sm')}>
              <Icon name="invoice" className="size-4" />
              {t('downloadPdf')}
            </a>
            {draft && canWrite && priced && <Button size="sm" onClick={() => setEditing(true)}>{t('edit')}</Button>}
            {draft && canFinalize && <ConfirmButton message={t('cfmFinalize')} variant="primary" busy={busy} onConfirm={() => act(() => api('POST', `/api/documents/${id}/finalize`))}>{t('docFinalize')}</ConfirmButton>}
            {!draft && canWrite && latest && <ConfirmButton message={t('cfmRevise')} variant="secondary" busy={busy} onConfirm={() => act(async () => { const r = await api<{ id: string }>('POST', `/api/documents/${id}/revise`); window.location.assign(`/app/dokumen/${r.id}`); }, () => undefined)}>{t('docRevise')}</ConfirmButton>}
            {draft && canWrite && priced && <ConfirmButton message={t('cfmDeleteDraft')} variant="danger" busy={busy} onConfirm={() => act(() => api('DELETE', `/api/documents/${id}`), () => window.location.assign('/app/dokumen'))}>{t('deleteDraft')}</ConfirmButton>}
          </div>
        </div>
        {draft ? <p className="m-0 text-sm text-muted">{d.isAiDraft ? `${t('aiDraftBanner')} ` : ''}{t('docFinalizeHelp')}</p> : <p className="m-0 text-sm text-muted">{t('docLocked')} {latest && canWrite ? t('docReviseHelp') : ''}</p>}
        {notice && <p role="status" className="m-0 text-sm text-warm-ink">{notice}</p>}
        {actionError ? <p role="alert" className="m-0 text-danger">{t(errorKey(actionError))}</p> : null}
      </header>

      <Panel className="flex min-w-0 flex-col gap-3" aria-label={t('docNarrative')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('docNarrative')}</h2>
          {draft && canWrite && priced && <Button size="sm" onClick={aiNarrative} loading={busy}>{busy ? t('docDraftNarrativeBusy') : t('docDraftNarrative')}</Button>}
        </div>
        {draft && canWrite ? (
          <>
            <Textarea value={narrative} onChange={(e) => setText(e.currentTarget.value)} rows={8} maxLength={20000} aria-label={t('docNarrative')} />
            <p className="m-0 text-xs text-muted">{t('docNarrativeHelp')}</p>
            <div>
              <Button size="sm" variant="primary" loading={busy} disabled={text === null} onClick={() => act(() => api('PATCH', `/api/documents/${id}`, { narrative: text }), () => { setText(null); void load.reload(); })}>{t('docSaveNarrative')}</Button>
            </div>
          </>
        ) : d.narrative ? (
          <div className="max-w-prose whitespace-pre-line text-ink [overflow-wrap:anywhere]">{d.narrative}</div>
        ) : (
          <p className="m-0 text-sm text-muted">{t('docNarrativeEmpty')}</p>
        )}
      </Panel>

      {priced && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel className="flex min-w-0 flex-col gap-4 lg:col-span-2" aria-label={t('itemsTitle')}>
            <h2 className="m-0 text-lg font-semibold text-ink">{t('itemsTitle')}</h2>
            <div className="overflow-x-auto">
              <table role="table" className={tbl.table + ' sm:min-w-[30rem]'}>
                <thead className={tbl.thead}>
                  <tr className="text-left text-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">{t('fItemDesc')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t('fItemQty')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t('fItemPrice')}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t('colAmount')}</th>
                  </tr>
                </thead>
                <tbody className={tbl.tbody}>
                  {d.items.map((i) => (
                    <tr key={i.id} role="row" className={tbl.row}>
                      <td data-label={t('fItemDesc')} className={`py-3 pr-3 ${tbl.label} ${tbl.full}`}>{i.description}</td>
                      <td data-label={t('fItemQty')} className={`py-3 pr-3 font-mono tabular-nums sm:text-right ${tbl.label}`}>{i.quantity}</td>
                      <td data-label={t('fItemPrice')} className={`py-3 pr-3 font-mono tabular-nums sm:text-right ${tbl.label}`}>{formatRupiah(i.unitPrice)}</td>
                      <td data-label={t('colAmount')} className={`py-3 font-mono tabular-nums sm:text-right ${tbl.label}`}>{formatRupiah(i.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel className="flex min-w-0 flex-col gap-3" aria-label={t('totalLabel')}>
            <Row label={t('docColValid')} value={d.validUntil ? formatDate(d.validUntil) : '—'} />
            <hr className="m-0 border-rule" />
            <Row label={t('subtotalLabel')} value={formatRupiah(d.subtotal)} mono />
            {d.taxRateBps > 0 && <Row label={t('taxLabel', { rate: String(d.taxRateBps / 100) })} value={formatRupiah(d.taxAmount)} mono />}
            <Row label={t('totalLabel')} value={formatRupiah(d.total)} mono strong />
          </Panel>
        </div>
      )}

      {d.versions.length > 1 && (
        <Panel className="flex flex-col gap-3" aria-label={t('docVersions')}>
          <h2 className="m-0 text-lg font-semibold text-ink">{t('docVersions')}</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {d.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3">
                {v.id === d.id ? <span className="font-medium text-ink">{t('docVersionN', { n: v.version })}</span> : <a href={`/app/dokumen/${v.id}`} className="text-accent no-underline hover:underline">{t('docVersionN', { n: v.version })}</a>}
                <span className="font-mono text-muted">{v.number ?? ''}</span>
                <DocumentStatusBadge status={v.status} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {canSeeHistory && <AuditTimeline entityType="document" entityId={id} timezone={timezone} />}
    </div>
  );
}

function Row({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? 'text-base font-semibold text-ink' : 'text-sm'}`}>
      <span className="text-muted">{label}</span>
      <span className={mono ? 'font-mono tabular-nums' : ''}>{value}</span>
    </div>
  );
}
