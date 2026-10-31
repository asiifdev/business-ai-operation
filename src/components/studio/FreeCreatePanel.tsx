import { useState } from 'react';
import { ApiError, errorKey, upload } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import { useT } from '../../lib/use-t';
import { FileInput } from '../forms/FileInput';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { TextInput } from '../forms/TextInput';
import { Toggle } from '../forms/Toggle';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { toast } from '../ui/Toast';

const COMPANY = 'company';
const ASPECT_LABEL = { square: 'mkAspectSquare', portrait: 'mkAspectPortrait', story: 'mkAspectStory', wide: 'mkAspectWide' } as const satisfies Record<string, MessageKey>;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_FILES = 4;
const MAX_BYTES = 5 * 1024 * 1024;

type Outcome = { ok: true; assetId: string; caption: string | null } | { ok: false; kind: string; message: string };

/**
 * The main way to make a picture (D-080): say what you want, attach a logo or a screenshot, give a link, and the finished
 * picture comes back. No purposes, looks or text boxes to fill in; the company profile and product facts are added for you.
 */
export function FreeCreatePanel({ products, hasLogo, remaining, quota, onDone }: { products: Array<{ id: string; name: string }>; hasLogo: boolean; remaining: number; quota: number; onDone: () => void }) {
  const t = useT();
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState('');
  const [aspect, setAspect] = useState<keyof typeof ASPECT_LABEL>('square');
  const [productId, setProductId] = useState(COMPANY);
  const [useLogo, setUseLogo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The FileInput keeps its own list; changing this key empties it after a picture was made.
  const [resetKey, setResetKey] = useState(0);
  const noQuota = remaining < 1;

  function why(r: Extract<Outcome, { ok: false }>): string {
    if (r.kind === 'quota') return t('mkQuotaReached');
    if (r.kind === 'unverified') return t('mkFreeUnverified');
    if (r.kind === 'url') return t('mkFreeUrlBad');
    return r.message;
  }

  async function make() {
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set('prompt', prompt);
      form.set('aspect', aspect);
      form.set('productId', productId === COMPANY ? '' : productId);
      if (url.trim()) form.set('url', url.trim());
      form.set('logo', useLogo ? '1' : '0');
      files.forEach((f) => form.append('files', f));
      const r = await upload<Outcome>('/api/marketing/create', form);
      if (r.ok) {
        setPrompt('');
        setUrl('');
        setFiles([]);
        setResetKey((k) => k + 1);
        toast(t('mkFreeDone'));
        onDone();
      } else setNotice(why(r));
    } catch (err) {
      setNotice(err instanceof ApiError && err.code === 'validation' ? t('mkFreeBadInput') : t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="flex flex-col gap-4">
      <div>
        <h2 className="m-0 text-lg font-semibold text-ink">{t('mkFreeTitle')}</h2>
        <p className="mt-1 mb-0 max-w-prose text-sm text-muted">{t('mkFreeHelp')}</p>
      </div>
      <FormField label={t('mkFreePrompt')} help={t('mkFreePromptHelp')}>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.currentTarget.value)} maxLength={1500} rows={4} placeholder={t('mkFreePlaceholder')} />
      </FormField>
      <FormField label={t('mkFreeFiles')} help={t('mkFreeFilesHelp', { n: MAX_FILES })}>
        <FileInput key={resetKey} accept={TYPES} multiple maxFiles={MAX_FILES} maxSize={MAX_BYTES} disabled={busy} onChange={setFiles} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('mkFreeUrl')} help={t('mkFreeUrlHelp')}>
          <TextInput type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.currentTarget.value)} maxLength={500} placeholder="https://" autoComplete="off" />
        </FormField>
        <FormField label={t('mkFreeAbout')} help={t('mkFreeAboutHelp')}>
          <SelectMenu value={productId} onChange={setProductId} options={[{ value: COMPANY, label: t('mkScopeCompany') }, ...products.map((p) => ({ value: p.id, label: p.name }))]} />
        </FormField>
        <FormField label={t('mkAspect')}>
          <SelectMenu value={aspect} onChange={(v) => setAspect(v as keyof typeof ASPECT_LABEL)} searchable={false} options={(Object.keys(ASPECT_LABEL) as Array<keyof typeof ASPECT_LABEL>).map((k) => ({ value: k, label: t(ASPECT_LABEL[k]) }))} />
        </FormField>
        {hasLogo && <Toggle label={t('mkFreeUseLogo')} checked={useLogo} onChange={setUseLogo} />}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={busy} disabled={noQuota || prompt.trim().length < 3} onClick={() => void make()}>{busy ? t('mkFreeMaking') : t('mkFreeMake')}</Button>
        <span className="text-sm text-muted">{noQuota ? t('mkQuotaReached') : busy ? t('mkFreeWait') : t('mkQuota', { remaining, quota })}</span>
      </div>
      {notice && <p role="alert" className="m-0 text-sm text-warm-ink">{notice}</p>}
    </Panel>
  );
}
