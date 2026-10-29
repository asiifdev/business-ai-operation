import { useState, type FormEvent } from 'react';
import type { getBrandKit, imageQuotaStatus, listAssets, listStudioProducts } from '../../domain/marketing/service';
import { api, badFields, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';

type Options = Jsonify<{
  products: Awaited<ReturnType<typeof listStudioProducts>>;
  brandKit: Awaited<ReturnType<typeof getBrandKit>>;
  quota: Awaited<ReturnType<typeof imageQuotaStatus>>;
}>;
type Asset = Jsonify<Awaited<ReturnType<typeof listAssets>>[number]>;
/** What the generate, revise and caption endpoints answer: a result the page can show, not an HTTP error (BR-M10-08). */
type Outcome = { ok: true } | { ok: false; kind: string; message: string };

const PURPOSES = ['launch', 'promo', 'education', 'release'] as const;
const PURPOSE_LABEL: Record<(typeof PURPOSES)[number], MessageKey> = { launch: 'mkPurposeLaunch', promo: 'mkPurposePromo', education: 'mkPurposeEducation', release: 'mkPurposeRelease' };
const ASPECT_LABEL = { square: 'mkAspectSquare', portrait: 'mkAspectPortrait', story: 'mkAspectStory', wide: 'mkAspectWide' } as const satisfies Record<string, MessageKey>;

/** Brand kit, image maker and gallery in one page (BRD-M10). No video or voice anywhere (BR-M10-10). */
export function StudioPage({ canEditBrand, canDeleteAny, userId }: { canEditBrand: boolean; canDeleteAny: boolean; userId: string }) {
  const t = useT();
  const options = useLoad(() => api<Options>('GET', '/api/marketing/options'), []);
  const [productFilter, setProductFilter] = useState('');
  const [purposeFilter, setPurposeFilter] = useState('');
  const qs = new URLSearchParams();
  if (productFilter) qs.set('productId', productFilter);
  if (purposeFilter) qs.set('purpose', purposeFilter);
  const assets = useLoad(() => api<{ assets: Asset[] }>('GET', `/api/marketing/assets${qs.size ? `?${qs}` : ''}`), [productFilter, purposeFilter]);
  const refresh = () => {
    void options.reload();
    void assets.reload();
  };

  if (options.value.state === 'loading') return <Panel aria-busy="true"><Skeleton rows={6} /></Panel>;
  if (options.value.state === 'error') return <Panel><ErrorBox onRetry={options.retry}>{t(errorKey(options.value.error))}</ErrorBox></Panel>;
  const opts = options.value.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('mkTitle')} intro={t('mkIntro')} />
      <BrandKitPanel brandKit={opts.brandKit} canEdit={canEditBrand} onSaved={refresh} />
      <MakePanel options={opts} onDone={refresh} />
      <Panel className="flex flex-col gap-4">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('mkGalleryTitle')}</h2>
        <div className="grid gap-3 sm:max-w-lg sm:grid-cols-2">
          <SelectMenu value={productFilter} onChange={setProductFilter} includeAll={t('mkFilterProduct')} options={opts.products.map((p) => ({ value: p.id, label: p.name }))} />
          <SelectMenu value={purposeFilter} onChange={setPurposeFilter} includeAll={t('mkAllPurposes')} searchable={false} options={PURPOSES.map((p) => ({ value: p, label: t(PURPOSE_LABEL[p]) }))} />
        </div>
        {assets.value.state === 'loading' && <Skeleton rows={4} />}
        {assets.value.state === 'error' && <ErrorBox onRetry={assets.retry}>{t(errorKey(assets.value.error))}</ErrorBox>}
        {assets.value.state === 'ready' && assets.value.data.assets.length === 0 && <EmptyState>{t('mkGalleryEmpty')}</EmptyState>}
        {assets.value.state === 'ready' && assets.value.data.assets.length > 0 && (
          <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {assets.value.data.assets.map((a) => (
              <AssetCard key={a.id} asset={a} canDelete={canDeleteAny || a.createdBy === userId} onChanged={refresh} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function BrandKitPanel({ brandKit, canEdit, onSaved }: { brandKit: Options['brandKit']; canEdit: boolean; onSaved: () => void }) {
  const t = useT();
  const [brandName, setBrandName] = useState(brandKit?.brandName ?? '');
  const [colors, setColors] = useState(brandKit?.colors ?? '');
  const [tone, setTone] = useState(brandKit?.tone ?? '');
  const [prohibitions, setProhibitions] = useState(brandKit?.prohibitions ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const bad = badFields(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('PUT', '/api/marketing/brand-kit', { brandName, colors, tone, prohibitions });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div>
          <h2 className="m-0 text-lg font-semibold text-ink">{t('mkBrandTitle')}</h2>
          <p className="mt-1 mb-0 text-sm text-muted">{brandKit ? t('mkBrandHelp') : t('mkBrandMissing')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('mkBrandName')} required error={bad.brandName ? t('errValidation') : null}>
            <TextInput value={brandName} onChange={(e) => setBrandName(e.currentTarget.value)} maxLength={120} disabled={!canEdit} autoComplete="off" />
          </FormField>
          <FormField label={t('mkBrandColors')} help={t('mkBrandColorsHelp')}>
            <TextInput value={colors} onChange={(e) => setColors(e.currentTarget.value)} maxLength={300} disabled={!canEdit} autoComplete="off" />
          </FormField>
          <FormField label={t('mkBrandTone')} help={t('mkBrandToneHelp')}>
            <Textarea value={tone} onChange={(e) => setTone(e.currentTarget.value)} maxLength={500} rows={2} disabled={!canEdit} />
          </FormField>
          <FormField label={t('mkBrandProhibitions')} help={t('mkBrandProhibitionsHelp')}>
            <Textarea value={prohibitions} onChange={(e) => setProhibitions(e.currentTarget.value)} maxLength={500} rows={2} disabled={!canEdit} />
          </FormField>
        </div>
        {error !== null && !Object.keys(bad).length && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" loading={busy}>{t('mkBrandSave')}</Button>
            {saved && <span role="status" className="text-sm text-success">{t('mkBrandSaved')}</span>}
          </div>
        )}
      </form>
    </Panel>
  );
}

/** A refused result (quota, safety filter, budget) becomes plain words; nothing is thrown at the person (BR-M10-08). */
function outcomeMessage(t: ReturnType<typeof useT>, r: Extract<Outcome, { ok: false }>): string {
  if (r.kind === 'quota') return t('mkQuotaReached');
  if (r.kind === 'foreign_figures') return t('mkCaptionDiscarded');
  return r.message;
}

function MakePanel({ options, onDone }: { options: Options; onDone: () => void }) {
  const t = useT();
  const [productId, setProductId] = useState('');
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>('launch');
  const [aspect, setAspect] = useState<keyof typeof ASPECT_LABEL>('square');
  const [variants, setVariants] = useState('1');
  const [direction, setDirection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const bad = badFields(error);
  const noQuota = options.quota.remaining < 1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setRefused(null);
    try {
      const result = await api<Outcome>('POST', '/api/marketing/assets', { productId, purpose, aspect, variants: Number(variants), direction });
      if (result.ok) onDone();
      else setRefused(outcomeMessage(t, result));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <h2 className="m-0 text-lg font-semibold text-ink">{t('mkMakeTitle')}</h2>
        {options.products.length === 0 ? (
          <EmptyState>{t('mkNoProducts')}</EmptyState>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label={t('mkProduct')} required error={bad.productId ? t('errValidation') : null}>
                <SelectMenu value={productId} onChange={setProductId} placeholder={t('choose')} options={options.products.map((p) => ({ value: p.id, label: p.name }))} />
              </FormField>
              <FormField label={t('mkPurpose')} required>
                <SelectMenu value={purpose} onChange={(v) => setPurpose(v as typeof purpose)} searchable={false} options={PURPOSES.map((p) => ({ value: p, label: t(PURPOSE_LABEL[p]) }))} />
              </FormField>
              <FormField label={t('mkAspect')}>
                <SelectMenu value={aspect} onChange={(v) => setAspect(v as typeof aspect)} searchable={false} options={(Object.keys(ASPECT_LABEL) as Array<keyof typeof ASPECT_LABEL>).map((k) => ({ value: k, label: t(ASPECT_LABEL[k]) }))} />
              </FormField>
              <FormField label={t('mkVariants')}>
                <SelectMenu value={variants} onChange={setVariants} searchable={false} options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))} />
              </FormField>
            </div>
            <FormField label={t('mkDirection')} help={t('mkDirectionHelp')}>
              <Textarea value={direction} onChange={(e) => setDirection(e.currentTarget.value)} maxLength={500} rows={2} />
            </FormField>
            <p className="m-0 text-sm text-muted">{t('mkTextWarning')}</p>
            {error !== null && !Object.keys(bad).length && <ErrorBox>{t(errorKey(error))}</ErrorBox>}
            {refused && <ErrorBox>{refused}</ErrorBox>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" loading={busy} disabled={noQuota || !productId}>{busy ? t('mkGenerating') : t('mkGenerate')}</Button>
              <span className="text-sm text-muted">{noQuota ? t('mkQuotaReached') : t('mkQuota', { remaining: options.quota.remaining, quota: options.quota.quota })}</span>
            </div>
          </>
        )}
      </form>
    </Panel>
  );
}

function AssetCard({ asset, canDelete, onChanged }: { asset: Asset; canDelete: boolean; onChanged: () => void }) {
  const t = useT();
  const [caption, setCaption] = useState(asset.caption ?? '');
  const [instruction, setInstruction] = useState('');
  const [reviseOpen, setReviseOpen] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'save' | 'revise' | 'delete' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const file = `/api/marketing/assets/${asset.id}/file`;

  async function run<T>(what: NonNullable<typeof busy>, fn: () => Promise<T>) {
    setBusy(what);
    setMessage(null);
    try {
      return await fn();
    } catch (err) {
      setMessage(t(errorKey(err)));
    } finally {
      setBusy(null);
    }
  }

  const draft = () =>
    run('draft', async () => {
      const r = await api<Outcome & { caption?: string }>('POST', `/api/marketing/assets/${asset.id}/caption`);
      if (r.ok && r.caption) setCaption(r.caption);
      else if (!r.ok) setMessage(outcomeMessage(t, r));
    });
  const save = () => run('save', () => api('PUT', `/api/marketing/assets/${asset.id}/caption`, { caption }).then(onChanged));
  const revise = () =>
    run('revise', async () => {
      const r = await api<Outcome>('POST', `/api/marketing/assets/${asset.id}/revise`, { instruction });
      if (r.ok) {
        setInstruction('');
        setReviseOpen(false);
        onChanged();
      } else setMessage(outcomeMessage(t, r));
    });
  const remove = () => run('delete', () => api('DELETE', `/api/marketing/assets/${asset.id}`).then(onChanged));
  async function copy() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMessage(t('genericError'));
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-card border border-rule-2 bg-paper-2 p-3">
      <img src={file} alt={`${asset.productName} · ${t(PURPOSE_LABEL[asset.purpose])}`} loading="lazy" className="w-full rounded-input border border-rule-2 bg-paper object-contain" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{asset.productName}</span>
        <Badge tone="accent">{t(PURPOSE_LABEL[asset.purpose])}</Badge>
        <Badge>{t('mkAiLabel')}</Badge>
        {asset.parentAssetId && <Badge tone="neutral">{t('mkRevisionOf')}</Badge>}
      </div>
      <FormField label={t('mkCaption')} help={t('mkCaptionHelp')}>
        <Textarea value={caption} onChange={(e) => setCaption(e.currentTarget.value)} maxLength={2200} rows={3} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy === 'draft'} onClick={draft}>{t('mkCaptionDraft')}</Button>
        <Button size="sm" loading={busy === 'save'} disabled={!caption.trim()} onClick={save}>{t('mkCaptionSave')}</Button>
        <Button size="sm" disabled={!caption.trim()} onClick={copy}>{copied ? t('copied') : t('mkCaptionCopy')}</Button>
      </div>
      {reviseOpen && (
        <div className="flex flex-col gap-2">
          <FormField label={t('mkReviseInstruction')} help={t('mkReviseHelp')}>
            <TextInput value={instruction} onChange={(e) => setInstruction(e.currentTarget.value)} maxLength={400} autoComplete="off" />
          </FormField>
          <div>
            <Button size="sm" variant="primary" loading={busy === 'revise'} disabled={instruction.trim().length < 3} onClick={revise}>{t('mkReviseGo')}</Button>
          </div>
        </div>
      )}
      {message && <ErrorBox>{message}</ErrorBox>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setReviseOpen((v) => !v)}>{t('mkRevise')}</Button>
        <a href={`${file}?download=1`} className={buttonClasses('secondary', 'sm')}>{t('mkDownload')}</a>
        {canDelete && <ConfirmButton variant="danger" busy={busy === 'delete'} onConfirm={remove}>{t('delete')}</ConfirmButton>}
      </div>
    </li>
  );
}
