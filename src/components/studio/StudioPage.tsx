import { useState, type FormEvent } from 'react';
import type { getBrandKit, imageQuotaStatus, listAssets, listStudioProducts } from '../../domain/marketing/service';
import { api, badFields, errorKey, upload } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FileInput } from '../forms/FileInput';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { Toggle } from '../forms/Toggle';
import { TextInput } from '../forms/TextInput';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { LOGO_MAX_BYTES, LOGO_TYPES } from '../portfolio/ProductLogo';

type Options = Jsonify<{
  products: Awaited<ReturnType<typeof listStudioProducts>>;
  brandKit: Awaited<ReturnType<typeof getBrandKit>>;
  quota: Awaited<ReturnType<typeof imageQuotaStatus>>;
}>;
type Asset = Jsonify<Awaited<ReturnType<typeof listAssets>>[number]>;
/** What the generate, revise and caption endpoints answer: a result the page can show, not an HTTP error (BR-M10-08). */
type Outcome = { ok: true } | { ok: false; kind: string; message: string };

const PURPOSES = ['launch', 'promo', 'education', 'release', 'brand'] as const;
const PURPOSE_LABEL: Record<(typeof PURPOSES)[number], MessageKey> = { launch: 'mkPurposeLaunch', promo: 'mkPurposePromo', education: 'mkPurposeEducation', release: 'mkPurposeRelease', brand: 'mkPurposeBrand' };
const CORNER_LABEL = { bottom_right: 'mkCornerBottomRight', bottom_left: 'mkCornerBottomLeft', top_right: 'mkCornerTopRight', top_left: 'mkCornerTopLeft' } as const satisfies Record<string, MessageKey>;
const LAYOUT_LABEL = { gradient: 'mkLayoutGradient', center: 'mkLayoutCenter', card: 'mkLayoutCard', band: 'mkLayoutBand', side: 'mkLayoutSide' } as const satisfies Record<string, MessageKey>;
/** Looks that place the words themselves; the top or bottom choice only matters for the others. */
const PLACES_ITSELF = new Set<string>(['center', 'side']);
const layoutOptions = (t: (k: MessageKey) => string) => (Object.keys(LAYOUT_LABEL) as Array<keyof typeof LAYOUT_LABEL>).map((k) => ({ value: k, label: t(LAYOUT_LABEL[k]) }));
const COMPANY = 'company';

type PosterCopy = { headline: string; subheadline: string | null; cta: string | null; showPrice: boolean; layout: keyof typeof LAYOUT_LABEL; textPosition: 'top' | 'bottom'; logo: boolean; corner: keyof typeof CORNER_LABEL };
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
          <SelectMenu value={productFilter} onChange={setProductFilter} includeAll={t('mkFilterProduct')} options={[{ value: COMPANY, label: t('mkScopeCompany') }, ...opts.products.map((p) => ({ value: p.id, label: p.name }))]} />
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
        <BrandLogoEditor saved={Boolean(brandKit)} hasLogo={Boolean(brandKit?.logoFileId)} canEdit={canEdit} onChanged={onSaved} />
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

