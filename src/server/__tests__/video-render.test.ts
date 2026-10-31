import { statSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider, sayJson } from '../../ai/fake-provider';
import type { ImageResult, TranscribeResult } from '../../ai/types';
import { NARRATORS } from '../../config/narrators';
import { aiRuns, auditLog, files, videoProjects } from '../../db/schema';
import { db, pg } from '../../db/client';
import { makeOrg } from '../../domain/ai/__tests__/support';
import { silentWav } from '../../domain/marketing/__tests__/video-support';
import { draftVideoScript } from '../../domain/marketing/service';
import { deleteVideo, getVideo, listVideos, readVideoFile, requestRender } from '../../domain/marketing/video';
import { DomainError } from '../../domain/errors';
import { NarrationError, type Narration } from '../../integrations/speech/voicestudio';
import { setStorage, type Storage } from '../../integrations/storage';
import { systemClock } from '../../lib/clock';
import { renderVideo, runFfmpeg, type VideoDeps } from '../video-render';

afterAll(async () => {
  setStorage(undefined);
  await pg.end();
});

function memoryStorage(): Storage & { keys: () => string[] } {
  const objects = new Map<string, Uint8Array>();
  return {
    put: async (key, bytes) => void objects.set(key, bytes),
    get: async (key) => {
      const v = objects.get(key);
      if (!v) throw new Error('missing object');
      return v;
    },
    delete: async (key) => void objects.delete(key),
    keys: () => [...objects.keys()],
  };
}
let store: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  store = memoryStorage();
  setStorage(store);
});

const WORD = ['', 'satu', 'dua'];
const scene = (n: number) => ({ visual: `Tim berdiskusi di kantor, adegan ${WORD[n]}`, voiceover: `Kalimat narasi ${WORD[n]} tentang perusahaan`, onScreenText: n === 1 ? 'Teknologi untuk bisnis' : '' });
const SCRIPT = { title: 'Mengenal perusahaan', hook: 'Teknologi cerdas untuk bisnis nyata', cta: 'Hubungi kami', scenes: [scene(1), scene(2)] };

async function pictures(n: number): Promise<ImageResult> {
  const bytes = new Uint8Array(await sharp({ create: { width: 360, height: 640, channels: 3, background: '#335577' } }).webp().toBuffer());
  return { images: Array.from({ length: n }, () => ({ bytes, mime: 'image/webp' as const })), meta: { model: 'muse-image-1.0', rateLimit: {}, attempts: 1 } };
}

class FakeNarration implements Narration {
  readonly engine = 'voxcpm2';
  readonly spoken: string[] = [];
  readonly seeds: Array<number | undefined> = [];
  constructor(private readonly problem?: NarrationError) {}
  async check() {
    if (this.problem) throw this.problem;
  }
  async speak(text: string, _narrator: unknown, opts?: { seed?: number }) {
    this.spoken.push(text);
    this.seeds.push(opts?.seed);
    return silentWav(1.2);
  }
}

async function projectFor(o: Awaited<ReturnType<typeof makeOrg>>) {
  const r = await draftVideoScript(o.ownerCtx, { purpose: 'brand', seconds: 15 }, new FakeProvider({ chat: [sayJson(SCRIPT)] }));
  if (!r.ok) throw new Error('script was not made');
  return r.projectId;
}
const deps = (narration: Narration, provider: FakeProvider): VideoDeps => ({ provider, narration, storage: store, ffmpeg: (args) => runFfmpeg(args), clock: systemClock });
const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

