import { useEffect, useState, type FormEvent } from 'react';
import type { ClientRow } from '../../domain/portfolio/clients';
import { api, badFields, errorKey } from '../../lib/api-client';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Toggle } from '../forms/Toggle';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';

type Row = Jsonify<ClientRow>;

/** The client list with search. The search text lives in the URL (`?q=`), so a filtered list can be shared or reloaded. */
export function ClientsPage() {
  const t = useT();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('q') ?? '';
    setQ(initial);
    setSearch(initial);
  }, []);
  // Wait for a pause in typing before asking the server, and keep the URL in step.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q);
      const url = new URL(window.location.href);
      if (q) url.searchParams.set('q', q);
      else url.searchParams.delete('q');
      window.history.replaceState(null, '', url);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const list = useLoad(() => api<{ clients: Row[] }>('GET', `/api/clients?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(archived ? { archived: '1' } : {}) })}`), [search, archived]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <h1 className="m-0 text-2xl font-semibold text-ink lg:text-3xl">{t('clientsTitle')}</h1>
          <p className="mt-2 mb-0 text-muted">{t('clientsIntro')}</p>
        </div>
        <Button variant="primary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>{t('newClient')}</Button>
      </header>

      {adding && (
        <Panel aria-label={t('newClient')}>
          <ClientForm onDone={() => { setAdding(false); void list.reload(); }} onCancel={() => setAdding(false)} />
        </Panel>
      )}

      <Panel aria-busy={list.value.state === 'loading'} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-full max-w-sm">
            <TextInput type="search" value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={t('searchClients')} aria-label={t('searchClients')} clearable maxLength={80} />
          </div>
          <Toggle label={t('showArchived')} checked={archived} onChange={setArchived} />
        </div>
        {list.value.state === 'loading' && <Skeleton rows={5} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry} />}
        {list.value.state === 'ready' && list.value.data.clients.length === 0 && (
          <EmptyState action={!search ? <Button variant="primary" onClick={() => setAdding(true)}>{t('newClient')}</Button> : undefined}>{search ? t('noMatch') : t('emptyClients')}</EmptyState>
        )}
        {list.value.state === 'ready' && list.value.data.clients.length > 0 && (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[38rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('fName')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colContact')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colDeployments')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('colBehind')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={tbl.tbody}>
                {list.value.data.clients.map((c) => (
                  <tr key={c.id} role="row" className={tbl.row + ' align-middle'}>
                    <th scope="row" role="rowheader" className={'py-3 pr-3 text-left font-medium max-sm:p-0 ' + tbl.full}>
                      <a href={`/app/klien/${c.id}`} className="text-ink underline decoration-rule-2 underline-offset-4 hover:decoration-accent">{c.name}</a>
                      {c.archivedAt && <Badge className="ml-2">{t('archivedBadge')}</Badge>}
                    </th>
                    <td role="cell" data-label={t('colContact')} className={'py-3 pr-3 text-ink max-sm:p-0 ' + tbl.label}>{[c.contactName, c.email].filter(Boolean).join(', ') || t('noValue')}</td>
                    <td role="cell" data-label={t('colDeployments')} className={'py-3 pr-3 text-right text-ink tabular-nums max-sm:p-0 max-sm:text-left ' + tbl.label}>{c.deploymentCount}</td>
                    <td role="cell" data-label={t('colBehind')} className={'py-3 text-right max-sm:p-0 max-sm:text-left ' + tbl.label}>
                      {c.behindCount > 0 ? <Badge tone="warn">{c.behindCount}</Badge> : <span className="text-muted">{t('noValue')}</span>}
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

export interface ClientValues {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

export const emptyClient: ClientValues = { name: '', contactName: '', email: '', phone: '', address: '', notes: '' };

/** The client fields, used to add a client and to edit one. Staff may do both (BRD-M02 §2). */
export function ClientFields({ values, onChange, bad, nameError }: { values: ClientValues; onChange: (next: ClientValues) => void; bad: Record<string, true>; nameError?: string | null }) {
  const t = useT();
  const set = (key: keyof ClientValues) => (e: { currentTarget: { value: string } }) => onChange({ ...values, [key]: e.currentTarget.value });
  return (
    <>
      <FormField label={t('fName')} required error={bad.name ? t('errValidation') : nameError}>
        <TextInput value={values.name} onChange={set('name')} maxLength={120} required autoComplete="off" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fContact')}>
          <TextInput value={values.contactName} onChange={set('contactName')} maxLength={120} autoComplete="off" />
        </FormField>
        <FormField label={t('fEmail')} error={bad.email ? t('errValidation') : null}>
          <TextInput type="email" value={values.email} onChange={set('email')} maxLength={254} autoComplete="off" />
        </FormField>
        <FormField label={t('fPhone')}>
          <TextInput type="tel" value={values.phone} onChange={set('phone')} maxLength={40} autoComplete="off" />
        </FormField>
        <FormField label={t('fAddress')}>
          <TextInput value={values.address} onChange={set('address')} maxLength={500} autoComplete="off" />
        </FormField>
      </div>
      <FormField label={t('fNotes')}>
        <Textarea value={values.notes} onChange={set('notes')} rows={3} maxLength={4000} />
      </FormField>
    </>
  );
}

function ClientForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [values, setValues] = useState<ClientValues>(emptyClient);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/clients', values);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4">
      <ClientFields values={values} onChange={setValues} bad={bad} nameError={error && !Object.keys(bad).length ? t(errorKey(error)) : null} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>{t('add')}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}
