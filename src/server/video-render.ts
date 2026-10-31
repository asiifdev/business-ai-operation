import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { getAiProvider } from '../ai/index';
import type { AiProvider } from '../ai/provider';
import { generateImagesOnce, transcribeOnce } from '../ai/run';
import { db } from '../db/client';
import { newId } from '../db/ids';
import { files, organizationProfiles, organizations, users, videoProjects } from '../db/schema';
import { narratorOf } from '../config/narrators';
import { recordAudit } from '../domain/audit/service';
import { userCtx, type Ctx } from '../domain/ctx';
import { who } from '../domain/portfolio/shared';
import { applyLogo } from '../domain/marketing/poster';
import { firstHex, renderPoster } from '../domain/marketing/poster-render';
import { imageQuotaStatus, resolveLogo } from '../domain/marketing/service';
import type { VideoScriptData } from '../domain/marketing/video';
import {
  clipArgs,
  concatArgs,
  concatList,
  imageSizeOf,
  MAX_TAKES,
  progressOf,
  sceneImagePrompt,
  sceneSeconds,
  sceneSpeech,
  stumbled,
  VIDEO_ASPECTS,
  wavDurationMs,
  type VideoAspect,
  type VideoStage,
} from '../domain/marketing/video-rules';
import { getNarration, NarrationError, type Narration } from '../integrations/speech/voicestudio';
import { storage as configuredStorage, type Storage } from '../integrations/storage';
import { env } from '../lib/env';
import { type Clock, systemClock } from '../lib/clock';
import { translate, type Locale } from '../lib/i18n';

// Job `video.render` (D-086): script → one picture per scene (Muse Image) → words drawn by code → narration per scene (the
// voice engine) → ffmpeg joins them into an MP4. Every model call goes through the budget check and lands in `ai_runs`
// (BR-M07). A failure is final and said in plain words: a retry would pay for the same pictures twice, so the person
// starts again with the button instead.

export interface VideoDeps {
  provider: AiProvider;
  narration: Narration;
  storage: Storage;
  ffmpeg: (args: string[]) => Promise<void>;
  clock: Clock;
}

export function runFfmpeg(args: string[], timeoutMs = 6 * 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(env('FFMPEG_PATH') ?? 'ffmpeg', ['-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr = (stderr + String(d)).slice(-1500);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err: Error & { code?: string }) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new Error('ffmpeg_missing') : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.split('\n').filter(Boolean).at(-1) ?? ''}`));
    });
  });
}

const defaultDeps = (): VideoDeps => ({ provider: getAiProvider(), narration: getNarration(), storage: configuredStorage(), ffmpeg: runFfmpeg, clock: systemClock });

type ErrKey = 'videoErrVoiceDown' | 'videoErrWrongEngine' | 'videoErrQuota' | 'videoErrImage' | 'videoErrVoice' | 'videoErrAssemble' | 'videoErrFfmpeg' | 'videoErrInactive' | 'videoErrBudget';

class Stop extends Error {
  constructor(public readonly key: ErrKey) {
    super(key);
  }
}

