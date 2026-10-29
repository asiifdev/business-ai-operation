import { useEffect, useState, type FormEvent } from 'react';
import type { ProductRow } from '../../domain/portfolio/products';
import { api, badFields, errorKey, upload } from '../../lib/api-client';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { FileInput } from '../forms/FileInput';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Toggle } from '../forms/Toggle';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { LOGO_MAX_BYTES, LOGO_TYPES, ProductLogo, SOURCE_LABEL } from './ProductLogo';
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
                      <a href={`/app/produk/${p.id}`} className="inline-flex items-center gap-3 font-medium text-ink no-underline transition-colors hover:text-accent">
                        <ProductLogo id={p.id} name={p.name} hasLogo={p.hasLogo} size="sm" />
                        {p.name}
                      </a>
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

type Repo = { fullName: string; defaultBranch: string };
type Connection = { id: string; kind: string; name: string };

/** Name, description, logo, repository and version of a new product. The repository and the logo are saved after the product exists; if either fails the product is kept and the person is told. */
function ProductForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [values, setValues] = useState({ name: '', description: '', currentVersion: '' });
  const [logo, setLogo] = useState<File | null>(null);
  const [repo, setRepo] = useState('');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [github, setGithub] = useState<Connection | null | undefined>(undefined); // undefined while loading
  const [repoError, setRepoError] = useState(false);
  const [versionNote, setVersionNote] = useState<string | null>(null);
  const [versionBusy, setVersionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [partial, setPartial] = useState<{ id: string; what: string[] } | null>(null);
  const bad = badFields(error);

  useEffect(() => {
    let live = true;
    api<{ connections: Connection[] }>('GET', '/api/connections')
      .then(async (r) => {
        const conn = r.connections.find((c) => c.kind === 'github') ?? null;
        if (!live) return;
        setGithub(conn);
        if (!conn) return;
        try {
          const list = await api<{ repos: Repo[] }>('GET', `/api/setup/repos?connectionId=${conn.id}`);
          if (live) setRepos(list.repos);
        } catch {
          if (live) setRepoError(true);
        }
      })
      .catch(() => live && setGithub(null));
    return () => {
      live = false;
    };
  }, []);

  /** Reads the latest release or tag of the chosen repository and offers it as the version. Never overwrites silently: the note says where it came from. */
  async function fetchVersion(fullName: string) {
    if (!github || !fullName) return;
    setVersionBusy(true);
    setVersionNote(null);
    try {
      const r = await api<{ found: { version: string; source: 'release' | 'tag' | 'commit' } | null }>('GET', `/api/setup/version?connectionId=${github.id}&repo=${encodeURIComponent(fullName)}`);
      if (!r.found) setVersionNote(t('pVersionNotFound'));
      else {
        setValues((v) => ({ ...v, currentVersion: r.found!.version }));
        setVersionNote(t('pVersionFound', { source: t(SOURCE_LABEL[r.found.source]), version: r.found.version }));
      }
    } catch {
      setVersionNote(t('pVersionFailed'));
    } finally {
      setVersionBusy(false);
    }
  }

  function chooseRepo(fullName: string) {
    setRepo(fullName);
    if (fullName && !values.currentVersion.trim()) void fetchVersion(fullName);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let created: string;
    try {
      created = (await api<{ id: string }>('POST', '/api/products', values)).id;
    } catch (err) {
      setError(err);
      setBusy(false);
      return;
    }
    const failed: string[] = [];
    if (repo && github) {
      const branch = repos.find((r) => r.fullName === repo)?.defaultBranch ?? null;
      await api('PUT', `/api/products/${created}/setup`, { githubConnectionId: github.id, repo, defaultBranch: branch }).catch(() => failed.push(t('pRepo')));
    }
    if (logo) {
      const form = new FormData();
      form.set('file', logo);
      await upload(`/api/products/${created}/logo`, form).catch(() => failed.push(t('pLogo')));
    }
    setBusy(false);
    if (failed.length) setPartial({ id: created, what: failed });
    else onDone();
  }

  if (partial) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <ErrorBox>{t('pCreatedPartial', { what: partial.what.join(', ') })}</ErrorBox>
        <div className="flex gap-2">
          <a href={`/app/produk/${partial.id}`} className={buttonClasses('primary')}>{t('pOpenProduct')}</a>
          <Button onClick={onDone}>{t('cancel')}</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
      <FormField label={t('fName')} required error={bad.name ? t('errValidation') : error && !Object.keys(bad).length ? t(errorKey(error)) : null}>
        <TextInput value={values.name} onChange={(e) => setValues({ ...values, name: e.currentTarget.value })} maxLength={120} required autoFocus />
      </FormField>
      <FormField label={t('fDescription')} error={bad.description ? t('errValidation') : null}>
        <Textarea value={values.description} onChange={(e) => setValues({ ...values, description: e.currentTarget.value })} rows={2} maxLength={2000} />
      </FormField>
      <FormField label={t('pLogo')} help={t('pLogoHelp')}>
        <FileInput accept={LOGO_TYPES} maxSize={LOGO_MAX_BYTES} onChange={(files) => setLogo(files[0] ?? null)} onReject={() => setLogo(null)} />
      </FormField>
      <FormField label={t('pRepo')} help={github === null ? undefined : t('pRepoHelp')}>
        {github === null ? (
          <p className="m-0 text-sm text-muted">{t('pRepoNoConnection')} <a href="/app/koneksi" className="text-accent underline underline-offset-4">{t('pRepoConnect')}</a></p>
        ) : (
          <SelectMenu value={repo} onChange={chooseRepo} includeAll={t('pRepoNone')} placeholder={github === undefined ? t('loading') : t('choose')} options={repos.map((r) => ({ value: r.fullName, label: r.fullName }))} disabled={github === undefined} />
        )}
        {repoError && <p role="alert" className="mt-1 mb-0 text-sm text-danger">{t('pRepoLoadFailed')}</p>}
      </FormField>
      <FormField label={t('fVersion')} help={t('fVersionHelp')} error={bad.currentVersion ? t('errValidation') : null}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-40 flex-1">
            <TextInput value={values.currentVersion} onChange={(e) => setValues({ ...values, currentVersion: e.currentTarget.value })} maxLength={40} placeholder="2.1.0" />
          </div>
          {repo && <Button size="sm" loading={versionBusy} onClick={() => fetchVersion(repo)}>{t('pVersionFromRepo')}</Button>}
        </div>
        {versionNote && <p role="status" className="mt-1 mb-0 text-sm text-muted">{versionNote}</p>}
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>{t('add')}</Button>
        <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
      </div>
    </form>
  );
}
