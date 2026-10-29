import { useState } from 'react';
import type { ApprovalCard as Approval, DecisionResult } from '../../domain/action-center/approvals';
import { api, errorKey } from '../../lib/api-client';
import { formatDateTime, formatRupiah } from '../../lib/format';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useT } from '../../lib/use-t';
import { InvoiceStatusBadge } from '../billing/status';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';

const TOOL_LABEL: Record<string, MessageKey> = { mark_invoice_sent: 'toolMarkInvoiceSent', finalize_document: 'toolFinalizeDocument' };

/**
 * One risky action waiting for a person (BR-M08-04): what it is, the record it touches, the exact arguments that will
 * run, who it is for and until when. Approve runs it through the same service as the manual button; the outcome, including
 * "the data changed, not carried out", is shown in place.
 */
export function ApprovalCard({ approval, timezone, onDecided }: { approval: Jsonify<Approval>; timezone: string; onDecided: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<DecisionResult | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      setOutcome(await api<DecisionResult>('POST', `/api/approvals/${approval.id}/decide`, { decision }));
      onDecided();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const target = approval.target;
  return (
    <article className="flex flex-col gap-3 rounded-input border border-warm/60 bg-paper p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-base font-semibold text-ink">{TOOL_LABEL[approval.tool] ? t(TOOL_LABEL[approval.tool]) : approval.tool}</h3>
        {approval.aiRunId && <Badge tone="accent">{t('apByAi')}</Badge>}
      </header>
      <p className="m-0 text-sm text-ink-2">{approval.rationale}</p>

      {target && (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted">{t('apTarget')}</span>
          <a href={`/app/invoice/${target.invoiceId}`} className="font-medium text-ink no-underline hover:text-accent">{target.number ?? t('factDraftNumber')}</a>
          <span className="text-ink-2">{target.clientName}</span>
          <span className="font-mono tabular-nums text-ink">{formatRupiah(target.total)}</span>
          <InvoiceStatusBadge status={target.status} />
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">{t('apArgs')}</span>
        <code className="block overflow-x-auto rounded bg-paper-2 px-3 py-2 font-mono text-xs whitespace-pre text-ink">{JSON.stringify(approval.args, null, 2)}</code>
      </div>

      <p className="m-0 text-xs text-muted">
        {approval.requestedForName ? `${t('apFor', { name: approval.requestedForName })} · ` : ''}
        {t('apExpires', { when: formatDateTime(approval.expiresAt, timezone) })}
      </p>

      {outcome ? (
        <p role="status" className={`m-0 text-sm ${outcome.executed ? 'text-success' : outcome.reason ? 'text-danger' : 'text-ink'}`}>
          {outcome.executed ? t('apDone') : outcome.reason ? t('apRefused', { reason: outcome.reason }) : t('apRejected')}
        </p>
      ) : approval.canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <ConfirmButton variant="primary" busy={busy} onConfirm={() => decide('approve')}>{t('apApprove')}</ConfirmButton>
          <Button size="sm" onClick={() => decide('reject')} disabled={busy}>{t('apReject')}</Button>
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">{t('apNoRight')}</p>
      )}
      {error ? <p role="alert" className="m-0 text-sm text-danger">{t(errorKey(error))}</p> : null}
    </article>
  );
}