describe('video.render (D-086)', () => {
  it('saves the script as a project, then builds a real MP4 from pictures and narration, with pictures counted and the engine recorded', async () => {
    const o = await makeOrg();
    const id = await projectFor(o);
    expect((await listVideos(o.ownerCtx)).find((v) => v.id === id)).toMatchObject({ status: 'script', hasFile: false });

    const queued = await requestRender(o.ownerCtx, id, { narrator: 'sinta', aspect: 'story', scenes: [{ voiceover: 'Kalimat satu disunting', onScreenText: 'Teks baru' }, { voiceover: '', onScreenText: '' }] });
    expect(queued.ok).toBe(true);
    expect((await getVideo(o.ownerCtx, id)).status).toBe('queued');
    await rejects(requestRender(o.ownerCtx, id, { narrator: 'sinta', aspect: 'story' }), 'invalid_state');

    const narration = new FakeNarration();
    const provider = new FakeProvider({ image: [await pictures(1), await pictures(1)] });
    const result = await renderVideo({ projectId: id }, deps(narration, provider));
    expect(result).toMatchObject({ done: true });

    const video = await getVideo(o.ownerCtx, id);
    expect(video).toMatchObject({ status: 'done', progress: 100, hasFile: true, speechEngine: 'voxcpm2', imagesUsed: 2 });
    expect(video.durationMs).toBeGreaterThan(4000);
    // The person's edit is what was spoken; an empty edit keeps the written line.
    expect(narration.spoken).toEqual(['Kalimat satu disunting', 'Kalimat narasi dua tentang perusahaan']);
    expect(provider.imageCalls).toHaveLength(2);
    expect(provider.imageCalls[0]!.prompt).toMatch(/Tanpa teks/);

    const file = await readVideoFile(o.ownerCtx, id);
    expect(file.mime).toBe('video/mp4');
    expect(String.fromCharCode(...file.bytes.slice(4, 8))).toBe('ftyp');
    const [row] = await db.select().from(files).where(and(eq(files.orgId, o.orgId), eq(files.id, video.fileId!)));
    expect(row).toMatchObject({ kind: 'marketing_video', isAiGenerated: true, mime: 'video/mp4' });
    const runs = await db.select().from(aiRuns).where(and(eq(aiRuns.orgId, o.orgId), eq(aiRuns.feature, 'image')));
    expect(runs.reduce((n, r) => n + (r.images ?? 0), 0)).toBe(2);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.orgId, o.orgId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['video.script_saved', 'video.render_requested', 'video.rendered']));
  }, 120_000);

  it('stops before spending anything when the voice engine is down or is not VoxCPM2, and says so in plain words', async () => {
    const o = await makeOrg();
    for (const [kind, words] of [['unreachable', /tidak bisa dihubungi/], ['wrong_engine', /model suara yang disetujui/]] as const) {
      const id = await projectFor(o);
      await requestRender(o.ownerCtx, id, { narrator: 'sinta', aspect: 'story' });
      const provider = new FakeProvider({ image: [await pictures(1), await pictures(1)] });
      expect(await renderVideo({ projectId: id }, deps(new FakeNarration(new NarrationError(kind, kind)), provider))).toEqual({ failed: true });
      const video = await getVideo(o.ownerCtx, id);
      expect(video.status).toBe('failed');
      expect(video.error).toMatch(words);
      expect(provider.imageCalls).toHaveLength(0);
      expect(video.hasFile).toBe(false);
    }
  }, 60_000);

  it('refuses a video that needs more pictures than the day has left, and a person cannot touch another person\'s video', async () => {
    const o = await makeOrg();
    const id = await projectFor(o);
    const old = process.env.MARKETING_DAILY_IMAGE_QUOTA;
    process.env.MARKETING_DAILY_IMAGE_QUOTA = '1';
    try {
      expect(await requestRender(o.ownerCtx, id, { narrator: 'sinta', aspect: 'story' })).toMatchObject({ ok: false, kind: 'quota', needed: 2, remaining: 1 });
    } finally {
      if (old === undefined) delete process.env.MARKETING_DAILY_IMAGE_QUOTA;
      else process.env.MARKETING_DAILY_IMAGE_QUOTA = old;
    }
    expect((await getVideo(o.ownerCtx, id)).status).toBe('script');
    await rejects(requestRender(o.staffCtx, id, { narrator: 'sinta', aspect: 'story' }), 'forbidden');
    await rejects(deleteVideo(o.staffCtx, id), 'forbidden');
    await rejects(requestRender(o.ownerCtx, id, { narrator: 'sinta', aspect: 'story', scenes: [{ voiceover: 'x', onScreenText: '' }] }), 'validation');
  });

  it('keeps videos inside their organization, and deleting removes the project and its file', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const id = await projectFor(a);
    await requestRender(a.ownerCtx, id, { narrator: 'sinta', aspect: 'square' });
    await renderVideo({ projectId: id }, deps(new FakeNarration(), new FakeProvider({ image: [await pictures(1), await pictures(1)] })));
    await rejects(getVideo(b.ownerCtx, id), 'not_found');
    expect((await listVideos(b.ownerCtx)).some((v) => v.id === id)).toBe(false);
    expect(store.keys().some((k) => k.endsWith('.mp4'))).toBe(true);
    await deleteVideo(a.ownerCtx, id);
    expect(store.keys().some((k) => k.endsWith('.mp4'))).toBe(false);
    expect(await db.select().from(videoProjects).where(eq(videoProjects.id, id))).toHaveLength(0);
  }, 120_000);

  it('records a scene again with another seed when the voice said a word twice, and keeps going when the check cannot run', async () => {
    const heard = (text: string): TranscribeResult => ({ transcript: text, durationMs: 1200, turns: [{ turnId: 0, startMs: 0, endMs: 1200, transcript: text }], meta: { model: 'muse-voice-transcribe', rateLimit: {}, attempts: 1 } });
    const o = await makeOrg();
    const id = await projectFor(o);
    await requestRender(o.ownerCtx, id, { narrator: 'sinta', aspect: 'story' });
    const narration = new FakeNarration();
    // Scene one stumbles once and is clean the second time; scene two is clean at once.
    const provider = new FakeProvider({ image: [await pictures(1), await pictures(1)], transcribe: [heard('Kalimat narasi narasi satu tentang perusahaan'), heard('Kalimat narasi satu tentang perusahaan'), heard('Kalimat narasi dua tentang perusahaan')] });
    expect(await renderVideo({ projectId: id }, deps(narration, provider))).toMatchObject({ done: true });
    expect(narration.spoken).toHaveLength(3);
    expect(narration.seeds).toEqual([7, 8, 7]);

    // The check cannot run at all (nothing scripted): each scene is recorded once and the video is still made.
    const id2 = await projectFor(o);
    await requestRender(o.ownerCtx, id2, { narrator: 'sinta', aspect: 'story' });
    const quiet = new FakeNarration();
    expect(await renderVideo({ projectId: id2 }, deps(quiet, new FakeProvider({ image: [await pictures(1), await pictures(1)] })))).toMatchObject({ done: true });
    expect(quiet.spoken).toHaveLength(2);
  }, 120_000);

  it('knows the narrator the owner picked', () => {
    expect(NARRATORS.sinta).toMatchObject({ seed: 7, language: 'id', profile: 'Sinta (Orbyte)' });
    // The reference recording that fixes the voice is shipped with the application.
    expect(statSync(join(process.cwd(), 'src', 'config', 'voices', NARRATORS.sinta.reference.file)).size).toBeGreaterThan(100_000);
  });
});
