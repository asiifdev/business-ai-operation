import { AuditTimeline } from '../audit/AuditTimeline';
import { useState, type FormEvent } from 'react';
import type { LeadRow } from '../../domain/pipeline/leads';
import type { ClientRow } from '../../domain/portfolio/clients';
import type { Stage } from '../../domain/pipeline/stages';
import { api, ApiError, errorKey } from '../../lib/api-client';
import { formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { TextInput } from '../forms/TextInput';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import { LeadForm, leadPayload, type LeadValues } from './LeadForm';
import { STAGE_LABEL, STAGE_TONE } from './stages';

type Role = 'owner' | 'admin' | 'staff';
type Lead = Jsonify<LeadRow & { assigneeName: string | null }>;

/** One lead: its details, where it can go next, and the manager-only steps (accept, convert, reopen, archive). */
export function LeadDetail({ id, role, timezone }: { id: string; role: Role; timezone: string }) {
  const t = useT();
  const isManager = role !== 'staff';
  const load = useLoad(() => api<Lead>('GET', `/api/leads/${id}`), [id]);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [askLost, setAskLost] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [reopening, setReopening] = useState(false);
  const [reopenNote, setReopenNote] = useState('');
  const [nameTaken, setNameTaken] = useState(false);

  async function act(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      if (after) after();
      else await load.reload();
    } catch (err) {
      setActionError(err);
      if (err instanceof ApiError && err.code === 'duplicate') setNameTaken(true);
    } finally {
      setBusy(false);
    }
  }

  if (load.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={6} /></Panel>;
  if (load.value.state === 'error') return <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>;

  const lead = load.value.data;
  const closed = lead.stage === 'won' || lead.stage === 'lost';
  const move = (to: Stage, reason?: string) => act(() => api('POST', `/api/leads/${id}/move`, { to, ...(reason ? { lostReason: reason } : {}) }), () => { setAskLost(false); setLostReason(''); void load.reload(); });
  const initial: LeadValues = {
    name: lead.name,
    contactName: lead.contactName ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    source: lead.source ?? '',
    needsSummary: lead.needsSummary ?? '',
    estimatedValue: lead.estimatedValue,
    assignedTo: lead.assignedTo ?? '',
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <a href="/app/pipeline" className="w-fit text-sm text-accent underline underline-offset-4">{t('leadBack')}</a>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="m-0 flex min-w-0 flex-wrap items-center gap-3 text-2xl font-semibold text-ink lg:text-3xl">
            <span className="[overflow-wrap:anywhere]">{lead.name}</span>
            <Badge tone={STAGE_TONE[lead.stage]}>{t(STAGE_LABEL[lead.stage])}</Badge>
            {lead.isDraft && <Badge tone="accent">{t('leadAiDraft')}</Badge>}
            {lead.isStagnant && <Badge tone="warn">{t('leadStalled')}</Badge>}
            {lead.archivedAt && <Badge>{t('archivedBadge')}</Badge>}
          </h1>
          {isManager && (
            <ConfirmButton busy={busy} onConfirm={() => act(() => api('POST', `/api/leads/${id}/archive`, { archived: !lead.archivedAt }))}>{lead.archivedAt ? t('restore') : t('archive')}</ConfirmButton>
          )}
        </div>
        {lead.stage === 'lost' && lead.lostReason && <p className="m-0 text-muted">{t('leadLostBecause', { reason: lead.lostReason })}</p>}
        <p className="m-0 text-sm text-muted">{t('fAssignee')}: {lead.assigneeName ?? t('taskAssigneeNone')}</p>
        {!closed && !lead.isDraft && <p className="m-0 text-sm text-muted">{t('leadDaysInStage', { days: lead.daysInStage })}</p>}
        {actionError != null && <p role="alert" className="m-0 text-danger">{t(errorKey(actionError))}</p>}
      </header>

      {lead.isDraft && (
        <Panel aria-label={t('leadAiDraft')} className="flex flex-col items-start gap-3">
          <p className="m-0 text-ink">{t('leadAcceptHelp')}</p>
          {isManager && <Button variant="primary" loading={busy} onClick={() => act(() => api('POST', `/api/leads/${id}/accept`))}>{t('leadAccept')}</Button>}
        </Panel>
      )}

      {lead.nextStages.length > 0 && (
        <Panel aria-label={t('pipelineTitle')} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {lead.nextStages.map((to) => (
              <Button key={to} variant={to === 'lost' ? 'danger' : 'secondary'} disabled={busy} onClick={() => (to === 'lost' ? setAskLost(true) : void move(to))}>
                {t('leadMoveTo', { stage: t(STAGE_LABEL[to]) })}
              </Button>
            ))}
          </div>
          {askLost && (
            <form className="flex max-w-xl flex-col gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); if (lostReason.trim()) void move('lost', lostReason.trim()); }}>
              <FormField label={t('leadLostReason')} required>
                <TextInput value={lostReason} onChange={(e) => setLostReason(e.currentTarget.value)} maxLength={500} required autoComplete="off" />
              </FormField>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" loading={busy} disabled={!lostReason.trim()}>{t('leadMarkLost')}</Button>
                <Button onClick={() => setAskLost(false)} disabled={busy}>{t('cancel')}</Button>
              </div>
            </form>
          )}
        </Panel>
      )}

      {!closed && !lead.archivedAt && !lead.isDraft && isManager && (
        <Panel aria-label={t('docCreateProposal')} className="flex flex-wrap items-center gap-3">
          <a href={`/app/dokumen/baru?leadId=${id}`} className={buttonClasses('secondary', 'sm')}>{t('docCreateProposal')}</a>
        </Panel>
      )}

      {lead.stage === 'won' && isManager && (
        <Panel aria-label={t('leadConvert')} className="flex flex-col items-start gap-3">
          {lead.convertedClientId ? (
            <>
              <p className="m-0 text-ink">{t('leadConverted')}</p>
              <a href={`/app/klien/${lead.convertedClientId}`} className="text-accent underline underline-offset-4">{t('leadOpenClient')}</a>
            </>
          ) : (
            <>
              <p className="m-0 max-w-prose text-ink">{t('leadConvertHelp')}</p>
              <ConfirmButton variant="primary" busy={busy} onConfirm={() => act(() => api<{ clientId: string }>('POST', `/api/leads/${id}/convert`, { confirm: true, mode: 'create' }).then((r) => window.location.assign(`/app/klien/${r.clientId}`)), () => undefined)}>{t('leadConvert')}</ConfirmButton>
              {nameTaken && <LinkExisting leadId={id} name={lead.name} />}
            </>
          )}
        </Panel>
      )}

      {closed && !lead.convertedClientId && isManager && (
        <Panel aria-label={t('leadReopen')} className="flex flex-col items-start gap-3">
          {!reopening ? (
            <Button onClick={() => setReopening(true)}>{t('leadReopen')}</Button>
          ) : (
            <form className="flex w-full max-w-xl flex-col gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); if (reopenNote.trim()) void act(() => api('POST', `/api/leads/${id}/reopen`, { note: reopenNote.trim() }), () => { setReopening(false); setReopenNote(''); void load.reload(); }); }}>
              <FormField label={t('leadReopenNote')} required>
                <TextInput value={reopenNote} onChange={(e) => setReopenNote(e.currentTarget.value)} maxLength={500} required autoComplete="off" />
              </FormField>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={busy} disabled={!reopenNote.trim()}>{t('leadReopen')}</Button>
                <Button onClick={() => setReopening(false)} disabled={busy}>{t('cancel')}</Button>
              </div>
            </form>
          )}
        </Panel>
      )}

      <Panel aria-label={t('leadDetails')} className="flex flex-col gap-4">
        {editing && !lead.archivedAt ? (
          <LeadForm initial={initial} submitLabel={t('save')} request={(v) => api('PATCH', `/api/leads/${id}`, leadPayload(v))} onDone={() => { setEditing(false); void load.reload(); }} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <dl className="m-0 grid gap-4 sm:grid-cols-2">
              <Field label={t('fContact')} value={lead.contactName} />
              <Field label={t('fEmail')} value={lead.email} />
              <Field label={t('fPhone')} value={lead.phone} />
              <Field label={t('fSource')} value={lead.source} />
              <Field label={t('fEstimatedValue')} value={lead.estimatedValue != null ? formatRupiah(lead.estimatedValue) : null} />
              <div className="sm:col-span-2"><Field label={t('fNeeds')} value={lead.needsSummary} /></div>
            </dl>
            {!lead.archivedAt && <Button className="w-fit" onClick={() => setEditing(true)}>{t('edit')}</Button>}
          </>
        )}
      </Panel>
      {isManager && <AuditTimeline entityType="lead" entityId={id} timezone={timezone} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  const t = useT();
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="m-0 mt-0.5 whitespace-pre-line text-ink [overflow-wrap:anywhere]">{value || t('noValue')}</dd>
    </div>
  );
}

/** The client name is taken: offer the clients with that name so the lead can be linked to one instead of duplicated (BR-M04-05). */
function LinkExisting({ leadId, name }: { leadId: string; name: string }) {
  const t = useT();
  const matches = useLoad(() => api<{ clients: Array<Jsonify<ClientRow>> }>('GET', `/api/clients?${new URLSearchParams({ q: name })}`), [name]);
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function link() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/api/leads/${leadId}/convert`, { confirm: true, mode: 'link', clientId });
      window.location.assign(`/app/klien/${clientId}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (matches.value.state !== 'ready') return null;
  return (
    <div className="flex max-w-xl flex-col gap-3" role="group" aria-label={t('leadLinkClient')}>
      <p className="m-0 text-ink">{t('leadNameTaken')}</p>
      <SelectMenu options={matches.value.data.clients.map((c) => ({ value: c.id, label: c.name }))} value={clientId} onChange={setClientId} placeholder={t('choose')} />
      <Button className="w-fit" variant="primary" loading={busy} disabled={!clientId} onClick={() => void link()}>{t('leadLinkClient')}</Button>
      {error != null && <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p>}
    </div>
  );
}
