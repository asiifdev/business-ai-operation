import { useMemo, useState, type FormEvent } from 'react';
import { calculateTotals } from '../../domain/billing/money';
import type { DocumentOptions } from '../../domain/documents/service';
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
import { TextInput } from '../forms/TextInput';
import { Icon } from '../shell/Icon';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { ErrorBox, Skeleton } from '../ui/states';
import { KIND_LABEL } from './status';

type Options = Jsonify<DocumentOptions>;
type Line =
  | { key: number; type: 'package'; packageId: string; quantity: number | null }
  | { key: number; type: 'custom'; description: string; quantity: number | null; unitPrice: number | null };

export interface DocumentValues {
  title: string;
  validUntil: string;
  lines: Array<{ packageId: string | null; description: string; quantity: number; unitPrice: number }>;
}

let nextKey = 1;

/** Creates a draft proposal or quotation, or edits a draft's title, validity and lines. Prices of package lines are only shown here: the server copies them. */
export function DocumentForm({ documentId, initial, presetLeadId, presetClientId }: { documentId?: string; initial?: DocumentValues; presetLeadId?: string; presetClientId?: string }) {
  const t = useT();
  const options = useLoad(() => api<Options>('GET', '/api/documents/options'), []);
  if (options.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={5} /></Panel>;
  if (options.value.state === 'error') return <Panel><ErrorBox onRetry={options.retry}>{t(errorKey(options.value.error))}</ErrorBox></Panel>;
  return <Form options={options.value.data} documentId={documentId} initial={initial} presetLeadId={presetLeadId} presetClientId={presetClientId} />;
}

function Form({ options, documentId, initial, presetLeadId, presetClientId }: { options: Options; documentId?: string; initial?: DocumentValues; presetLeadId?: string; presetClientId?: string }) {
  const t = useT();
  const taxRateBps = options.taxRateBps;
  const editing = Boolean(documentId);
  const [kind, setKind] = useState<'proposal' | 'quotation'>('proposal');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [clientId, setClientId] = useState(presetClientId ?? '');
  const [leadId, setLeadId] = useState(presetLeadId ?? '');
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    initial
      ? initial.lines.map((l): Line => (l.packageId ? { key: nextKey++, type: 'package', packageId: l.packageId, quantity: l.quantity } : { key: nextKey++, type: 'custom', description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }))
      : [{ key: nextKey++, type: 'package', packageId: '', quantity: 1 }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);
  const priceOf = (id: string) => options.packages.find((p) => p.id === id)?.price ?? null;

  // A preview only: the server computes the stored figures with the same calculator.
  const totals = useMemo(() => {
    const usable = lines.flatMap((l) => {
      if (!l.quantity || l.quantity < 1) return [];
      if (l.type === 'package') {
        const price = priceOf(l.packageId);
        return price === null ? [] : [{ description: l.packageId, quantity: l.quantity, unitPrice: price }];
      }
      return l.unitPrice === null ? [] : [{ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }];
    });
    try {
      return calculateTotals(usable, taxRateBps);
    } catch {
      return null;
    }
  }, [lines, taxRateBps, options.packages]);

  const setLine = (key: number, patch: Partial<Line>) => setLines((all) => all.map((l) => (l.key === key ? ({ ...l, ...patch } as Line) : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const items = lines.map((l) => (l.type === 'package' ? { packageId: l.packageId, quantity: l.quantity ?? 0 } : { description: l.description, quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0 }));
      if (editing) {
        await api('PATCH', `/api/documents/${documentId}`, { title, validUntil: validUntil || null, items });
        window.location.assign(`/app/dokumen/${documentId}`);
      } else {
        const created = await api<{ id: string }>('POST', '/api/documents', { kind, title, clientId: clientId || null, leadId: leadId || null, validUntil: validUntil || null, items });
        window.location.assign(`/app/dokumen/${created.id}`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const generic = error && !Object.keys(bad).length ? t(errorKey(error)) : null;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {!editing && <PageHeader title={t('newDocument')} intro={t('docNewIntro')} />}
      <Panel className="flex max-w-3xl flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {!editing && (
            <FormField label={t('fDocKind')} required>
              <SelectMenu value={kind} onChange={(v) => setKind(v as typeof kind)} searchable={false} options={(['proposal', 'quotation'] as const).map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))} />
            </FormField>
          )}
          <FormField label={t('fDocTitle')} required error={bad.title ? t('errValidation') : null}>
            <TextInput value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={200} autoComplete="off" />
          </FormField>
          {!editing && (
            <>
              <FormField label={t('fDocClient')} help={t('docPartyHelp')} error={bad.clientId ? t('docPartyHelp') : null}>
                <SelectMenu value={clientId} onChange={setClientId} includeAll={t('choose')} options={options.clients.map((c) => ({ value: c.id, label: c.name }))} />
              </FormField>
              <FormField label={t('fDocLead')}>
                <SelectMenu value={leadId} onChange={setLeadId} includeAll={t('choose')} options={options.leads.map((l) => ({ value: l.id, label: l.name }))} />
              </FormField>
            </>
          )}
          <FormField label={t('fDocValidUntil')}>
            <DateInput value={validUntil} onChange={setValidUntil} />
          </FormField>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-4" aria-label={t('itemsTitle')}>
        <h2 className="m-0 text-lg font-semibold text-ink">{t('itemsTitle')}</h2>
        {options.packages.length === 0 && <p className="m-0 text-sm text-muted">{t('docNoPackages')}</p>}
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {lines.map((l, i) => (
            <li key={l.key} className="grid gap-3 border-t border-rule pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[1fr_7rem_11rem_auto] sm:items-end">
              {l.type === 'package' ? (
                <>
                  <FormField label={t('docPackage')} required error={bad[`items.${i}.packageId`] ? t('errValidation') : null} help={priceOf(l.packageId) !== null ? t('docPriceFromPackage', { price: formatRupiah(priceOf(l.packageId)!) }) : undefined}>
                    <SelectMenu value={l.packageId} onChange={(v) => setLine(l.key, { packageId: v })} placeholder={t('choose')} options={options.packages.map((p) => ({ value: p.id, label: p.label }))} />
                  </FormField>
                  <FormField label={t('fItemQty')} error={bad[`items.${i}.quantity`] ? t('errValidation') : null}>
                    <NumberInput value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} min={1} max={10000} />
                  </FormField>
                  <div className="hidden sm:block" />
                </>
              ) : (
                <>
                  <FormField label={t('fItemDesc')} required error={bad[`items.${i}.description`] ? t('errValidation') : null}>
                    <TextInput value={l.description} onChange={(e) => setLine(l.key, { description: e.currentTarget.value })} maxLength={300} autoComplete="off" />
                  </FormField>
                  <FormField label={t('fItemQty')} error={bad[`items.${i}.quantity`] ? t('errValidation') : null}>
                    <NumberInput value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} min={1} max={10000} />
                  </FormField>
                  <FormField label={t('fItemPrice')} error={bad[`items.${i}.unitPrice`] ? t('errValidation') : null}>
                    <MoneyInput value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v })} min={0} />
                  </FormField>
                </>
              )}
              <Button size="sm" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))} disabled={lines.length === 1} aria-label={`${t('removeItem')} ${i + 1}`}>
                <Icon name="close" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setLines((all) => [...all, { key: nextKey++, type: 'package', packageId: '', quantity: 1 }])} disabled={lines.length >= 50}>
            <Icon name="plus" className="size-4" />
            {t('docAddPackage')}
          </Button>
          <Button size="sm" onClick={() => setLines((all) => [...all, { key: nextKey++, type: 'custom', description: '', quantity: 1, unitPrice: null }])} disabled={lines.length >= 50}>
            <Icon name="plus" className="size-4" />
            {t('docAddCustom')}
          </Button>
        </div>
        {editing && <p className="m-0 text-xs text-muted">{t('docEditRepriceNote')}</p>}
        <dl className="m-0 ml-auto flex w-full max-w-xs flex-col gap-1.5 border-t border-rule pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted">{t('subtotalLabel')}</dt><dd className="m-0 font-mono tabular-nums">{formatRupiah(totals?.subtotal ?? 0)}</dd></div>
          {taxRateBps > 0 && <div className="flex justify-between"><dt className="text-muted">{t('taxLabel', { rate: String(taxRateBps / 100) })}</dt><dd className="m-0 font-mono tabular-nums">{formatRupiah(totals?.taxAmount ?? 0)}</dd></div>}
          <div className="flex justify-between text-base font-semibold"><dt>{t('totalLabel')}</dt><dd className="m-0 font-mono tabular-nums">{formatRupiah(totals?.total ?? 0)}</dd></div>
        </dl>
      </Panel>

      {generic && <p role="alert" className="m-0 text-danger">{generic}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={!title.trim() || (!editing && !clientId && !leadId)}>{editing ? t('saveChanges') : t('saveDraft')}</Button>
        <a href={editing ? `/app/dokumen/${documentId}` : '/app/dokumen'} className="text-ink-2 no-underline hover:text-ink">{t('cancel')}</a>
      </div>
    </form>
  );
}
