import { useEffect, useState } from 'react';
import { NARRATORS } from '../../config/narrators';
import type { VideoScript } from '../../domain/marketing/service';
import type { getVideo, listVideos } from '../../domain/marketing/video';
import { api, errorKey } from '../../lib/api-client';
import type { MessageKey } from '../../lib/i18n';
import type { Jsonify } from '../../lib/json-types';
import { useLoad } from '../../lib/use-load';
import { useT } from '../../lib/use-t';
import { FormField } from '../forms/FormField';
import { SelectMenu } from '../forms/SelectMenu';
import { TextInput } from '../forms/TextInput';
import { Textarea } from '../forms/Textarea';
import { Icon } from '../shell/Icon';
import { Badge } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/Panel';
import { EmptyState, ErrorBox, Skeleton } from '../ui/states';
import { toast } from '../ui/Toast';

type Script = Jsonify<VideoScript>;
type VideoItem = Jsonify<Awaited<ReturnType<typeof listVideos>>[number]>;
type VideoDetail = Jsonify<Awaited<ReturnType<typeof getVideo>>>;
type Outcome = { ok: true; script: Script; projectId: string } | { ok: false; kind: string; message: string };
type Queued = { ok: true; estimateMinutes: number } | { ok: false; kind: string; needed: number; remaining: number };
const COMPANY = 'company';
const PURPOSES = ['launch', 'promo', 'education', 'release', 'brand'] as const;
const PURPOSE_LABEL: Record<(typeof PURPOSES)[number], MessageKey> = { launch: 'mkPurposeLaunch', promo: 'mkPurposePromo', education: 'mkPurposeEducation', release: 'mkPurposeRelease', brand: 'mkPurposeBrand' };
const SHAPE_LABEL = { story: 'mkVideoShapeStory', square: 'mkVideoShapeSquare', wide: 'mkVideoShapeWide' } as const satisfies Record<string, MessageKey>;
const STATUS_LABEL = { script: 'mkVideoStatusScript', queued: 'mkVideoStatusQueued', rendering: 'mkVideoStatusRendering', done: 'mkVideoStatusDone', failed: 'mkVideoStatusFailed' } as const satisfies Record<string, MessageKey>;
const STAGE_LABEL: Record<string, MessageKey> = { check: 'mkVideoStageCheck', images: 'mkVideoStageImages', voice: 'mkVideoStageVoice', assemble: 'mkVideoStageAssemble' };
const STATUS_TONE = { script: 'neutral', queued: 'warn', rendering: 'accent', done: 'success', failed: 'danger' } as const;

/** The script as plain text to paste into another tool. */
function scriptText(s: { title: string; hook: string; cta: string; scenes: Array<{ from: number; to: number; visual: string; voiceover: string; onScreenText: string }> }): string {
  return [s.title, '', s.hook, '', ...s.scenes.flatMap((x, i) => [`${i + 1}. ${x.from}-${x.to}s`, `Visual: ${x.visual}`, `Voiceover: ${x.voiceover}`, ...(x.onScreenText ? [`On screen: ${x.onScreenText}`] : []), '']), s.cta].join('\n');
}

/**
 * Video in one place (D-086): write a script, check and edit what is said and shown, make the video, and keep every script
 * and video in a list that survives a reload. The video is a narrated slideshow built by Orbyte; nothing here claims
 * generated motion, and every video is marked as made by AI.
 */
export function VideoScriptPanel({ products, imagesLeft }: { products: Array<{ id: string; name: string }>; imagesLeft: number }) {
  const t = useT();
  const list = useLoad(() => api<{ videos: VideoItem[] }>('GET', '/api/marketing/videos'), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const videos = list.value.state === 'ready' ? list.value.data.videos : [];
  const working = videos.some((v) => v.status === 'queued' || v.status === 'rendering');

  // While a video is being made, the list refreshes by itself so the bar moves and the finished video appears.
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void list.reload(), 4000);
    return () => clearInterval(timer);
  }, [working, list]);

  return (
    <div className="flex flex-col gap-6">
      <Writer products={products} onSaved={(id) => { void list.reload(); setOpenId(id); }} />
      {openId && <Editor key={openId} id={openId} imagesLeft={imagesLeft} onClose={() => setOpenId(null)} onQueued={() => { setOpenId(null); void list.reload(); }} />}
      <Panel className="flex flex-col gap-4">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('mkVideoListTitle')}</h2>
        {list.value.state === 'loading' && <Skeleton rows={3} />}
        {list.value.state === 'error' && <ErrorBox onRetry={list.retry}>{t(errorKey(list.value.error))}</ErrorBox>}
        {list.value.state === 'ready' && videos.length === 0 && <EmptyState>{t('mkVideoListEmpty')}</EmptyState>}
        {videos.length > 0 && (
          <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} onOpen={() => setOpenId(v.id)} onChanged={() => void list.reload()} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Writer({ products, onSaved }: { products: Array<{ id: string; name: string }>; onSaved: (projectId: string) => void }) {
  const t = useT();
  const [productId, setProductId] = useState(COMPANY);
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>('brand');
  const [seconds, setSeconds] = useState('30');
  const [direction, setDirection] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api<Outcome>('POST', '/api/marketing/video-script', { productId: productId === COMPANY ? null : productId, purpose, seconds: Number(seconds), direction: direction || undefined });
      if (r.ok) onSaved(r.projectId);
      else setNotice(r.kind === 'foreign_figures' ? t('mkScriptDiscarded') : r.message);
    } catch (err) {
      setNotice(t(errorKey(err)));
    } finally {
      setBusy(false);
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
    </Panel>
  );
}

