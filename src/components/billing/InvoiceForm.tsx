import { useMemo, useState, type FormEvent } from 'react';
import { addDays } from '../../domain/billing/dates';
import type { BillingFormOptions } from '../../domain/billing/invoices';
import { calculateTotals } from '../../domain/billing/money';
import { api, badFields, errorKey } from '../../lib/api-client';
import { formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { DateInput } from '../forms/DateInput';
import { FormField } from '../forms/FormField';
import { MoneyInput } from '../forms/MoneyInput';
import { NumberInput } from '../forms/NumberInput';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Icon } from '../shell/Icon';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';

type Options = Jsonify<BillingFormOptions>;
interface Line {
  key: number;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
}
export interface InvoiceValues {
  clientId: string;
  dueDate: string;
  notes: string;
  items: { description: string; quantity: number; unitPrice: number }[];
}

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, description: '', quantity: 1, unitPrice: null });

/** Loads what the form offers (clients, tax rate), then shows the form. Used for a new invoice and for editing a draft. */
export function InvoiceForm({ initial, invoiceId, presetClientId }: { initial?: InvoiceValues; invoiceId?: string; presetClientId?: string }) {
  const t = useT();
  const options = useLoad(() => api<Options>('GET', '/api/billing/options'), []);
  if (options.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={5} /></Panel>;
  if (options.value.state === 'error') return <Panel><ErrorBox onRetry={options.retry}>{t(errorKey(options.value.error))}</ErrorBox></Panel>;
  return <Form options={options.value.data} initial={initial} invoiceId={invoiceId} presetClientId={presetClientId} />;
}

function Form({ options, initial, invoiceId, presetClientId }: { options: Options; initial?: InvoiceValues; invoiceId?: string; presetClientId?: string }) {
  const t = useT();
  const editing = Boolean(invoiceId);
  const [clientId, setClientId] = useState(initial?.clientId ?? presetClientId ?? '');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? addDays(options.today, 14));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() => (initial ? initial.items.map((i) => ({ key: nextKey++, ...i })) : [blank()]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);

  const totals = useMemo(() => {
    const usable = lines.filter((l) => l.quantity && l.quantity > 0 && l.unitPrice !== null).map((l) => ({ description: l.description, quantity: l.quantity!, unitPrice: l.unitPrice! }));
    try {
      return calculateTotals(usable, options.taxRateBps);
    } catch {
      return null; // an absurd figure: the server will explain
    }
  }, [lines, options.taxRateBps]);

  const setLine = (key: number, patch: Partial<Line>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const items = lines.map((l) => ({ description: l.description, quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0 }));
      if (editing) {
        await api('PATCH', `/api/invoices/${invoiceId}`, { dueDate, notes, items });
        window.location.assign(`/app/invoice/${invoiceId}`);
      } else {
        const created = await api<{ id: string }>('POST', '/api/invoices', { clientId, dueDate, notes, items });
        window.location.assign(`/app/invoice/${created.id}`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const generic = error && !Object.keys(bad).length ? t(errorKey(error)) : null;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {!editing && <PageHeader title={t('newInvoice')} intro={t('draftNote')} />}
      <Panel className="flex max-w-3xl flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('fClient')} required error={bad.clientId ? t('errValidation') : null}>
            <SelectMenu value={clientId} onChange={setClientId} disabled={editing} placeholder={t('choose')} options={options.clients.map((c) => ({ value: c.id, label: c.name }))} error={Boolean(bad.clientId)} />
          </FormField>
          <FormField label={t('fDueDate')} required help={t('dueDateHelp')} error={bad.dueDate ? t('errValidation') : null}>
            <DateInput value={dueDate} onChange={setDueDate} />
          </FormField>
        </div>
        {options.clients.length === 0 && <p className="m-0 text-sm text-muted">{t('noClientsForBilling')}</p>}
      </Panel>

      <Panel className="flex flex-col gap-4" aria-label={t('itemsTitle')}>
        <h2 className="m-0 text-lg font-semibold text-ink">{t('itemsTitle')}</h2>
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {lines.map((l, i) => (
            <li key={l.key} className="grid gap-3 border-t border-rule pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[1fr_7rem_11rem_auto] sm:items-end">
              <FormField label={t('fItemDesc')} required error={bad[`items.${i}.description`] ? t('errValidation') : null}>
                <TextInput value={l.description} onChange={(e) => setLine(l.key, { description: e.currentTarget.value })} maxLength={300} autoComplete="off" />
              </FormField>
              <FormField label={t('fItemQty')} error={bad[`items.${i}.quantity`] ? t('errValidation') : null}>
                <NumberInput value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} min={1} max={100000} />
              </FormField>
              <FormField label={t('fItemPrice')} error={bad[`items.${i}.unitPrice`] ? t('errValidation') : null}>
                <MoneyInput value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v })} min={0} />
              </FormField>
              <Button size="sm" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))} disabled={lines.length === 1} aria-label={`${t('removeItem')} ${i + 1}`}>
                <Icon name="close" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button size="sm" onClick={() => setLines((all) => [...all, blank()])} disabled={lines.length >= 50}>
            <Icon name="plus" className="size-4" />
            {t('addItem')}
          </Button>
        </div>
        <dl className="m-0 ml-auto flex w-full max-w-xs flex-col gap-1.5 border-t border-rule pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted">{t('subtotalLabel')}</dt><dd className="m-0 font-mono tabular-nums">{formatRupiah(totals?.subtotal ?? 0)}</dd></div>
          {options.taxRateBps > 0 && (
            <div className="flex justify-between"><dt className="text-muted">{t('taxLabel', { rate: String(options.taxRateBps / 100) })}</dt><dd className="m-0 font-mono tabular-nums">{formatRupiah(totals?.taxAmount ?? 0)}</dd></div>
          )}
          <div className="flex justify-between text-base font-semibold"><dt>{t('totalLabel')}</dt><dd className="m-0 font-mono tabular-nums">{formatRupiah(totals?.total ?? 0)}</dd></div>
          {options.taxRateBps > 0 && <p className="m-0 text-xs text-muted">{t('taxNote')}</p>}
        </dl>
      </Panel>

      <Panel className="flex max-w-3xl flex-col gap-4">
        <FormField label={t('fInvoiceNotes')} help={t('invoiceNotesHelp')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.currentTarget.value)} rows={3} maxLength={2000} />
        </FormField>
      </Panel>

      {generic && <p role="alert" className="m-0 text-danger">{generic}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={!editing && !clientId}>{editing ? t('saveChanges') : t('saveDraft')}</Button>
        <a href={editing ? `/app/invoice/${invoiceId}` : '/app/invoice'} className="text-ink-2 no-underline hover:text-ink">{t('cancel')}</a>
      </div>
    </form>
  );
}