/** The company logo: shown, replaced or removed. It needs a saved brand kit to hang on (D-066). */
function BrandLogoEditor({ saved, hasLogo, canEdit, onChanged }: { saved: boolean; hasLogo: boolean; canEdit: boolean; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  async function send(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      await upload('/api/marketing/brand-kit/logo', form);
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      setError(String((err as { code?: string }).code) === 'validation' ? t('pLogoBad') : t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', '/api/marketing/brand-kit/logo');
      onChanged();
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium text-ink">{t('mkBrandLogo')}</span>
      {hasLogo && (
        <div className="flex items-center gap-3">
          <img src={`/api/marketing/brand-kit/logo?v=${version}`} alt="" className="size-16 rounded-input border border-rule-2 bg-paper object-contain" />
          {canEdit && <ConfirmButton variant="danger" busy={busy} onConfirm={remove}>{t('pLogoRemove')}</ConfirmButton>}
        </div>
      )}
      {canEdit && (saved ? <FileInput accept={LOGO_TYPES} maxSize={LOGO_MAX_BYTES} disabled={busy} onChange={(files) => files[0] && void send(files[0])} onReject={() => setError(t('pLogoBad'))} /> : <p className="m-0 text-sm text-muted">{t('mkBrandLogoNeedsKit')}</p>)}
      <p className="m-0 text-sm text-muted">{t('mkBrandLogoHelp')}</p>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </div>
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
  const [withText, setWithText] = useState(true);
  const [layout, setLayout] = useState<keyof typeof LAYOUT_LABEL>('gradient');
  const [textPosition, setTextPosition] = useState<'top' | 'bottom'>('bottom');
  const [showPrice, setShowPrice] = useState(false);
  const [useLogo, setUseLogo] = useState(true);
  const [corner, setCorner] = useState<keyof typeof CORNER_LABEL>('bottom_right');
  const [aspect, setAspect] = useState<keyof typeof ASPECT_LABEL>('square');
  const [variants, setVariants] = useState('1');
  const [direction, setDirection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const bad = badFields(error);
  const noQuota = options.quota.remaining < 1;
  const company = productId === COMPANY;
  const hasLogo = Boolean(options.brandKit?.logoFileId) || (!company && Boolean(options.products.find((p) => p.id === productId)?.hasLogo));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setRefused(null);
    try {
      const result = await api<Outcome>('POST', '/api/marketing/assets', { productId: productId === COMPANY ? null : productId, purpose, aspect, variants: Number(variants), direction, logo: useLogo, corner, withText, layout, textPosition, showPrice: showPrice && !company });
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
        {(
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label={t('mkProduct')} required error={bad.productId ? t('errValidation') : null}>
                <SelectMenu value={productId} onChange={setProductId} placeholder={t('choose')} options={[{ value: COMPANY, label: t('mkScopeCompany') }, ...options.products.map((p) => ({ value: p.id, label: p.name }))]} />
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
            <div className="flex flex-col gap-3 rounded-input border border-rule-2 p-3">
              <Toggle label={t('mkWithText')} checked={withText} onChange={setWithText} />
              <p className="m-0 text-sm text-muted">{t('mkWithTextHelp')}</p>
              {withText && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label={t('mkLayout')}>
                    <SelectMenu value={layout} onChange={(v) => setLayout(v as typeof layout)} searchable={false} options={layoutOptions(t)} />
                  </FormField>
                  {!PLACES_ITSELF.has(layout) && (
                    <FormField label={t('mkTextPosition')}>
                      <SelectMenu value={textPosition} onChange={(v) => setTextPosition(v as typeof textPosition)} searchable={false} options={[{ value: 'bottom', label: t('mkTextBottom') }, { value: 'top', label: t('mkTextTop') }]} />
                    </FormField>
                  )}
                  {!company && productId && (
                    <div className="flex flex-col justify-end gap-1">
                      <Toggle label={t('mkShowPrice')} checked={showPrice} onChange={setShowPrice} />
                      <p className="m-0 text-sm text-muted">{t('mkShowPriceHelp')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 rounded-input border border-rule-2 p-3">
              <Toggle label={t('mkLogoUse')} checked={useLogo} onChange={setUseLogo} />
              <p className="m-0 text-sm text-muted">{t('mkLogoUseHelp')}</p>
              {useLogo && productId && !hasLogo && <p role="status" className="m-0 text-sm text-warm-ink">{t('mkLogoMissing')}</p>}
              {useLogo && (
                <div className="max-w-xs">
                  <FormField label={t('mkCorner')}>
                    <SelectMenu value={corner} onChange={(v) => setCorner(v as typeof corner)} searchable={false} options={(Object.keys(CORNER_LABEL) as Array<keyof typeof CORNER_LABEL>).map((k) => ({ value: k, label: t(CORNER_LABEL[k]) }))} />
                  </FormField>
                </div>
              )}
            </div>
            <p className="m-0 text-sm text-muted">{t('mkTextWarningNew')}</p>
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
  const [imageVersion, setImageVersion] = useState(0);

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
      <img src={`${file}?v=${imageVersion}`} alt={`${asset.productName ?? t('mkScopeCompany')} · ${t(PURPOSE_LABEL[asset.purpose])}`} loading="lazy" className="w-full rounded-input border border-rule-2 bg-paper object-contain" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{asset.productName ?? t('mkCompanyBadge')}</span>
        <Badge tone="accent">{t(PURPOSE_LABEL[asset.purpose])}</Badge>
        <Badge>{t('mkAiLabel')}</Badge>
        {asset.parentAssetId && <Badge tone="neutral">{t('mkRevisionOf')}</Badge>}
      </div>
      {asset.posterCopy && <PosterTextEditor asset={asset} onApplied={() => { setImageVersion((v) => v + 1); onChanged(); }} />}
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
        {asset.hasLogo && <a href={`/api/marketing/assets/${asset.id}/logo?download=1`} className={buttonClasses('secondary', 'sm')}>{t('mkDownloadLogo')}</a>}
        {canDelete && <ConfirmButton variant="danger" busy={busy === 'delete'} onConfirm={remove}>{t('delete')}</ConfirmButton>}
      </div>
    </li>
  );
}


/** The words on a poster: edited here and drawn again from the saved background, so no AI is used and nothing is charged (D-067). */
function PosterTextEditor({ asset, onApplied }: { asset: Asset; onApplied: () => void }) {
  const t = useT();
  // Posters made before the looks existed have no `layout`: they were the fade.
  const stored = asset.posterCopy as unknown as PosterCopy;
  const start: PosterCopy = { ...stored, layout: stored.layout ?? 'gradient' };
  const [copy, setCopy] = useState<PosterCopy>(start);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(copy) !== JSON.stringify(start);

  async function apply() {
    setBusy(true);
    setMessage(null);
    try {
      await api('PUT', `/api/marketing/assets/${asset.id}/text`, copy);
      setMessage({ ok: true, text: t('mkTextApplied') });
      onApplied();
    } catch (err) {
      setMessage({ ok: false, text: t(errorKey(err)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-input border border-rule-2 p-3">
      <span className="text-sm font-medium text-ink">{t('mkPosterText')}</span>
      <FormField label={t('mkHeadline')} required>
        <TextInput value={copy.headline} onChange={(e) => setCopy({ ...copy, headline: e.currentTarget.value })} maxLength={70} autoComplete="off" />
      </FormField>
      <FormField label={t('mkSubheadline')}>
        <TextInput value={copy.subheadline ?? ''} onChange={(e) => setCopy({ ...copy, subheadline: e.currentTarget.value })} maxLength={160} autoComplete="off" />
      </FormField>
      <FormField label={t('mkCta')}>
        <TextInput value={copy.cta ?? ''} onChange={(e) => setCopy({ ...copy, cta: e.currentTarget.value })} maxLength={30} autoComplete="off" />
      </FormField>
      <FormField label={t('mkLayout')}>
        <SelectMenu value={copy.layout} onChange={(v) => setCopy({ ...copy, layout: v as PosterCopy['layout'] })} searchable={false} options={layoutOptions(t)} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        {!PLACES_ITSELF.has(copy.layout) && (
          <FormField label={t('mkTextPosition')}>
            <SelectMenu value={copy.textPosition} onChange={(v) => setCopy({ ...copy, textPosition: v as PosterCopy['textPosition'] })} searchable={false} options={[{ value: 'bottom', label: t('mkTextBottom') }, { value: 'top', label: t('mkTextTop') }]} />
          </FormField>
        )}
        <FormField label={t('mkCorner')}>
          <SelectMenu value={copy.corner} onChange={(v) => setCopy({ ...copy, corner: v as PosterCopy['corner'] })} searchable={false} options={(Object.keys(CORNER_LABEL) as Array<keyof typeof CORNER_LABEL>).map((k) => ({ value: k, label: t(CORNER_LABEL[k]) }))} />
        </FormField>
      </div>
      <Toggle label={t('mkLogoUse')} checked={copy.logo} onChange={(v) => setCopy({ ...copy, logo: v })} />
      {asset.productName !== null && <Toggle label={t('mkShowPrice')} checked={copy.showPrice} onChange={(v) => setCopy({ ...copy, showPrice: v })} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="primary" loading={busy} disabled={!dirty || !copy.headline.trim()} onClick={apply}>{t('mkApplyText')}</Button>
        {message && <span role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-sm text-success' : 'text-sm text-danger'}>{message.text}</span>}
      </div>
    </div>
  );
}
