import { useState, type FormEvent } from 'react';
import type { getSubscription } from '../../domain/billing/subscriptions';
import { api, badFields, errorKey } from '../../lib/api-client';
import { formatDate, formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { MoneyInput } from '../forms/MoneyInput';
import { NumberInput } from '../forms/NumberInput';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';
import { InvoiceStatusBadge } from './status';

type Detail = Jsonify<Awaited<ReturnType<typeof getSubscription>>>;

/** One subscription: its terms, the invoices made from it, and the two things a manager can do: change the terms or stop it. */
export function SubscriptionDetail({ id }: { id: string }) {
  const t = useT();
  const load = useLoad(() => api<Detail>('GET', `/api/subscriptions/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);

  if (load.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={5} /></Panel>;
  if (load.value.state === 'error') return <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>;
  const { subscription: s, stoppedOn, invoices } = load.value.data;
  const active = s.status === 'active';

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/api/subscriptions/${id}/stop`);
      await load.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <a href="/app/langganan" className="w-fit text-sm text-accent no-underline hover:underline">{t('navSubscriptions')}</a>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 flex flex-wrap items-center gap-3 text-2xl font-semibold text-ink lg:text-3xl">
              {s.clientName}
              <Badge tone={active ? 'success' : 'neutral'}>{t(active ? 'subStatusActive' : 'subStatusStopped')}</Badge>
            </h1>
            <p className="mt-1 mb-0 text-muted">{s.productName} · {s.packageName}</p>
          </div>
          {active && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>{t('editSubscription')}</Button>
              <ConfirmButton variant="danger" busy={busy} onConfirm={stop}>{t('stopSubscription')}</ConfirmButton>
            </div>
          )}
        </div>
        {!active && stoppedOn && <p className="m-0 text-sm text-muted">{t('subStoppedNote', { date: formatDate(stoppedOn) })}</p>}
        {error ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      </header>

      <Panel className="grid gap-4 sm:grid-cols-3" aria-label={t('subsTitle')}>
        <Fact label={t('colAmount')} value={formatRupiah(s.amount)} note={t('everyMonths', { n: s.intervalMonths })} />
        <Fact label={t('colNextDue')} value={active ? formatDate(s.nextDueDate) : '—'} />
        <Fact label={t('fSubStart')} value={formatDate(load.value.data.startedOn)} />
      </Panel>

      {editing && active && (
        <Panel aria-label={t('editSubscription')}>
          <EditTerms id={id} amount={s.amount} interval={s.intervalMonths} onDone={() => (setEditing(false), load.reload())} onCancel={() => setEditing(false)} />
        </Panel>
      )}

      <Panel className="flex flex-col gap-4" aria-label={t('subInvoicesTitle')}>
        <h2 className="m-0 text-lg font-semibold text-ink">{t('subInvoicesTitle')}</h2>
        {invoices.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t('emptyInvoices')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[28rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colNumber')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colDue')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colTotal')}</th>
                  <th scope="col" className="py-2 font-medium">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {invoices.map((i) => (
                  <tr key={i.id} role="row" className={tbl.row}>
                    <td data-label={t('colNumber')} className={`py-3 pr-3 ${tbl.label}`}><a href={`/app/invoice/${i.id}`} className="font-mono font-medium text-ink no-underline hover:text-accent">{i.number ?? t('invStatusDraft')}</a></td>
                    <td data-label={t('colDue')} className={`py-3 pr-3 ${tbl.label}`}>{formatDate(i.dueDate)}</td>
                    <td data-label={t('colTotal')} className={`py-3 pr-3 font-mono tabular-nums sm:text-right ${tbl.label}`}>{formatRupiah(i.total)}</td>
                    <td data-label={t('colStatus')} className={`py-3 ${tbl.label}`}><InvoiceStatusBadge status={i.status} /></td>
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

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="m-0 text-sm text-muted">{label}</p>
      <p className="m-0 mt-1 font-mono text-xl font-semibold tabular-nums text-ink">{value}</p>
      {note && <p className="m-0 text-xs text-muted">{note}</p>}
    </div>
  );
}

function EditTerms({ id, amount, interval, onDone, onCancel }: { id: string; amount: number; interval: number; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [a, setA] = useState<number | null>(amount);
  const [i, setI] = useState<number | null>(interval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('PATCH', `/api/subscriptions/${id}`, { amount: a ?? 0, intervalMonths: i ?? 1 });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fSubAmount')} required help={t('subAmountHelp')} error={bad.amount ? t('errValidation') : null}>
          <MoneyInput value={a} onChange={setA} min={0} />
        </FormField>
        <FormField label={t('fSubInterval')} required error={bad.intervalMonths ? t('errValidation') : null}>
          <NumberInput value={i} onChange={setI} min={1} max={60} />
        </FormField>
      </div>
      {error && !Object.keys(bad).length ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>{t('saveChanges')}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}
