import { useState } from 'react';
import type { FindingRule, PriorityLevel } from '../../domain/action-center/facts';
import type { ExplainResult } from '../../domain/action-center/explain';
import type { FindingCard as Finding } from '../../domain/action-center/findings';
import { api, errorKey } from '../../lib/api-client';
import { formatDate, formatDateTime, formatRupiah } from '../../lib/format';
import { getLocale, type MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useT } from '../../lib/use-t';
import { InvoiceStatusBadge } from '../billing/status';
import { STAGE_LABEL } from '../pipeline/stages';
import { KIND_LABEL, TaskBadges } from '../tasks/labels';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';

type Card = Jsonify<Finding>;

export const RULE_LABEL: Record<FindingRule, MessageKey> = {
  invoice_overdue: 'ruleInvoiceOverdue',
  invoice_draft_ready: 'ruleInvoiceDraftReady',
  renewal_upcoming: 'ruleRenewalUpcoming',
  task_late: 'ruleTaskLate',
  lead_stagnant: 'ruleLeadStagnant',
  deployment_outdated: 'ruleDeploymentOutdated',
  deployment_down: 'ruleDeploymentDown',
};
const PRIORITY: Record<PriorityLevel, { label: MessageKey; tone: 'danger' | 'warn' | 'neutral' }> = {
  high: { label: 'prioHigh', tone: 'danger' },
  medium: { label: 'prioMedium', tone: 'warn' },
  low: { label: 'prioLow', tone: 'neutral' },
};
const CLOSED_LABEL = { handled: 'findStatusHandled', ignored: 'findStatusIgnored', auto_resolved: 'findStatusAuto' } as const;
const SNOOZE_DAYS = ['1', '3', '7'] as const;
const OPEN_LABEL = { invoice: 'openInvoice', subscription: 'openSubscription', task: 'openTask', lead: 'openLead', deployment: 'openClient', missing: 'openInvoice' } as const satisfies Record<Card['facts']['kind'], MessageKey>;

/**
 * One finding (BRD-M08 section 4): the facts read live from the record, the AI explanation saved once and labelled, the
 * client message draft that is never sent from here, and the person's own buttons. Every figure on the card comes from
 * the data, not from the model (BR-M08-03); when AI is unavailable the card works the same, labelled "not an AI result".
 */
