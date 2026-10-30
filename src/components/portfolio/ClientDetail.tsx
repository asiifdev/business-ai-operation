import { useState, type FormEvent } from 'react';
import type { ClientDeploymentRow, getClient360, TimelineEntry } from '../../domain/portfolio/clients';
import type { ProductRow } from '../../domain/portfolio/products';
import { api, badFields, errorKey, ApiError } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useLocale, useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { ProductSelect } from './ProductSelect';
import { TextInput } from '../forms/TextInput';
import { ClientBilling } from '../billing/ClientBilling';
import { ClientTasks } from '../tasks/ClientTasks';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';
import { ClientFields, type ClientValues } from './ClientsPage';
import { OpsBadges } from './OpsBadges';
import { VersionBadge } from './VersionBadge';

type Role = 'owner' | 'admin' | 'staff';
type View = Jsonify<Awaited<ReturnType<typeof getClient360>>>;
type Dep = Jsonify<ClientDeploymentRow>;

const ACTION_LABEL: Record<string, MessageKey> = {
  'client.created': 'actClientCreated',
  'client.updated': 'actClientUpdated',
  'client.archived': 'actClientArchived',
  'client.unarchived': 'actClientUnarchived',
  'deployment.created': 'actDeploymentCreated',
  'deployment.updated': 'actDeploymentUpdated',
  'deployment.deleted': 'actDeploymentDeleted',
};
const ACTOR_LABEL = { user: 'byPerson', ai: 'byAi', system: 'bySystem' } as const;

/** The 360 degree view of one client: details, deployments with their version state, open tasks, billing and the change history. */
export function ClientDetail({ id, role }: { id: string; role: Role }) {
  const t = useT();
  const isManager = role !== 'staff';
  const load = useLoad(() => api<View>('GET', `/api/clients/${id}`), [id]);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

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

  const { client, deployments, timeline, billing } = load.value.data;
  const archived = client.archivedAt !== null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <a href="/app/klien" className="w-fit text-sm text-accent underline underline-offset-4">{t('navClients')}</a>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="m-0 flex min-w-0 flex-wrap items-center gap-3 text-2xl font-semibold text-ink lg:text-3xl">
            {client.name}
            {archived && <Badge>{t('archivedBadge')}</Badge>}
          </h1>
          {isManager && (
            <div className="flex flex-wrap items-center gap-2">
              <ConfirmButton busy={busy} onConfirm={() => act(() => api('POST', `/api/clients/${id}/archive`, { archived: !archived }))}>{archived ? t('restore') : t('archive')}</ConfirmButton>
              {deployments.length === 0 && (
                <ConfirmButton variant="danger" busy={busy} onConfirm={() => act(() => api('DELETE', `/api/clients/${id}`), () => window.location.assign('/app/klien'))}>{t('delete')}</ConfirmButton>
              )}
            </div>
          )}
        </div>
        {actionError ? <p role="alert" className="m-0 text-danger">{t(errorKey(actionError))}</p> : null}
      </header>

      {!archived && (
        <Panel aria-label={t('edit')}>
          <ClientEdit client={client} onSaved={() => void load.reload()} />
        </Panel>
      )}

      <Deployments clientId={id} deployments={deployments} canAdd={!archived} isManager={isManager} onChanged={() => void load.reload()} />

      <ClientTasks clientId={id} />

      {billing && <ClientBilling clientId={id} subscriptions={billing.subscriptions} invoices={billing.invoices} />}

      {timeline && <Timeline entries={timeline} />}
    </div>
  );
}

function ClientEdit({ client, onSaved }: { client: View['client']; onSaved: () => void }) {
  const t = useT();
  const initial: ClientValues = { name: client.name, contactName: client.contactName ?? '', email: client.email ?? '', phone: client.phone ?? '', address: client.address ?? '', notes: client.notes ?? '' };
  const [values, setValues] = useState<ClientValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const bad = badFields(error);
  const dirty = (Object.keys(initial) as Array<keyof ClientValues>).some((k) => values[k] !== initial[k]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('PATCH', `/api/clients/${client.id}`, values);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4">
      <ClientFields values={values} onChange={setValues} bad={bad} nameError={error && !Object.keys(bad).length ? t(errorKey(error)) : null} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>{t('save')}</Button>
        <span role="status" className="text-sm text-success">{saved && !dirty ? t('saved') : ''}</span>
      </div>
    </form>
  );
}

