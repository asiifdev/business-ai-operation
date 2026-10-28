import { useState, type DragEvent } from 'react';
import type { LeadRow, PipelineSummary } from '../../domain/pipeline/leads';
import { OPEN_STAGES, type Stage } from '../../domain/pipeline/stages';
import { api, errorKey } from '../../lib/api-client';
import { formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { TextInput } from '../forms/TextInput';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { LeadForm, leadPayload } from './LeadForm';
import { STAGE_LABEL, STAGE_TONE } from './stages';

type Lead = Jsonify<LeadRow>;
type Data = { leads: Lead[]; summary: Jsonify<PipelineSummary> };

/** The pipeline board: one column per open stage, cards that move by drag or by button, and the closed leads below. */
export function PipelinePage() {
  const t = useT();
  const list = useLoad(() => api<Data>('GET', '/api/leads'), []);
  const [adding, setAdding] = useState(false);
  const [moveError, setMoveError] = useState<unknown>(null);
  const [lostFor, setLostFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function move(lead: Lead, to: Stage, lostReason?: string) {
    setBusyId(lead.id);
    setMoveError(null);
    try {
      await api('POST', `/api/leads/${lead.id}/move`, { to, ...(lostReason ? { lostReason } : {}) });
      setLostFor(null);
      await list.reload();
    } catch (err) {
      setMoveError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function accept(lead: Lead) {
    setBusyId(lead.id);
    setMoveError(null);
    try {
      await api('POST', `/api/leads/${lead.id}/accept`);
      await list.reload();
    } catch (err) {
      setMoveError(err);
    } finally {
      setBusyId(null);
    }
  }

  /** Dropping on a column asks for a move; dropping on Lost is not offered because it needs a reason, so it stays a button. */
  function drop(e: DragEvent, stage: Stage, leads: Lead[]) {
    e.preventDefault();
    setOverStage(null);
    const lead = leads.find((l) => l.id === (dragging ?? e.dataTransfer.getData('text/plain')));
    setDragging(null);
    if (lead && lead.stage !== stage) void move(lead, stage);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('pipelineTitle')} intro={t('pipelineIntro')} action={<Button variant="primary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}><Icon name="plus" className="size-4" />{t('newLead')}</Button>} />

      {adding && (
        <Panel aria-label={t('newLead')}>
          <LeadForm submitLabel={t('add')} request={(v) => api('POST', '/api/leads', leadPayload(v))} onDone={() => { setAdding(false); void list.reload(); }} onCancel={() => setAdding(false)} />
        </Panel>
      )}

      {list.value.state === 'loading' && <Panel aria-busy="true"><Skeleton rows={6} /></Panel>}
      {list.value.state === 'error' && <Panel><ErrorBox onRetry={list.retry} /></Panel>}
      {list.value.state === 'ready' && (
        <Board
          data={list.value.data}
          t={t}
          busyId={busyId}
          lostFor={lostFor}
          setLostFor={setLostFor}
          moveError={moveError}
          dragging={dragging}
          setDragging={setDragging}
          overStage={overStage}
          setOverStage={setOverStage}
          onMove={move}
          onAccept={accept}
          onDrop={drop}
          onAdd={() => setAdding(true)}
        />
      )}
    </div>
  );
}

type T = ReturnType<typeof useT>;

interface BoardProps {
  data: Data;
  t: T;
  busyId: string | null;
  lostFor: string | null;
  setLostFor: (id: string | null) => void;
  moveError: unknown;
  dragging: string | null;
  setDragging: (id: string | null) => void;
  overStage: Stage | null;
  setOverStage: (stage: Stage | null) => void;
  onMove: (lead: Lead, to: Stage, lostReason?: string) => void;
  onAccept: (lead: Lead) => void;
  onDrop: (e: DragEvent, stage: Stage, leads: Lead[]) => void;
  onAdd: () => void;
}

function Board({ data, t, busyId, lostFor, setLostFor, moveError, dragging, setDragging, overStage, setOverStage, onMove, onAccept, onDrop, onAdd }: BoardProps) {
  const { leads, summary } = data;
  const active = leads.filter((l) => !l.archivedAt);
  const drafts = active.filter((l) => l.isDraft);
  const closed = active.filter((l) => !l.isDraft && (l.stage === 'won' || l.stage === 'lost'));
  if (active.length === 0) return <Panel><EmptyState action={<Button variant="primary" onClick={onAdd}>{t('newLead')}</Button>}>{t('leadsEmpty')}</EmptyState></Panel>;

  return (
    <>
      <dl className="m-0 grid gap-4 sm:grid-cols-3">
        <Figure label={t('pipelineValue')} value={formatRupiah(summary.value)} />
        <Figure label={t('pipelineStalled')} value={String(summary.stagnant)} />
        <Figure label={t('pipelineDrafts')} value={String(summary.drafts)} />
      </dl>

      {moveError != null && <p role="alert" className="m-0 text-danger">{t(errorKey(moveError))}</p>}
      <p className="m-0 text-sm text-muted">{t('pipelineHint')}</p>

      {drafts.length > 0 && (
        <section aria-label={t('leadAiDraft')} className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('leadAiDraft')}</h2>
          <p className="m-0 text-sm text-muted">{t('leadAcceptHelp')}</p>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4">
            {drafts.map((l) => (
              <LeadCard key={l.id} lead={l} t={t} busy={busyId === l.id} lostFor={lostFor} setLostFor={setLostFor} setDragging={setDragging} onMove={onMove} onAccept={onAccept} />
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {OPEN_STAGES.map((stage) => {
          const inStage = active.filter((l) => !l.isDraft && l.stage === stage);
          const value = summary.perStage.find((s) => s.stage === stage)?.value ?? 0;
          return (
            <section
              key={stage}
              aria-label={t(STAGE_LABEL[stage])}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setOverStage(stage); } }}
              onDragLeave={() => setOverStage(null)}
              onDrop={(e) => onDrop(e, stage, active)}
              className={'flex min-w-0 flex-col gap-3 rounded-card border border-dashed p-3 transition-colors duration-(--duration-micro) ' + (overStage === stage ? 'border-accent bg-paper-2' : 'border-rule')}
            >
              <header className="flex items-baseline justify-between gap-2">
                <h2 className="m-0 text-base font-semibold text-ink">{t(STAGE_LABEL[stage])}</h2>
                <span className="flex items-baseline gap-2 text-sm text-muted tabular-nums"><span>{inStage.length}</span><span>{formatRupiah(value)}</span></span>
              </header>
              {inStage.length === 0 ? (
                <p className="m-0 text-sm text-muted">{t('leadColumnEmpty')}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {inStage.map((l) => (
                    <LeadCard key={l.id} lead={l} t={t} busy={busyId === l.id} lostFor={lostFor} setLostFor={setLostFor} setDragging={setDragging} onMove={onMove} onAccept={onAccept} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {closed.length > 0 && (
        <section aria-label={t('leadClosedTitle')} className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-semibold text-ink">{t('leadClosedTitle')}</h2>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4">
            {closed.map((l) => (
              <LeadCard key={l.id} lead={l} t={t} busy={busyId === l.id} lostFor={lostFor} setLostFor={setLostFor} setDragging={setDragging} onMove={onMove} onAccept={onAccept} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-rule bg-key-face p-4 shadow-soft">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="m-0 mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

interface CardProps {
  lead: Lead;
  t: T;
  busy: boolean;
  lostFor: string | null;
  setLostFor: (id: string | null) => void;
  setDragging: (id: string | null) => void;
  onMove: (lead: Lead, to: Stage, lostReason?: string) => void;
  onAccept: (lead: Lead) => void;
}

function LeadCard({ lead, t, busy, lostFor, setLostFor, setDragging, onMove, onAccept }: CardProps) {
  const [reason, setReason] = useState('');
  const movable = lead.nextStages.length > 0;
  const askingLost = lostFor === lead.id;
  return (
    <li
      draggable={movable}
      onDragStart={(e) => { setDragging(lead.id); e.dataTransfer.setData('text/plain', lead.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => setDragging(null)}
      aria-busy={busy}
      className="flex min-w-0 flex-col gap-2 rounded-card border border-rule bg-key-face p-3 shadow-soft"
    >
      <a href={`/app/lead/${lead.id}`} className="font-medium text-ink no-underline transition-colors hover:text-accent [overflow-wrap:anywhere]">{lead.name}</a>
      <div className="flex flex-wrap items-center gap-1.5">
        {lead.isDraft && <Badge tone="accent">{t('leadAiDraft')}</Badge>}
        {lead.isStagnant && <Badge tone="warn">{t('leadStalled')}</Badge>}
        {(lead.stage === 'won' || lead.stage === 'lost') && <Badge tone={STAGE_TONE[lead.stage]}>{t(STAGE_LABEL[lead.stage])}</Badge>}
      </div>
      <p className="m-0 text-sm text-muted tabular-nums">{lead.estimatedValue != null ? formatRupiah(lead.estimatedValue) : t('noValue')}</p>
      {!lead.isDraft && lead.stage !== 'won' && lead.stage !== 'lost' && <p className="m-0 text-xs text-muted">{t('leadDaysInStage', { days: lead.daysInStage })}</p>}

      {lead.isDraft && <Button size="sm" variant="primary" loading={busy} onClick={() => onAccept(lead)}>{t('leadAccept')}</Button>}

      {movable && !askingLost && (
        <div className="flex flex-wrap gap-1.5">
          {lead.nextStages.map((to) => (
            <Button key={to} size="sm" variant={to === 'lost' ? 'danger' : 'secondary'} disabled={busy} onClick={() => (to === 'lost' ? setLostFor(lead.id) : onMove(lead, to))}>
              {t('leadMoveTo', { stage: t(STAGE_LABEL[to]) })}
            </Button>
          ))}
        </div>
      )}

      {askingLost && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onMove(lead, 'lost', reason.trim()); }}
        >
          <FormField label={t('leadLostReason')} required>
            <TextInput value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} required autoComplete="off" />
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" loading={busy} disabled={!reason.trim()}>{t('leadMarkLost')}</Button>
            <Button size="sm" onClick={() => setLostFor(null)} disabled={busy}>{t('cancel')}</Button>
          </div>
        </form>
      )}
    </li>
  );
}