export function FindingCard({ finding, timezone, onChanged }: { finding: Card; timezone: string; onChanged: () => void }) {
  const t = useT();
  const [card, setCard] = useState(finding);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [aiFailed, setAiFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(finding.draftMessage ?? '');
  const [days, setDays] = useState<string>('1');
  const [copied, setCopied] = useState(false);
  const open = card.status === 'new' || card.status === 'snoozed';

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const explain = (force: boolean) =>
    run('explain', async () => {
      setAiFailed(null);
      const out = await api<Jsonify<ExplainResult>>('POST', `/api/findings/${card.id}/explain`, { force, locale: getLocale() });
      setCard(out.card);
      setDraft(out.card.draftMessage ?? '');
      if (!out.ok) setAiFailed(out.message ?? t('aiExplainFailed'));
      if (out.pendingApprovals.length > 0) onChanged(); // a proposal joined the approval queue
    });

  const move = (body: { action: 'handle' | 'ignore' } | { action: 'snooze'; days: number }) =>
    run(body.action, async () => {
      await api('POST', `/api/findings/${card.id}/status`, body);
      onChanged();
    });

  const saveDraft = () =>
    run('draft', async () => {
      await api('PATCH', `/api/findings/${card.id}`, { draftMessage: draft });
      setCard({ ...card, draftMessage: draft.trim() || null });
      setEditing(false);
    });

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(card.draftMessage ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard can be blocked; the text is still on screen to copy by hand. */
    }
  }

  const prio = PRIORITY[card.priority.level];
  return (
    <Panel className="flex flex-col gap-4" aria-label={t(RULE_LABEL[card.rule])}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="m-0 text-lg font-semibold text-ink">{t(RULE_LABEL[card.rule])}</h3>
          <Facts card={card} timezone={timezone} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open && <Badge tone={prio.tone}>{t(prio.label)}</Badge>}
          {card.status === 'snoozed' && card.snoozedUntil && <Badge>{t('findStatusSnoozed', { date: formatDateTime(card.snoozedUntil, timezone) })}</Badge>}
          {!open && <Badge tone={card.status === 'handled' ? 'success' : 'neutral'}>{t(CLOSED_LABEL[card.status as keyof typeof CLOSED_LABEL])}</Badge>}
        </div>
      </header>

      <section className="flex flex-col gap-2 border-t border-rule pt-3" aria-label={t('aiExplainTitle')}>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="m-0 text-sm font-semibold text-ink">{t('aiExplainTitle')}</h4>
          {card.explanation && card.aiRunId ? <Badge tone="accent">{t('aiAssistedLabel')}</Badge> : <Badge>{t('notAiLabel')}</Badge>}
        </div>
        {card.explanation ? <p className="m-0 max-w-prose text-sm whitespace-pre-line text-ink-2">{card.explanation}</p> : <p className="m-0 text-sm text-muted">{t('aiExplainNone')}</p>}
        {aiFailed && <p role="status" className="m-0 text-sm text-warm-ink">{aiFailed}</p>}
        {open && (
          <div>
            <Button size="sm" loading={busy === 'explain'} disabled={busy !== null} onClick={() => explain(Boolean(card.explanation))}>
              {card.explanation ? t('aiExplainAgain') : t('aiExplainRun')}
            </Button>
          </div>
        )}
      </section>

      {(card.draftMessage || editing) && (
        <section className="flex flex-col gap-2 border-t border-rule pt-3" aria-label={t('draftTitle')}>
          {editing ? (
            <FormField label={t('draftTitle')} help={t('draftHelp')}>
              <Textarea value={draft} onChange={(e) => setDraft(e.currentTarget.value)} maxLength={2000} rows={5} counter />
            </FormField>
          ) : (
            <>
              <h4 className="m-0 text-sm font-semibold text-ink">{t('draftTitle')}</h4>
              <p className="m-0 max-w-prose rounded bg-paper-2 px-3 py-2 text-sm whitespace-pre-line text-ink">{card.draftMessage}</p>
              <p className="m-0 text-xs text-muted">{t('draftHelp')}</p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button size="sm" variant="primary" loading={busy === 'draft'} onClick={saveDraft}>{t('save')}</Button>
                <Button size="sm" onClick={() => { setDraft(card.draftMessage ?? ''); setEditing(false); }} disabled={busy !== null}>{t('cancel')}</Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={copyDraft}>{copied ? t('copied') : t('copyMessage')}</Button>
                {open && <Button size="sm" onClick={() => setEditing(true)}>{t('editDraft')}</Button>}
              </>
            )}
          </div>
        </section>
      )}

      {open ? (
        <footer className="flex flex-wrap items-end gap-3 border-t border-rule pt-3">
          <Button size="sm" variant="primary" loading={busy === 'handle'} disabled={busy !== null} onClick={() => move({ action: 'handle' })}>{t('markHandled')}</Button>
          <div className="flex items-end gap-2">
            <FormField label={t('snoozeFor')} className="w-40">
              <SelectMenu size="sm" searchable={false} value={days} onChange={setDays} options={SNOOZE_DAYS.map((d) => ({ value: d, label: d === '1' ? t('snoozeTomorrow') : t('snoozeDays', { n: d }) }))} />
            </FormField>
            <Button size="sm" loading={busy === 'snooze'} disabled={busy !== null} onClick={() => move({ action: 'snooze', days: Number(days) })}>{t('snooze')}</Button>
          </div>
          <ConfirmButton message={t('cfmIgnoreFinding')} busy={busy === 'ignore'} disabled={busy !== null} onConfirm={() => move({ action: 'ignore' })}>{t('ignore')}</ConfirmButton>
          {card.href && <a href={card.href} className="ml-auto text-sm text-accent no-underline hover:underline">{t(OPEN_LABEL[card.facts.kind])}</a>}
        </footer>
      ) : (
        <footer className="flex flex-wrap items-center gap-3 border-t border-rule pt-3 text-sm text-muted">
          {card.resolvedAt && <span>{t('findClosedOn', { when: formatDateTime(card.resolvedAt, timezone) })}</span>}
          {card.href && <a href={card.href} className="ml-auto text-accent no-underline hover:underline">{t(OPEN_LABEL[card.facts.kind])}</a>}
        </footer>
      )}
      {error ? <p role="alert" className="m-0 text-sm text-danger">{t(errorKey(error))}</p> : null}
    </Panel>
  );
}

