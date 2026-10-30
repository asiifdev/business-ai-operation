import { useState, type FormEvent } from 'react';
import type { getProduct, PackageRow, ProductDeploymentRow } from '../../domain/portfolio/products';
import { api, badFields, errorKey } from '../../lib/api-client';
import { formatRupiah } from '../../lib/format';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { MoneyInput } from '../forms/MoneyInput';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import * as tbl from '../ui/table';
import { AuditTimeline } from '../audit/AuditTimeline';
import { LogoEditor, ProductLogo, SOURCE_LABEL } from './ProductLogo';
import { ProductSetup } from './ProductSetup';
import { OpsBadges } from './OpsBadges';
import { VersionBadge } from './VersionBadge';

type Role = 'owner' | 'admin' | 'staff';
type Detail = Jsonify<Awaited<ReturnType<typeof getProduct>>>;
type Pkg = Jsonify<PackageRow>;
type Dep = Jsonify<ProductDeploymentRow>;

/** One product: its details, its official packages and prices, and where it is installed. */
export function ProductDetail({ id, role, timezone }: { id: string; role: Role; timezone: string }) {
  const t = useT();
  const canWrite = role !== 'staff';
  const load = useLoad(() => api<Detail>('GET', `/api/products/${id}`), [id]);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);

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

  if (load.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={5} /></Panel>;
  if (load.value.state === 'error') return <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>;

  const { product, packages, deployments } = load.value.data;
  const archived = product.archivedAt !== null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <a href="/app/produk" className="w-fit text-sm text-accent underline underline-offset-4">{t('navProducts')}</a>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            <ProductLogo id={id} name={product.name} hasLogo={product.logoFileId !== null} size="lg" version={logoVersion} />
            <div className="min-w-0">
            <h1 className="m-0 flex flex-wrap items-center gap-3 text-2xl font-semibold text-ink lg:text-3xl">
              {product.name}
              {archived && <Badge>{t('archivedBadge')}</Badge>}
            </h1>
            <p className="mt-2 mb-0 text-muted">{product.currentVersion ? `${t('fVersion')} ${product.currentVersion}` : t('noValue')}</p>
            </div>
          </div>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <ConfirmButton busy={busy} onConfirm={() => act(() => api('POST', `/api/products/${id}/archive`, { archived: !archived }))}>{archived ? t('restore') : t('archive')}</ConfirmButton>
              {deployments.length === 0 && (
                <ConfirmButton variant="danger" busy={busy} onConfirm={() => act(() => api('DELETE', `/api/products/${id}`), () => window.location.assign('/app/produk'))}>{t('delete')}</ConfirmButton>
              )}
            </div>
          )}
        </div>
        {actionError ? <p role="alert" className="m-0 text-danger">{t(errorKey(actionError))}</p> : null}
        {canWrite && deployments.length > 0 && <p className="m-0 text-sm text-muted">{t('deleteProductHint')}</p>}
      </header>

      {canWrite && !archived && (
        <Panel aria-label={t('edit')}>
          <div className="flex flex-col gap-6">
            <ProductEdit product={product} onSaved={() => void load.reload()} />
            <LogoEditor productId={id} name={product.name} hasLogo={product.logoFileId !== null} onChanged={() => { setLogoVersion((v) => v + 1); void load.reload(); }} />
          </div>
        </Panel>
      )}

      <Packages productId={id} packages={packages} canWrite={canWrite && !archived} canArchive={canWrite} onChanged={() => void load.reload()} />

      <ProductSetup productId={id} canWrite={canWrite && !archived} />

      {canWrite && <AuditTimeline entityType="product" entityId={id} timezone={timezone} />}

      <Panel className="flex flex-col gap-4">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('deploymentsTitle')}</h2>
        {deployments.length === 0 ? (
          <EmptyState>{t('emptyDeployments')}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table role="table" className={tbl.table + ' sm:min-w-[36rem]'}>
              <thead className={tbl.thead}>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colClient')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colEnvironment')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colDomain')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('colInstalled')}</th>
                  <th scope="col" className="py-2 font-medium">{t('colVersion')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={tbl.tbody}>
                {deployments.map((d: Dep) => (
                  <tr key={d.id} role="row" className={tbl.row + ' align-middle'}>
                    <th scope="row" role="rowheader" className={'py-3 pr-3 text-left font-medium max-sm:p-0 ' + tbl.full}>
                      <a href={`/app/klien/${d.clientId}`} className="font-medium text-ink no-underline transition-colors hover:text-accent">{d.clientName}</a>
                      {d.label && <span className="ml-2 text-sm font-normal text-muted">{d.label}</span>}
                    </th>
                    <td role="cell" data-label={t('colEnvironment')} className={'py-3 pr-3 text-ink max-sm:p-0 ' + tbl.label}>{d.environment}</td>
                    <td role="cell" data-label={t('colDomain')} className={'py-3 pr-3 text-ink max-sm:p-0 ' + tbl.label}>{d.domain ?? t('noValue')}</td>
                    <td role="cell" data-label={t('colInstalled')} className={'py-3 pr-3 text-ink tabular-nums max-sm:p-0 ' + tbl.label}>{d.installedVersion ?? t('noValue')}</td>
                    <td role="cell" data-label={t('colVersion')} className={'py-3 max-sm:p-0 ' + tbl.label}><span className="inline-flex flex-wrap items-center gap-1.5"><VersionBadge state={d.versionState} /><OpsBadges behindBy={d.behindBy} uptimeState={d.uptimeState} /></span></td>
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

function ProductEdit({ product, onSaved }: { product: Detail['product']; onSaved: () => void }) {
  const t = useT();
  const [values, setValues] = useState({ name: product.name, description: product.description ?? '', currentVersion: product.currentVersion ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [versionNote, setVersionNote] = useState<string | null>(null);
  const [versionBusy, setVersionBusy] = useState(false);
  const bad = badFields(error);
  const dirty = values.name !== product.name || values.description !== (product.description ?? '') || values.currentVersion !== (product.currentVersion ?? '');

  /** Reads the latest release or tag of the repository chosen in the setup section; the person still saves it. */
  async function fetchVersion() {
    setVersionBusy(true);
    setVersionNote(null);
    try {
      const setup = await api<{ profile: { githubConnectionId: string | null; repo: string | null } | null }>('GET', `/api/products/${product.id}/setup`);
      const p = setup.profile;
      if (!p?.repo || !p.githubConnectionId) return setVersionNote(t('pVersionNoRepo'));
      const r = await api<{ found: { version: string; source: 'release' | 'tag' | 'commit' } | null }>('GET', `/api/setup/version?connectionId=${p.githubConnectionId}&repo=${encodeURIComponent(p.repo)}`);
      if (!r.found) return setVersionNote(t('pVersionNotFound'));
      setValues((v) => ({ ...v, currentVersion: r.found!.version }));
      setVersionNote(t('pVersionFound', { source: t(SOURCE_LABEL[r.found.source]), version: r.found.version }));
    } catch {
      setVersionNote(t('pVersionFailed'));
    } finally {
      setVersionBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('PATCH', `/api/products/${product.id}`, values);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
      <FormField label={t('fName')} required error={bad.name ? t('errValidation') : error && !Object.keys(bad).length ? t(errorKey(error)) : null}>
        <TextInput value={values.name} onChange={(e) => setValues({ ...values, name: e.currentTarget.value })} maxLength={120} required />
      </FormField>
      <FormField label={t('fDescription')}>
        <Textarea value={values.description} onChange={(e) => setValues({ ...values, description: e.currentTarget.value })} rows={2} maxLength={2000} />
      </FormField>
      <FormField label={t('fVersion')} help={t('fVersionHelp')}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-40 flex-1">
            <TextInput value={values.currentVersion} onChange={(e) => setValues({ ...values, currentVersion: e.currentTarget.value })} maxLength={40} placeholder="2.1.0" />
          </div>
          <Button size="sm" loading={versionBusy} onClick={fetchVersion}>{t('pVersionFromRepo')}</Button>
        </div>
        {versionNote && <p role="status" className="mt-1 mb-0 text-sm text-muted">{versionNote}</p>}
      </FormField>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>{t('save')}</Button>
        <span role="status" className="text-sm text-success">{saved && !dirty ? t('saved') : ''}</span>
      </div>
    </form>
  );
}

function Packages({ productId, packages, canWrite, canArchive, onChanged }: { productId: string; packages: Pkg[]; canWrite: boolean; canArchive: boolean; onChanged: () => void }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function toggleArchive(pkg: Pkg) {
    setError(null);
    try {
      await api('POST', `/api/packages/${pkg.id}/archive`, { archived: pkg.archivedAt === null });
      onChanged();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Panel className="flex flex-col gap-4" aria-label={t('packagesTitle')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('packagesTitle')}</h2>
        {canWrite && <Button size="sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>{t('newPackage')}</Button>}
      </div>
      {error ? <p role="alert" className="m-0 text-danger">{t(errorKey(error))}</p> : null}
      {adding && canWrite && <PackageForm endpoint={`/api/products/${productId}/packages`} method="POST" onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />}
      {packages.length === 0 ? (
        <EmptyState>{t('emptyPackages')}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table role="table" className={tbl.table + ' sm:min-w-[34rem]'}>
            <thead className={tbl.thead}>
              <tr className="text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">{t('fPackageName')}</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">{t('colPrice')}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t('colFeatures')}</th>
                {canArchive && <th scope="col" className="py-2 font-medium">{t('colActions')}</th>}
              </tr>
            </thead>
            <tbody role="rowgroup" className={tbl.tbody}>
              {packages.map((pkg) =>
                editing === pkg.id ? (
                  <tr key={pkg.id} role="row" className={tbl.row}>
                    <td role="cell" colSpan={canArchive ? 4 : 3} className="py-3 max-sm:col-span-2 max-sm:p-0">
                      <PackageForm endpoint={`/api/packages/${pkg.id}`} method="PATCH" initial={pkg} onDone={() => { setEditing(null); onChanged(); }} onCancel={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={pkg.id} role="row" className={tbl.row + ' align-top'}>
                    <th scope="row" role="rowheader" className={'py-3 pr-3 text-left font-medium text-ink max-sm:p-0 ' + tbl.full}>
                      {pkg.name}
                      {pkg.archivedAt && <Badge className="ml-2">{t('archivedBadge')}</Badge>}
                    </th>
                    <td role="cell" data-label={t('colPrice')} className={'py-3 pr-3 text-right text-ink tabular-nums max-sm:p-0 max-sm:text-left ' + tbl.label}>{formatRupiah(pkg.monthlyPrice)}</td>
                    <td role="cell" data-label={t('colFeatures')} className={'py-3 pr-3 text-ink max-sm:p-0 ' + tbl.label}>{pkg.features ?? t('noValue')}</td>
                    {canArchive && (
                      <td role="cell" className="py-3 max-sm:col-span-2 max-sm:p-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {canWrite && !pkg.archivedAt && <Button size="sm" onClick={() => setEditing(pkg.id)}>{t('edit')}</Button>}
                          <ConfirmButton onConfirm={() => toggleArchive(pkg)}>{pkg.archivedAt ? t('restore') : t('archive')}</ConfirmButton>
                        </div>
                      </td>
                    )}
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

function PackageForm({ endpoint, method, initial, onDone, onCancel }: { endpoint: string; method: 'POST' | 'PATCH'; initial?: Pkg; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState<number | null>(initial?.monthlyPrice ?? null);
  const [features, setFeatures] = useState(initial?.features ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = badFields(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(method, endpoint, { name, monthlyPrice: price ?? undefined, features });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4 border-t border-rule pt-4">
      <FormField label={t('fPackageName')} required error={bad.name ? t('errValidation') : error && !Object.keys(bad).length ? t(errorKey(error)) : null}>
        <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} required autoFocus />
      </FormField>
      <FormField label={t('fPrice')} required help={t('priceHelp')} error={bad.monthlyPrice ? t('errValidation') : null}>
        <MoneyInput value={price} onChange={setPrice} min={0} />
      </FormField>
      <FormField label={t('fFeatures')}>
        <Textarea value={features} onChange={(e) => setFeatures(e.currentTarget.value)} rows={2} maxLength={2000} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={price === null}>{method === 'POST' ? t('add') : t('save')}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}