function Deployments({ clientId, deployments, canAdd, isManager, onChanged }: { clientId: string; deployments: Dep[]; canAdd: boolean; isManager: boolean; onChanged: () => void }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function remove(d: Dep) {
    setError(null);
    try {
      await api('DELETE', `/api/deployments/${d.id}`);
      onChanged();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Panel className="flex flex-col gap-4" aria-label={t('deploymentsTitle')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('deploymentsTitle')}</h2>
        {canAdd && <Button size="sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>{t('newDeployment')}</Button>}
      </div>
      {error ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      {adding && <DeploymentForm clientId={clientId} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />}
      {deployments.length === 0 ? (
        <EmptyState>{t('emptyDeployments')}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table role="table" className={tbl.table + ' sm:min-w-[40rem]'}>
            <thead className={tbl.thead}>
              <tr className="text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">{t('colProduct')}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t('colEnvironment')}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t('colDomain')}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t('colInstalled')}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t('colVersion')}</th>
                <th scope="col" className="py-2 font-medium">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className={tbl.tbody}>
              {deployments.map((d) =>
                editing === d.id ? (
                  <tr key={d.id} role="row" className={tbl.row}>
                    <td role="cell" colSpan={6} className="py-3 max-sm:col-span-2 max-sm:p-0">
                      <DeploymentEdit deployment={d} onDone={() => { setEditing(null); onChanged(); }} onCancel={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={d.id} role="row" className={tbl.row + ' align-top'}>
                    <th scope="row" role="rowheader" className={'py-3 pr-3 text-left font-medium max-sm:p-0 ' + tbl.full}>
                      <a href={`/app/produk/${d.productId}`} className="font-medium text-ink no-underline transition-colors hover:text-accent">{d.productName}</a>
                      {d.label && <span className="ml-2 text-sm font-normal text-muted">{d.label}</span>}
                      {d.status === 'inactive' && <Badge className="ml-2">{t('statusInactive')}</Badge>}
                    </th>
                    <td role="cell" data-label={t('colEnvironment')} className={'py-3 pr-3 text-ink max-sm:p-0 ' + tbl.label}>{d.environment}</td>
                    <td role="cell" data-label={t('colDomain')} className={'py-3 pr-3 text-ink max-sm:p-0 ' + tbl.label}>{d.domain ?? t('noValue')}</td>
                    <td role="cell" data-label={t('colInstalled')} className={'py-3 pr-3 text-ink tabular-nums max-sm:p-0 ' + tbl.label}>{d.installedVersion ?? t('noValue')}</td>
                    <td role="cell" data-label={t('colVersion')} className={'py-3 pr-3 max-sm:p-0 ' + tbl.label}>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <VersionBadge state={d.versionState} />
                        <OpsBadges behindBy={d.behindBy} uptimeState={d.uptimeState} />
                      </span>
                      {d.productVersion && <span className="ml-2 text-sm text-muted tabular-nums">{d.productVersion}</span>}
                    </td>
                    <td role="cell" className="py-3 max-sm:col-span-2 max-sm:p-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => setEditing(d.id)}>{t('edit')}</Button>
                        {isManager && <ConfirmButton variant="danger" onConfirm={() => remove(d)}>{t('delete')}</ConfirmButton>}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function DeploymentForm({ clientId, onDone, onCancel }: { clientId: string; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const products = useLoad(() => api<{ products: Array<Jsonify<ProductRow>> }>('GET', '/api/products'));
  const [values, setValues] = useState({ productId: '', environment: 'production', label: '', domain: '', installedVersion: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);
  const duplicate = error instanceof ApiError && error.code === 'duplicate';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/deployments', { ...values, clientId });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const options = products.value.state === 'ready' ? products.value.data.products.map((p) => ({ value: p.id, label: p.name, description: p.currentVersion ?? undefined })) : [];

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4 border-t border-rule pt-4">
      <FormField label={t('fProduct')} required error={duplicate ? t('errDuplicateDeployment') : bad.productId ? t('errValidation') : null}>
        <ProductSelect products={options.map((o) => ({ id: o.value, name: o.label, description: o.description }))} value={values.productId} onChange={(productId) => setValues({ ...values, productId })} placeholder={t('pickProduct')} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fEnvironment')} required error={bad.environment ? t('errValidation') : null}>
          <TextInput value={values.environment} onChange={(e) => setValues({ ...values, environment: e.currentTarget.value })} maxLength={30} />
        </FormField>
        <FormField label={t('fLabel')}>
          <TextInput value={values.label} onChange={(e) => setValues({ ...values, label: e.currentTarget.value })} maxLength={120} />
        </FormField>
        <FormField label={t('fDomain')} help={t('domainHelp')} error={bad.domain ? t('errValidation') : null}>
          <TextInput value={values.domain} onChange={(e) => setValues({ ...values, domain: e.currentTarget.value })} maxLength={253} placeholder="app.example.com" autoComplete="off" />
        </FormField>
        <FormField label={t('fInstalled')}>
          <TextInput value={values.installedVersion} onChange={(e) => setValues({ ...values, installedVersion: e.currentTarget.value })} maxLength={40} placeholder="2.0.0" />
        </FormField>
      </div>
      {error && !duplicate && !Object.keys(bad).length ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={!values.productId}>{t('add')}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}

/** Staff may update what is installed and switch a deployment off; removing it is for managers. */
function DeploymentEdit({ deployment, onDone, onCancel }: { deployment: Dep; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [values, setValues] = useState({ installedVersion: deployment.installedVersion ?? '', domain: deployment.domain ?? '', label: deployment.label ?? '', status: deployment.status });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('PATCH', `/api/deployments/${deployment.id}`, values);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 border-t border-rule pt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('fInstalled')}>
          <TextInput value={values.installedVersion} onChange={(e) => setValues({ ...values, installedVersion: e.currentTarget.value })} maxLength={40} autoFocus />
        </FormField>
        <FormField label={t('colStatus')}>
          <SelectMenu
            value={values.status}
            onChange={(status) => setValues({ ...values, status: status as 'active' | 'inactive' })}
            options={[{ value: 'active', label: t('statusActive') }, { value: 'inactive', label: t('statusInactive') }]}
          />
        </FormField>
        <FormField label={t('fDomain')} help={t('domainHelp')} error={bad.domain ? t('errValidation') : null}>
          <TextInput value={values.domain} onChange={(e) => setValues({ ...values, domain: e.currentTarget.value })} maxLength={253} autoComplete="off" />
        </FormField>
        <FormField label={t('fLabel')}>
          <TextInput value={values.label} onChange={(e) => setValues({ ...values, label: e.currentTarget.value })} maxLength={120} />
        </FormField>
      </div>
      {error && !Object.keys(bad).length ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>{t('save')}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}

function Timeline({ entries }: { entries: Array<Jsonify<TimelineEntry>> }) {
  const t = useT();
  const locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Panel className="flex flex-col gap-4" aria-label={t('timelineTitle')}>
      <h2 className="m-0 text-lg font-semibold text-ink">{t('timelineTitle')}</h2>
      {entries.length === 0 ? (
        <EmptyState>{t('emptyTimeline')}</EmptyState>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {entries.map((e) => (
            <li key={e.id} className="grid gap-x-4 border-t border-rule py-3 first:border-t-0 first:pt-0 sm:grid-cols-[12rem_1fr_8rem]">
              <span className="text-sm text-muted tabular-nums">{when.format(new Date(e.at))}</span>
              <span className="text-ink">{ACTION_LABEL[e.action] ? t(ACTION_LABEL[e.action]) : e.action}</span>
              <span className="text-sm text-muted">{t(ACTOR_LABEL[e.actor])}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