export async function renderVideo(payload: Record<string, unknown>, deps: VideoDeps = defaultDeps()): Promise<Record<string, unknown>> {
  const projectId = String(payload.projectId ?? '');
  const [project] = await db.select().from(videoProjects).where(eq(videoProjects.id, projectId));
  if (!project || project.status !== 'queued') return { skipped: true };
  const orgId = project.orgId;

  const [person] = await db.select({ role: users.role, locale: users.locale, isActive: users.isActive }).from(users).where(and(eq(users.orgId, orgId), eq(users.id, project.createdBy)));
  const locale: Locale = person?.locale === 'en' ? 'en' : 'id';
  const t = (key: ErrKey) => translate(locale, key);
  const mark = (stage: VideoStage, done = 0, total = 0, status: 'rendering' = 'rendering') =>
    db.update(videoProjects).set({ status, stage, progress: progressOf(stage, done, total), updatedAt: new Date() }).where(and(eq(videoProjects.orgId, orgId), eq(videoProjects.id, projectId)));
  const failWith = async (message: string) => {
    await db.transaction(async (tx) => {
      await tx.update(videoProjects).set({ status: 'failed', error: message.slice(0, 500), updatedAt: new Date() }).where(and(eq(videoProjects.orgId, orgId), eq(videoProjects.id, projectId)));
      await recordAudit(tx, { orgId, actor: 'system:video', userId: null }, { action: 'video.failed', entityType: 'video_project', entityId: projectId, summary: { reason: message.slice(0, 120) } });
    });
    return { failed: true };
  };
  if (!person?.isActive) return failWith(t('videoErrInactive'));

  const ctx: Ctx = userCtx({ orgId, userId: project.createdBy, role: person.role }, deps.clock);
  const script = project.script as unknown as VideoScriptData;
  const aspect = project.aspect as VideoAspect;
  const dims = VIDEO_ASPECTS[aspect] ?? VIDEO_ASPECTS.story;
  const narrator = narratorOf(project.narrator);
  const dir = await mkdtemp(join(tmpdir(), 'orbyte-video-'));
  const stumbledOnTake = async (wav: Uint8Array, line: string): Promise<boolean> => {
    try {
      const raw = join(dir, 'take.wav');
      const small = join(dir, 'take-24k.wav');
      await writeFile(raw, wav);
      await deps.ffmpeg(['-y', '-i', raw, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', small]);
      const heard = await transcribeOnce({ db, ctx, provider: deps.provider, locale, request: { wav: new Uint8Array(await readFile(small)), mode: 'ENDPOINTING', languageBias: ['Indonesian'] }, inputSummary: 'Pemeriksaan rekaman narasi video', entityType: 'organization', entityId: orgId });
      return heard.ok ? stumbled(line, heard.value.turns.map((t) => t.transcript).join(' ')) : false;
    } catch {
      return false;
    }
  };
  try {
    await mark('check');
    try {
      await deps.narration.check();
    } catch (err) {
      throw new Stop(err instanceof NarrationError && err.kind === 'wrong_engine' ? 'videoErrWrongEngine' : 'videoErrVoiceDown');
    }
    if ((await imageQuotaStatus(ctx)).remaining < script.scenes.length) throw new Stop('videoErrQuota');

    // 1. A picture per scene, with the scene's words and the real logo drawn by code on top.
    const logo = await resolveLogo(ctx, project.productId).catch(() => null);
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
    const [profile] = await db.select({ pronunciation: organizationProfiles.namePronunciation }).from(organizationProfiles).where(eq(organizationProfiles.orgId, orgId));
    const company = { name: org?.name ?? '', pronunciation: profile?.pronunciation ?? null };
    const images: string[] = [];
    for (const [i, scene] of script.scenes.entries()) {
      await mark('images', i, script.scenes.length);
      const out = await generateImagesOnce({
        db,
        ctx,
        provider: deps.provider,
        locale,
        inputSummary: `Video adegan ${i + 1} dari ${script.scenes.length}`,
        entityType: project.productId ? 'product' : 'organization',
        entityId: project.productId ?? orgId,
        request: { prompt: sceneImagePrompt(scene.visual, null, aspect), n: 1, size: imageSizeOf(aspect), grounding: false, safetyIdentifier: createHash('sha256').update(ctx.userId).digest('hex').slice(0, 32) },
      });
      if (!out.ok) throw new Stop(out.kind === 'budget' ? 'videoErrBudget' : 'videoErrImage');
      const background = out.value.images[0]?.bytes;
      if (!background) throw new Stop('videoErrImage');
      let framed: Uint8Array = background;
      try {
        framed = scene.onScreenText.trim()
          ? await renderPoster({ background, logo: logo?.bytes ?? null, text: { headline: scene.onScreenText.trim() }, priceLine: null, layout: 'gradient', textPosition: 'bottom', corner: 'top_right', accent: firstHex(null), safeBottom: aspect === 'story' ? 0.16 : 0.08 })
          : logo
            ? await applyLogo(background, logo.bytes, 'top_right')
            : background;
      } catch (err) {
        console.error('video scene text could not be drawn', err instanceof Error ? err.message : err);
      }
      const path = join(dir, `scene-${i}.jpg`);
      await writeFile(path, await sharp(framed).jpeg({ quality: 90 }).toBuffer());
      images.push(path);
    }

    // 2. The narration of each scene. Its length decides how long the picture stays.
    const audio: Array<{ path: string; seconds: number }> = [];
    for (const [i, scene] of script.scenes.entries()) {
      await mark('voice', i, script.scenes.length);
      const line = sceneSpeech(scene, company);
      let wav: Uint8Array = new Uint8Array();
      // The voice sometimes says a word twice. Each take is listened to with Muse Voice Transcribe and recorded again with
      // another seed while it stumbles (best effort: a failed check keeps the take as it is).
      for (let take = 0; take < MAX_TAKES; take += 1) {
        try {
          wav = await deps.narration.speak(line, narrator, { seed: narrator.seed + take });
        } catch (err) {
          console.error('video narration failed', err instanceof Error ? err.message : err);
          throw new Stop('videoErrVoice');
        }
        if (take === MAX_TAKES - 1 || !(await stumbledOnTake(wav, line))) break;
      }
      const path = join(dir, `scene-${i}.wav`);
      await writeFile(path, wav);
      audio.push({ path, seconds: sceneSeconds(wavDurationMs(wav)) });
    }

    // 3. One clip per scene, then the clips joined.
    const clips: string[] = [];
    try {
      for (const [i, a] of audio.entries()) {
        await mark('assemble', i, audio.length);
        const out = join(dir, `clip-${i}.mp4`);
        await deps.ffmpeg(clipArgs({ image: images[i]!, audio: a.path, out, w: dims.w, h: dims.h, seconds: a.seconds, first: i === 0, last: i === audio.length - 1, zoomOut: i % 2 === 1 }));
        clips.push(out);
      }
      const list = join(dir, 'clips.txt');
      await writeFile(list, concatList(clips));
      await deps.ffmpeg(concatArgs({ list, out: join(dir, 'final.mp4'), title: script.title }));
    } catch (err) {
      console.error('video assembly failed', err instanceof Error ? err.message : err);
      throw new Stop(err instanceof Error && err.message === 'ffmpeg_missing' ? 'videoErrFfmpeg' : 'videoErrAssemble');
    }

    // 4. Store the video and finish. Nothing points at the file until the row is written.
    const bytes = new Uint8Array(await readFile(join(dir, 'final.mp4')));
    const key = `org/${orgId}/marketing/${newId()}.mp4`;
    await deps.storage.put(key, bytes, 'video/mp4');
    const fileId = newId();
    const durationMs = Math.round(audio.reduce((sum, a) => sum + a.seconds, 0) * 1000);
    try {
      await db.transaction(async (tx) => {
        await tx.insert(files).values({ id: fileId, orgId, kind: 'marketing_video', storageKey: key, mime: 'video/mp4', sizeBytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), isAiGenerated: true, createdBy: ctx.userId });
        await tx
          .update(videoProjects)
          .set({ status: 'done', stage: null, progress: 100, error: null, fileId, durationMs, speechEngine: deps.narration.engine, imagesUsed: script.scenes.length, updatedAt: new Date() })
          .where(and(eq(videoProjects.orgId, orgId), eq(videoProjects.id, projectId)));
        await recordAudit(tx, who(ctx), { action: 'video.rendered', entityType: 'video_project', entityId: projectId, summary: { scenes: script.scenes.length, durationMs, speechEngine: deps.narration.engine, narrator: narrator.key } });
      });
    } catch (err) {
      await deps.storage.delete(key).catch(() => undefined);
      throw err;
    }
    return { done: true, durationMs };
  } catch (err) {
    if (err instanceof Stop) return failWith(t(err.key));
    console.error('video render failed', err instanceof Error ? err.message : err);
    return failWith(t('videoErrAssemble'));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