/** The figures of the card, straight from the record (BR-M08-03). */
function Facts({ card, timezone }: { card: Card; timezone: string }) {
  const t = useT();
  const f = card.facts;
  if (f.kind === 'missing') return <p className="m-0 text-sm text-muted">{t('factMissing')}</p>;
  if (f.kind === 'task') {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <a href={`/app/task/${f.taskId}`} className="font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{f.title}</a>
          {f.clientId && f.clientName && <a href={`/app/klien/${f.clientId}`} className="text-ink-2 no-underline hover:text-accent">{f.clientName}</a>}
          <TaskBadges task={{ status: f.status, priority: f.priority, isDraft: f.isDraft, late: f.late, daysLate: f.daysLate }} />
        </p>
        <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1">
          <Fact label={t('fKind')} value={t(KIND_LABEL[f.taskKind])} mono={false} />
          {f.dueDate && <Fact label={t('fDueDate')} value={formatDate(f.dueDate)} />}
          <Fact label={t('factAssignee')} value={f.assigneeName ?? t('factNoAssignee')} mono={false} />
        </dl>
      </div>
    );
  }
  if (f.kind === 'deployment') {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <a href={`/app/klien/${f.clientId}`} className="font-medium text-ink no-underline hover:text-accent">{f.clientName}</a>
          <span className="text-ink-2">{f.productName}</span>
          <Badge>{f.environment}</Badge>
          {card.rule === 'deployment_down' && <Badge tone={f.uptimeState === 'down' ? 'danger' : 'success'}>{t(f.uptimeState === 'down' ? 'uptimeDown' : 'uptimeUp')}</Badge>}
        </p>
        <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1">
          {f.domain && <Fact label={t('colDomain')} value={f.domain} />}
          {card.rule === 'deployment_outdated' && f.behindBy != null && <Fact label={t('factBehindBy')} value={t('factCommits', { n: f.behindBy })} mono={false} />}
          {card.rule === 'deployment_outdated' && f.branch && <Fact label={t('factBranch')} value={f.branch} />}
          {card.rule === 'deployment_down' && f.uptimeChangedAt && <Fact label={t('factDownSince')} value={formatDateTime(f.uptimeChangedAt, timezone)} mono={false} />}
        </dl>
      </div>
    );
  }
  if (f.kind === 'lead') {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <a href={`/app/lead/${f.leadId}`} className="font-medium text-ink no-underline hover:text-accent [overflow-wrap:anywhere]">{f.name}</a>
          <Badge>{t(STAGE_LABEL[f.stage])}</Badge>
        </p>
        <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1">
          <Fact label={t('factDaysInStage')} value={t('factDaysOfLimit', { n: f.daysInStage, limit: f.stagnantDays })} mono={false} />
          {f.estimatedValue != null && <Fact label={t('factEstimatedValue')} value={formatRupiah(f.estimatedValue)} />}
          <Fact label={t('factAssignee')} value={f.assigneeName ?? t('factNoAssignee')} mono={false} />
        </dl>
      </div>
    );
  }
  if (f.kind === 'invoice') {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono font-medium text-ink">{f.number ?? t('factDraftNumber')}</span>
          <a href={`/app/klien/${f.clientId}`} className="text-ink-2 no-underline hover:text-accent">{f.clientName}</a>
          <InvoiceStatusBadge status={f.status} overdue={f.overdue} daysOverdue={f.daysOverdue} />
        </p>
        <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1">
          <Fact label={f.status === 'sent' ? t('factBalance') : t('colTotal')} value={formatRupiah(f.status === 'sent' ? f.balance : f.total)} />
          <Fact label={t('fDueDate')} value={formatDate(f.dueDate)} />
        </dl>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
        <a href={`/app/klien/${f.clientId}`} className="font-medium text-ink no-underline hover:text-accent">{f.clientName}</a>
        <span className="text-ink-2">{f.productName} · {f.packageName}</span>
      </p>
      <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1">
        <Fact label={t('colAmount')} value={formatRupiah(f.amount)} />
        <Fact label={t('fDueDate')} value={`${formatDate(f.nextDueDate)} · ${f.daysUntilDue <= 0 ? t('factDueToday') : t('factDueIn', { n: f.daysUntilDue })}`} mono={false} />
      </dl>
    </div>
  );
}

function Fact({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`m-0 text-ink ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</dd>
    </div>
  );
}
