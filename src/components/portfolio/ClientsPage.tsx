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
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';

type Row = Jsonify<ClientRow>;

/** The client list. Search, sort and page live in the URL (`?q=`, `?sort=`), so a view can be shared or reloaded; archived clients are the server's filter. */
export function ClientsPage() {
  const t = useT();
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') setAdding(true);
  }, []);

  const list = useLoad(() => api<{ clients: Row[] }>('GET', `/api/clients?${new URLSearchParams(archived ? { archived: '1' } : {})}`), [archived]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('clientsTitle')} intro={t('clientsIntro')} action={<Button variant="primary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}><Icon name="plus" className="size-4" />{t('newClient')}</Button>} />

      {adding && (
        <Panel aria-label={t('newClient')}>
          <ClientForm onDone={() => { setAdding(false); void list.reload(); }} onCancel={() => setAdding(false)} />
        </Panel>
      )}

      <Panel aria-busy={list.value.state === 'loading'} className="flex flex-col gap-4">
        {list.value.state === 'loading' && <Skeleton rows={5} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry} />}
        {list.value.state === 'ready' && list.value.data.clients.length === 0 && !archived && (
          <EmptyState action={<Button variant="primary" onClick={() => setAdding(true)}>{t('newClient')}</Button>}>{t('emptyClients')}</EmptyState>
        )}
        {list.value.state === 'ready' && (list.value.data.clients.length > 0 || archived) && (
          <DataTable
            label={t('clientsTitle')}
            rows={list.value.data.clients}
            rowKey={(c) => c.id}
            search={(c) => `${c.name} ${c.contactName ?? ''} ${c.email ?? ''}`}
            emptyMatch={() => t('noMatch')}
            minWidth="38rem"
            toolbar={<Toggle label={t('showArchived')} checked={archived} onChange={setArchived} />}
            columns={[
              {
                id: 'name',
                header: t('fName'),
                sortValue: (c) => c.name,
                full: true,
                cell: (c) => (
                  <>
                    <a href={`/app/klien/${c.id}`} className="font-medium text-ink no-underline transition-colors hover:text-accent">{c.name}</a>
                    {c.archivedAt && <Badge className="ml-2">{t('archivedBadge')}</Badge>}
                  </>
                ),
              },
              { id: 'contact', header: t('colContact'), sortValue: (c) => c.contactName ?? c.email, cell: (c) => [c.contactName, c.email].filter(Boolean).join(', ') || t('noValue') },
              { id: 'deployments', header: t('colDeployments'), align: 'right', sortValue: (c) => c.deploymentCount, cell: (c) => <span className="tabular-nums">{c.deploymentCount}</span> },
              { id: 'behind', header: t('colBehind'), align: 'right', sortValue: (c) => c.behindCount, cell: (c) => (c.behindCount > 0 ? <Badge tone="warn">{c.behindCount}</Badge> : <span className="text-muted">{t('noValue')}</span>) },
            ]}
          />
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
