import { useEffect, useState, type FormEvent } from 'react';
import type { BillingFormOptions } from '../../domain/billing/invoices';
import type { SubscriptionRow } from '../../domain/billing/subscriptions';
import { api, badFields, errorKey } from '../../lib/api-client';
import { formatDate, formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { DateInput } from '../forms/DateInput';
import { FormField } from '../forms/FormField';
import { MoneyInput } from '../forms/MoneyInput';
import { NumberInput } from '../forms/NumberInput';
import { SelectMenu } from '../forms/SelectMenu';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';

type Row = Jsonify<SubscriptionRow>;
type Options = Jsonify<BillingFormOptions>;

/** Who pays what, how often, and when it is next due. New invoices are prepared from these. */
export function SubscriptionsPage() {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const list = useLoad(() => api<{ subscriptions: Row[] }>('GET', '/api/subscriptions'), []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') setAdding(true);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('subsTitle')}
        intro={t('subsIntro')}
        action={
          <Button variant="primary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            <Icon name="plus" className="size-4" />
            {t('newSubscription')}
          </Button>
        }
      />
      {adding && (
        <Panel aria-label={t('newSubscription')}>
          <NewSubscription onDone={(id) => window.location.assign(`/app/langganan/${id}`)} onCancel={() => setAdding(false)} />
        </Panel>
      )}
      <Panel aria-busy={list.value.state === 'loading'} className="flex flex-col gap-4">
        {list.value.state === 'loading' && <Skeleton rows={5} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry}>{t(errorKey(list.value.error))}</ErrorBox>}
        {list.value.state === 'ready' && list.value.data.subscriptions.length === 0 && <EmptyState action={<Button variant="primary" onClick={() => setAdding(true)}>{t('newSubscription')}</Button>}>{t('emptySubs')}</EmptyState>}
        {list.value.state === 'ready' && list.value.data.subscriptions.length > 0 && (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[40rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colClient')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colPlan')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colAmount')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colNextDue')}</th>
                  <th scope="col" className="py-2 font-medium">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody className={tbl.tbody}>
                {list.value.data.subscriptions.map((s) => (
                  <tr key={s.id} role="row" className={tbl.row}>
                    <td data-label={t('colClient')} className={`py-3 pr-3 ${tbl.label}`}>
                      <a href={`/app/langganan/${s.id}`} className="font-medium text-ink no-underline hover:text-accent">{s.clientName}</a>
                    </td>
                    <td data-label={t('colPlan')} className={`py-3 pr-3 ${tbl.label}`}>{s.productName} · {s.packageName}</td>
                    <td data-label={t('colAmount')} className={`py-3 pr-3 sm:text-right ${tbl.label}`}>
                      <span className="font-mono tabular-nums">{formatRupiah(s.amount)}</span>
                      <span className="block text-xs text-muted">{t('everyMonths', { n: s.intervalMonths })}</span>
                    </td>
                    <td data-label={t('colNextDue')} className={`py-3 pr-3 ${tbl.label}`}>{s.status === 'active' ? formatDate(s.nextDueDate) : '—'}</td>
                    <td data-label={t('colStatus')} className={`py-3 ${tbl.label}`}><Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{t(s.status === 'active' ? 'subStatusActive' : 'subStatusStopped')}</Badge></td>
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

function NewSubscription({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const options = useLoad(() => api<Options>('GET', '/api/billing/options'), []);
  if (options.value.state === 'loading') return <Skeleton rows={3} />;
  if (options.value.state === 'error') return <ErrorBox onRetry={options.retry}>{t(errorKey(options.value.error))}</ErrorBox>;
  return <SubscriptionForm options={options.value.data} onDone={onDone} onCancel={onCancel} />;
}

function SubscriptionForm({ options, onDone, onCancel }: { options: Options; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const [clientId, setClientId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [interval, setIntervalMonths] = useState<number | null>(1);
  const [amount, setAmount] = useState<number | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);
  const [startedOn, setStartedOn] = useState(options.today);
  const [nextDueDate, setNextDueDate] = useState(options.today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);
  const price = options.packages.find((p) => p.id === packageId)?.monthlyPrice;

  // Until the amount is typed by hand, it follows the package price and the interval (price is per month).
  useEffect(() => {
    if (!amountTouched && price !== undefined) setAmount(price * (interval ?? 1));
  }, [price, interval, amountTouched]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('POST', '/api/subscriptions', { clientId, packageId, amount: amount ?? undefined, intervalMonths: interval ?? 1, startedOn, nextDueDate });
      onDone(created.id);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fClient')} required error={bad.clientId ? t('errValidation') : null}>
          <SelectMenu value={clientId} onChange={setClientId} placeholder={t('choose')} options={options.clients.map((c) => ({ value: c.id, label: c.name }))} />
        </FormField>
        <FormField label={t('fSubPackage')} required error={bad.packageId ? t('errValidation') : null}>
          <SelectMenu value={packageId} onChange={setPackageId} placeholder={t('choose')} options={options.packages.map((p) => ({ value: p.id, label: p.label, description: formatRupiah(p.monthlyPrice) }))} />
        </FormField>
        <FormField label={t('fSubInterval')} required error={bad.intervalMonths ? t('errValidation') : null}>
          <NumberInput value={interval} onChange={setIntervalMonths} min={1} max={60} />
        </FormField>
        <FormField label={t('fSubAmount')} required help={t('subAmountHelp')} error={bad.amount ? t('errValidation') : null}>
          <MoneyInput value={amount} onChange={(v) => (setAmountTouched(true), setAmount(v))} min={0} />
        </FormField>
        <FormField label={t('fSubStart')} error={bad.startedOn ? t('errValidation') : null}>
          <DateInput value={startedOn} onChange={setStartedOn} />
        </FormField>
        <FormField label={t('fSubNextDue')} help={t('subNextDueHelp')} error={bad.nextDueDate ? t('errValidation') : null}>
          <DateInput value={nextDueDate} onChange={setNextDueDate} />
        </FormField>
      </div>
      {error && !Object.keys(bad).length ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={!clientId || !packageId}>{t('add')}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}
