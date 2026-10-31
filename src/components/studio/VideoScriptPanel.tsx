import { useState } from 'react';
import type { VideoScript } from '../../domain/marketing/service';
import { api, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { Textarea } from '../forms/Textarea';
import { Icon } from '../shell/Icon';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { toast } from '../ui/Toast';

type Script = Jsonify<VideoScript>;
type Outcome = { ok: true; script: Script } | { ok: false; kind: string; message: string };
const COMPANY = 'company';
const PURPOSES = ['launch', 'promo', 'education', 'release', 'brand'] as const;
const PURPOSE_LABEL: Record<(typeof PURPOSES)[number], MessageKey> = { launch: 'mkPurposeLaunch', promo: 'mkPurposePromo', education: 'mkPurposeEducation', release: 'mkPurposeRelease', brand: 'mkPurposeBrand' };

/** The script as plain text to paste into another tool. */
function scriptText(s: Script): string {
  return [s.title, '', s.hook, '', ...s.scenes.flatMap((x, i) => [`${i + 1}. ${x.from}-${x.to}s`, `Visual: ${x.visual}`, `Voiceover: ${x.voiceover}`, ...(x.onScreenText ? [`On screen: ${x.onScreenText}`] : []), '']), s.cta].join('\n');
}

/**
 * A written script and storyboard for a short video, from the company profile and product facts (D-079). The Meta Model
 * API makes no video, so this is text only and says so; it is not stored.
 */
export function VideoScriptPanel({ products }: { products: Array<{ id: string; name: string }> }) {
  const t = useT();
  const [productId, setProductId] = useState(COMPANY);
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>('brand');
  const [seconds, setSeconds] = useState('30');
  const [direction, setDirection] = useState('');
  const [busy, setBusy] = useState(false);
  const [script, setScript] = useState<Script | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api<Outcome>('POST', '/api/marketing/video-script', { productId: productId === COMPANY ? null : productId, purpose, seconds: Number(seconds), direction: direction || undefined });
      if (r.ok) setScript(r.script);
      else setNotice(r.kind === 'foreign_figures' ? t('mkScriptDiscarded') : r.message);
    } catch (err) {
      setNotice(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(scriptText(script));
      toast(t('copied'));
    } catch {
      toast(t('copyBlocked'), 'danger');
    }
  }

  return (
    <Panel className="flex flex-col gap-4">
      <div>
        <h2 className="m-0 text-lg font-semibold text-ink">{t('mkScriptTitle')}</h2>
        <p className="mt-1 mb-0 max-w-prose text-sm text-muted">{t('mkScriptHelp')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('mkProduct')}>
          <SelectMenu value={productId} onChange={setProductId} options={[{ value: COMPANY, label: t('mkScopeCompany') }, ...products.map((p) => ({ value: p.id, label: p.name }))]} />
        </FormField>
        <FormField label={t('mkPurpose')}>
          <SelectMenu value={purpose} onChange={(v) => setPurpose(v as typeof purpose)} searchable={false} options={PURPOSES.map((p) => ({ value: p, label: t(PURPOSE_LABEL[p]) }))} />
        </FormField>
        <FormField label={t('mkScriptLength')}>
          <SelectMenu value={seconds} onChange={setSeconds} searchable={false} options={['15', '30', '60'].map((s) => ({ value: s, label: t('mkScriptSeconds', { n: s }) }))} />
        </FormField>
      </div>
      <FormField label={t('mkDirection')} help={t('mkScriptDirectionHelp')}>
        <Textarea value={direction} onChange={(e) => setDirection(e.currentTarget.value)} maxLength={300} rows={2} />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={busy} onClick={() => void make()}>{busy ? t('mkScriptWriting') : t('mkScriptWrite')}</Button>
        {notice && <span role="status" className="text-sm text-warm-ink">{notice}</span>}
      </div>
      {script && (
        <div className="flex flex-col gap-4 rounded-card border border-rule p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="m-0 text-base font-semibold text-ink [overflow-wrap:anywhere]">{script.title}</h3>
              <p className="mt-1 mb-0 text-ink-2 [overflow-wrap:anywhere]">{script.hook}</p>
            </div>
            <Button size="sm" onClick={() => void copy()}><Icon name="copy" className="size-4" />{t('mkScriptCopy')}</Button>
          </div>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {script.scenes.map((s, i) => (
              <li key={i} className="grid gap-1 rounded border border-rule bg-paper-2 p-3 sm:grid-cols-[6rem_1fr]">
                <span className="text-sm font-medium text-ink tabular-nums">{i + 1} · {s.from}–{s.to}s</span>
                <div className="flex flex-col gap-1 text-sm">
                  <p className="m-0 text-ink [overflow-wrap:anywhere]"><span className="text-muted">{t('mkScriptVisual')}: </span>{s.visual}</p>
                  <p className="m-0 text-ink [overflow-wrap:anywhere]"><span className="text-muted">{t('mkScriptVoiceover')}: </span>{s.voiceover}</p>
                  {s.onScreenText && <p className="m-0 text-ink [overflow-wrap:anywhere]"><span className="text-muted">{t('mkScriptOnScreen')}: </span>{s.onScreenText}</p>}
                </div>
              </li>
            ))}
          </ol>
          <p className="m-0 text-ink"><span className="text-muted">{t('mkScriptCta')}: </span>{script.cta}</p>
        </div>
      )}
    </Panel>
  );
}
