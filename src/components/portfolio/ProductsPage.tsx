import { useEffect, useState, type FormEvent } from 'react';
import type { ProductRow } from '../../domain/portfolio/products';
import { api, badFields, errorKey } from '../../lib/api-client';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Toggle } from '../forms/Toggle';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';

type Role = 'owner' | 'admin' | 'staff';
type Row = Jsonify<ProductRow>;

/** The product list. Managers add products; everyone reads them. Archived products are hidden unless asked for. */
export function ProductsPage({ role }: { role: Role }) {
  const t = useT();
  const canWrite = role !== 'staff';
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') setAdding(true);
  }, []);
  const list = useLoad(() => api<{ products: Row[] }>('GET', `/api/products${archived ? '?archived=1' : ''}`), [archived]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('productsTitle')} intro={t('productsIntro')} action={canWrite && <Button variant="primary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}><Icon name="plus" className="size-4" />{t('newProduct')}</Button>} />

      {adding && canWrite && (
        <Panel aria-label={t('newProduct')}>
          <ProductForm onDone={() => { setAdding(false); void list.reload(); }} onCancel={() => setAdding(false)} />
        </Panel>
      )}

      <Panel aria-busy={list.value.state === 'loading'} className="flex flex-col gap-4">
        <Toggle label={t('showArchived')} checked={archived} onChange={setArchived} />
        {list.value.state === 'loading' && <Skeleton rows={4} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry} />}
        {list.value.state === 'ready' && list.value.data.products.length === 0 && (
          <EmptyState action={canWrite ? <Button variant="primary" onClick={() => setAdding(true)}>{t('newProduct')}</Button> : undefined}>{t('emptyProducts')}</EmptyState>
        )}
        {list.value.state === 'ready' && list.value.data.products.length > 0 && (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[40rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('fName')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colVersion')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colPackages')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colDeployments')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('colBehind')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={tbl.tbody}>
                {list.value.data.products.map((p) => (
                  <tr key={p.id} role="row" className={tbl.row + ' align-middle'}>
                    <th scope="row" role="rowheader" className={'py-3 pr-3 text-left font-medium max-sm:p-0 ' + tbl.full}>
                      <a href={`/app/produk/${p.id}`} className="font-medium text-ink no-underline transition-colors hover:text-accent">{p.name}</a>
                      {p.archivedAt && <Badge className="ml-2">{t('archivedBadge')}</Badge>}
                    </th>
                    <td role="cell" data-label={t('colVersion')} className={'py-3 pr-3 text-ink tabular-nums max-sm:p-0 ' + tbl.label}>{p.currentVersion ?? t('noValue')}</td>
                    <td role="cell" data-label={t('colPackages')} className={'py-3 pr-3 text-right text-ink tabular-nums max-sm:p-0 max-sm:text-left ' + tbl.label}>{p.packageCount}</td>
                    <td role="cell" data-label={t('colDeployments')} className={'py-3 pr-3 text-right text-ink tabular-nums max-sm:p-0 max-sm:text-left ' + tbl.label}>{p.deploymentCount}</td>
                    <td role="cell" data-label={t('colBehind')} className={'py-3 text-right max-sm:p-0 max-sm:text-left ' + tbl.label}>
                      {p.behindCount > 0 ? <Badge tone="warn">{p.behindCount}</Badge> : <span className="text-muted">{t('noValue')}</span>}
                    </td>
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

function ProductForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [values, setValues] = useState({ name: '', description: '', currentVersion: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/products', values);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
      <FormField label={t('fName')} required error={bad.name ? t('errValidation') : error && !Object.keys(bad).length ? t(errorKey(error)) : null}>
        <TextInput value={values.name} onChange={(e) => setValues({ ...values, name: e.currentTarget.value })} maxLength={120} required autoFocus />
      </FormField>
      <FormField label={t('fDescription')} error={bad.description ? t('errValidation') : null}>
        <Textarea value={values.description} onChange={(e) => setValues({ ...values, description: e.currentTarget.value })} rows={2} maxLength={2000} />
      </FormField>
      <FormField label={t('fVersion')} help={t('fVersionHelp')} error={bad.currentVersion ? t('errValidation') : null}>
        <TextInput value={values.currentVersion} onChange={(e) => setValues({ ...values, currentVersion: e.currentTarget.value })} maxLength={40} placeholder="2.1.0" />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>{t('add')}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}