/** One saved script opened for checking: the person may fix what is said and shown before the video is made. */
function Editor({ id, imagesLeft, onClose, onQueued }: { id: string; imagesLeft: number; onClose: () => void; onQueued: () => void }) {
  const t = useT();
  const load = useLoad(() => api<VideoDetail>('GET', `/api/marketing/videos/${id}`), [id]);
  const [narration, setNarration] = useState<string[] | null>(null);
  const [screen, setScreen] = useState<string[]>([]);
  const [shape, setShape] = useState<keyof typeof SHAPE_LABEL>('story');
  const [narrator, setNarrator] = useState<keyof typeof NARRATORS>('sinta');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const video = load.value.state === 'ready' ? load.value.data : null;
  useEffect(() => {
    if (!video || narration) return;
    setNarration(video.script.scenes.map((s) => s.voiceover));
    setScreen(video.script.scenes.map((s) => s.onScreenText));
    setShape((video.aspect as keyof typeof SHAPE_LABEL) in SHAPE_LABEL ? (video.aspect as keyof typeof SHAPE_LABEL) : 'story');
  }, [video, narration]);

  if (load.value.state === 'loading') return <Panel aria-busy="true"><p className="m-0 text-sm text-muted">{t('mkVideoLoading')}</p></Panel>;
  if (load.value.state === 'error') return <Panel><ErrorBox onRetry={load.retry}>{t(errorKey(load.value.error))}</ErrorBox></Panel>;
  if (!video || !narration) return null;
  const script = video.script;
  const canMake = video.status === 'script' || video.status === 'failed';
  const enough = imagesLeft >= script.scenes.length;

  async function make() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api<Queued>('POST', `/api/marketing/videos/${id}/render`, { narrator, aspect: shape, scenes: script.scenes.map((_, i) => ({ voiceover: narration![i] ?? '', onScreenText: screen[i] ?? '' })) });
      if (r.ok) {
        toast(t('mkVideoQueued'));
        onQueued();
      } else setNotice(t('mkVideoQuotaShort', { n: r.needed, left: r.remaining }));
    } catch (err) {
      setNotice(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(scriptText(script));
      toast(t('copied'));
    } catch {
      toast(t('copyBlocked'), 'danger');
    }
  }

  return (
    <Panel className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold text-ink [overflow-wrap:anywhere]">{video.title}</h3>
          <p className="mt-1 mb-0 text-ink-2 [overflow-wrap:anywhere]">{script.hook}</p>
        </div>
        <Button size="sm" onClick={() => void copy()}><Icon name="copy" className="size-4" />{t('mkScriptCopy')}</Button>
        <Button size="sm" onClick={onClose}>{t('mkVideoClose')}</Button>
      </div>
      {video.status === 'failed' && video.error && <ErrorBox>{video.error}</ErrorBox>}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {script.scenes.map((s, i) => (
          <li key={i} className="flex flex-col gap-3 rounded-card border border-rule bg-paper-2 p-3">
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="font-medium text-ink tabular-nums">{i + 1} · {s.from}–{s.to}s</span>
              <span className="min-w-0 text-ink-2 [overflow-wrap:anywhere]"><span className="text-muted">{t('mkScriptVisual')}: </span>{s.visual}</span>
            </div>
            <FormField label={t('mkVideoNarration')} help={i === 0 ? t('mkVideoNarrationHelp') : undefined}>
              <Textarea value={narration[i] ?? ''} onChange={(e) => { const v = e.currentTarget.value; setNarration((p) => (p ?? []).map((x, j) => (j === i ? v : x))); }} maxLength={400} rows={2} disabled={!canMake} />
            </FormField>
            <FormField label={t('mkVideoOnScreen')}>
              <TextInput value={screen[i] ?? ''} onChange={(e) => { const v = e.currentTarget.value; setScreen((p) => p.map((x, j) => (j === i ? v : x))); }} maxLength={60} autoComplete="off" disabled={!canMake} />
            </FormField>
          </li>
        ))}
      </ol>
      <p className="m-0 text-ink"><span className="text-muted">{t('mkScriptCta')}: </span>{script.cta}</p>
      {canMake && (
        <div className="flex flex-col gap-4 border-t border-rule pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('mkVideoNarrator')} help={NARRATORS[narrator].blurb}>
              <SelectMenu value={narrator} onChange={(v) => setNarrator(v as typeof narrator)} searchable={false} options={Object.values(NARRATORS).map((n) => ({ value: n.key, label: n.name }))} />
            </FormField>
            <FormField label={t('mkVideoShape')}>
              <SelectMenu value={shape} onChange={(v) => setShape(v as typeof shape)} searchable={false} options={(Object.keys(SHAPE_LABEL) as Array<keyof typeof SHAPE_LABEL>).map((k) => ({ value: k, label: t(SHAPE_LABEL[k]) }))} />
            </FormField>
          </div>
          <p className="m-0 text-sm text-muted">{enough ? t('mkVideoEstimate', { n: script.scenes.length, left: imagesLeft, min: video.estimateMinutes }) : t('mkVideoQuotaShort', { n: script.scenes.length, left: imagesLeft })}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={busy} disabled={!enough} onClick={() => void make()}>{busy ? t('mkVideoMaking') : t('mkVideoMake')}</Button>
            {notice && <span role="status" className="text-sm text-warm-ink">{notice}</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}

function VideoCard({ video, onOpen, onChanged }: { video: VideoItem; onOpen: () => void; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const file = `/api/marketing/videos/${video.id}/file`;
  const active = video.status === 'queued' || video.status === 'rendering';
  const when = new Date(video.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  async function remove() {
    setBusy(true);
    try {
      await api('DELETE', `/api/marketing/videos/${video.id}`);
      onChanged();
    } catch (err) {
      toast(t(errorKey(err)), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-card border border-rule-2 bg-paper-2 p-3">
      {video.status === 'done' && video.hasFile && <video controls preload="metadata" src={`${file}#t=0.6`} className={`w-full rounded-input border border-rule-2 bg-black ${video.aspect === 'story' ? 'max-h-96 object-contain' : ''}`} />}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">{video.title}</span>
        <Badge tone={STATUS_TONE[video.status]}>{t(STATUS_LABEL[video.status])}</Badge>
        {video.status === 'done' && <Badge>{t('mkVideoAi')}</Badge>}
      </div>
      <p className="m-0 text-sm text-muted">
        {video.productName ?? t('mkCompanyBadge')} · {t(PURPOSE_LABEL[video.purpose as (typeof PURPOSES)[number]] ?? 'mkPurposeBrand')} · {video.status === 'done' && video.durationMs ? t('mkVideoActual', { n: Math.round(video.durationMs / 1000) }) : t('mkScriptSeconds', { n: video.seconds })} · {when}
      </p>
      {active && (
        <div className="flex flex-col gap-1" role="status" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-paper" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(video.progress, 3)}%` }} />
          </div>
          <span className="text-sm text-muted">{video.stage ? t(STAGE_LABEL[video.stage] ?? 'mkVideoStatusRendering') : t('mkVideoStatusQueued')} · {video.progress}%</span>
        </div>
      )}
      {video.status === 'failed' && video.error && <p role="alert" className="m-0 text-sm text-danger">{video.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {video.status === 'done' && video.hasFile && <a href={`${file}?download=1`} className={buttonClasses('secondary', 'sm')}>{t('mkVideoDownload')}</a>}
        {(video.status === 'script' || video.status === 'failed') && <Button size="sm" onClick={onOpen}>{video.status === 'failed' ? t('mkVideoRetry') : t('mkVideoOpen')}</Button>}
        {video.status !== 'rendering' && <ConfirmButton message={t('mkVideoDeleteConfirm')} variant="danger" busy={busy} onConfirm={remove}>{t('delete')}</ConfirmButton>}
      </div>
    </li>
  );
}
