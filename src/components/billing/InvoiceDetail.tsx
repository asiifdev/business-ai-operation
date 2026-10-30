import { useState, type FormEvent } from 'react';
import type { getInvoice } from '../../domain/billing/invoices';
import { api, badFields, errorKey } from '../../lib/api-client';
import { AUDIT_LABEL } from '../../lib/audit-labels';
import { formatDate, formatDateTime, formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { Checkbox } from '../forms/Checkbox';
import { DateInput } from '../forms/DateInput';
import { FormField } from '../forms/FormField';
import { MoneyInput } from '../forms/MoneyInput';
import { SelectMenu } from '../forms/SelectMenu';
import { TextInput } from '../forms/TextInput';
import { Icon } from '../shell/Icon';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Dropdown } from '../ui/Dropdown';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import { toast } from '../ui/Toast';
import { Steps, type StepItem } from '../ui/Steps';
import * as tbl from '../ui/table';
import { InvoiceForm } from './InvoiceForm';
import { InvoiceStatusBadge, PAYMENT_METHODS } from './status';

type Detail = Jsonify<Awaited<ReturnType<typeof getInvoice>>>;

/** One invoice: what it says, what has been paid, what can still be done with it, and what happened to it. */
export function InvoiceDetail({ id, timezone }: { id: string; timezone: string }) {
  const t = useT();
  const load = useLoad(() => api<Detail>('GET', `/api/invoices/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  async function act(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setActionError(null);
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

  const { invoice, client, items, payments, derived, timeline, today } = load.value.data;
  const draft = invoice.status === 'draft';
  const sent = invoice.status === 'sent';

  if (editing && draft) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="m-0 text-2xl font-semibold text-ink">{t('invDraftTitle')}</h1>
        <InvoiceForm invoiceId={id} initial={{ clientId: invoice.clientId, dueDate: invoice.dueDate, notes: invoice.notes ?? '', items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })) }} />
      </div>
    );
  }

  const message = t(derived.overdue ? 'msgOverdue' : 'msgDue', { name: client.contactName ?? client.name, number: invoice.number ?? '', total: formatRupiah(derived.balance || invoice.total), due: formatDate(invoice.dueDate) });
  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      toast(t('copied'));
    } catch {
      toast(t('copyBlocked'), 'danger');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <a href="/app/invoice" className="w-fit text-sm text-accent no-underline hover:underline">{t('navInvoices')}</a>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 flex flex-wrap items-center gap-3 font-mono text-2xl font-semibold text-ink lg:text-3xl">
              {invoice.number ?? t('invDraftTitle')}
              <span className="font-sans text-base font-normal"><InvoiceStatusBadge status={invoice.status} overdue={derived.overdue} daysOverdue={derived.daysOverdue} /></span>
            </h1>
            <p className="mt-1 mb-0 text-muted"><a href={`/app/klien/${client.id}`} className="text-ink no-underline hover:text-accent">{client.name}</a></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown
              items={[
                { id: 'pdf', href: `/api/invoices/${id}/pdf`, download: true, label: <><Icon name="invoice" className="size-4" />{t('downloadPdf')}</> },
                ...(sent || draft ? [{ id: 'copy', onSelect: () => void copyMessage(), label: t('copyMessage') }] : []),
              ]}
            />
            {draft && <Button size="sm" onClick={() => setEditing(true)}>{t('edit')}</Button>}
            {draft && <ConfirmButton message={t('cfmSendInvoice')} variant="primary" busy={busy} onConfirm={() => act(() => api('POST', `/api/invoices/${id}/send`))}>{t('markSent')}</ConfirmButton>}
            {draft && <ConfirmButton message={t('cfmDeleteInvoice')} variant="danger" busy={busy} onConfirm={() => act(() => api('DELETE', `/api/invoices/${id}`), () => window.location.assign('/app/invoice'))}>{t('deleteDraft')}</ConfirmButton>}
          </div>
        </div>
        {draft && <p className="m-0 text-sm text-muted">{invoice.isAiDraft ? `${t('aiDraftBanner')} ` : ''}{t('markSentHelp')}</p>}
        {!draft && invoice.status !== 'void' && <p className="m-0 text-sm text-muted">{t('invoiceLocked')}</p>}
        {invoice.status === 'void' && <p className="m-0 text-sm text-danger">{t('invoiceVoidReason', { reason: invoice.voidReason ?? '' })}</p>}
        {actionError ? <p role="alert" className="m-0 text-danger">{t(errorKey(actionError))}</p> : null}
        {invoice.status !== 'void' && <Steps orientation="horizontal" label={t('invLifecycle')} steps={lifecycle(invoice.status, derived.overdue, t)} className="max-w-xl pt-2" />}
      </header>

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
                {items.map((i) => (
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
          {invoice.notes && <p className="m-0 border-t border-rule pt-3 text-sm text-ink-2">{invoice.notes}</p>}
        </Panel>

        <Panel className="flex min-w-0 flex-col gap-3" aria-label={t('totalLabel')}>
          <Row label={t('invIssued')} value={invoice.issueDate ? formatDate(invoice.issueDate) : '—'} />
          <Row label={t('fDueDate')} value={formatDate(invoice.dueDate)} />
          <hr className="m-0 border-rule" />
          <Row label={t('subtotalLabel')} value={formatRupiah(invoice.subtotal)} mono />
          {invoice.taxRateBps > 0 && <Row label={t('taxLabel', { rate: String(invoice.taxRateBps / 100) })} value={formatRupiah(invoice.taxAmount)} mono />}
          <Row label={t('totalLabel')} value={formatRupiah(invoice.total)} mono strong />
          {(sent || derived.paid > 0) && <Row label={t('paidSoFar')} value={formatRupiah(derived.paid)} mono />}
          {sent && <Row label={t('balanceDue')} value={formatRupiah(derived.balance)} mono strong tone={derived.overdue ? 'text-danger' : undefined} />}
        </Panel>
      </div>

      <Panel className="flex flex-col gap-4" aria-label={t('paymentsTitle')}>
        <h2 className="m-0 text-lg font-semibold text-ink">{t('paymentsTitle')}</h2>
        {payments.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t('paymentsEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[32rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('fPayDate')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colStatus')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('fPayMethod')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('fPayRef')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('fPayAmount')}</th>
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {payments.map((p) => (
                  <tr key={p.id} role="row" className={tbl.row}>
                    <td data-label={t('fPayDate')} className={`py-3 pr-3 ${tbl.label}`}>{formatDate(p.paidOn)}</td>
                    <td data-label={t('colStatus')} className={`py-3 pr-3 ${tbl.label}`}>{p.kind === 'correction' ? <span className="text-danger">{t('payKindCorrection')}</span> : t('payKindPayment')}</td>
                    <td data-label={t('fPayMethod')} className={`py-3 pr-3 ${tbl.label}`}>{methodLabel(p.method, t)}</td>
                    <td data-label={t('fPayRef')} className={`py-3 pr-3 text-ink-2 ${tbl.label}`}>{[p.reference, p.note].filter(Boolean).join(' · ') || '—'}</td>
                    <td data-label={t('fPayAmount')} className={`py-3 font-mono tabular-nums sm:text-right ${tbl.label} ${p.kind === 'correction' ? 'text-danger' : ''}`}>{p.kind === 'correction' ? '−' : ''}{formatRupiah(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="m-0 text-xs text-muted">{t('payAppendOnlyNote')}</p>
        {sent && <PaymentForm invoiceId={id} balance={derived.balance} paid={derived.paid} today={today} onDone={() => load.reload()} />}
        {sent && <CancelForm onCancel={(reason) => act(() => api('POST', `/api/invoices/${id}/cancel`, { reason }))} busy={busy} blocked={derived.paid > 0} />}
      </Panel>

      {timeline && timeline.length > 0 && (
        <Panel className="flex flex-col gap-3" aria-label={t('timelineTitle')}>
          <h2 className="m-0 text-lg font-semibold text-ink">{t('timelineTitle')}</h2>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {timeline.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="text-ink">{AUDIT_LABEL[e.action] ? t(AUDIT_LABEL[e.action]) : e.action}</span>
                <span className="text-muted">{formatDateTime(e.at, timezone)}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}

function methodLabel(method: string, t: ReturnType<typeof useT>) {
  const known = PAYMENT_METHODS.find((m) => m.value === method);
  return known ? t(known.label) : method;
}

function Row({ label, value, mono, strong, tone }: { label: string; value: string; mono?: boolean; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className={`${mono ? 'font-mono tabular-nums' : ''} ${strong ? 'text-base font-semibold' : ''} ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  );
}

function PaymentForm({ invoiceId, balance, paid, today, onDone }: { invoiceId: string; balance: number; paid: number; today: string; onDone: () => void }) {
  const t = useT();
  const [correction, setCorrection] = useState(false);
  const [amount, setAmount] = useState<number | null>(balance);
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/api/invoices/${invoiceId}/payments`, { kind: correction ? 'correction' : 'payment', amount: amount ?? 0, paidOn, method, reference, note });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4 border-t border-rule pt-4">
      <h3 className="m-0 text-base font-semibold text-ink">{t('recordPayment')}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fPayAmount')} required error={bad.amount ? t('errValidation') : null}>
          <MoneyInput value={amount} onChange={setAmount} min={1} />
        </FormField>
        <FormField label={t('fPayDate')} required error={bad.paidOn ? t('errValidation') : null}>
          <DateInput value={paidOn} onChange={setPaidOn} max={today} />
        </FormField>
        <FormField label={t('fPayMethod')} required>
          <SelectMenu value={method} onChange={setMethod} searchable={false} options={PAYMENT_METHODS.map((m) => ({ value: m.value, label: t(m.label) }))} />
        </FormField>
        <FormField label={t('fPayRef')}>
          <TextInput value={reference} onChange={(e) => setReference(e.currentTarget.value)} maxLength={120} autoComplete="off" />
        </FormField>
      </div>
      <FormField label={t('fPayNote')}>
        <TextInput value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={500} autoComplete="off" />
      </FormField>
      {paid > 0 && <Checkbox label={t('payIsCorrection')} checked={correction} onChange={setCorrection} />}
      {error && !Object.keys(bad).length ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      <div>
        <Button type="submit" variant="primary" loading={busy}>{t('recordPayment')}</Button>
      </div>
    </form>
  );
}

function CancelForm({ onCancel, busy, blocked }: { onCancel: (reason: string) => void; busy: boolean; blocked: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (blocked) return null; // money is on it: correct the payments first
  if (!open) return <div><Button size="sm" variant="danger" onClick={() => setOpen(true)}>{t('cancelInvoice')}</Button></div>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCancel(reason);
      }}
      noValidate
      className="flex max-w-xl flex-col gap-3 border-t border-rule pt-4"
    >
      <FormField label={t('cancelReason')} required help={t('cancelReasonHelp')}>
        <TextInput value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} autoComplete="off" />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={busy} disabled={reason.trim().length < 3}>{t('cancelInvoice')}</Button>
        <Button onClick={() => setOpen(false)} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}

/**
 * Where the invoice is in its life: draft, sent, paid. Read from the stored status only (code decides it, never the AI);
 * an overdue sent invoice says so under the step. A voided invoice shows its reason instead.
 */
function lifecycle(status: 'draft' | 'sent' | 'paid' | 'void', overdue: boolean, t: ReturnType<typeof useT>): StepItem[] {
  const order = ['draft', 'sent', 'paid'] as const;
  const at = order.indexOf(status as (typeof order)[number]);
  const label = { draft: t('invStatusDraft'), sent: t('invStatusSent'), paid: t('invStatusPaid') };
  return order.map((s, i) => ({
    id: s,
    label: label[s],
    status: i < at || (s === 'paid' && status === 'paid') ? 'done' : i === at ? 'current' : 'upcoming',
    note: i === at && overdue ? t('invOverdueStep') : undefined,
  }));
}
