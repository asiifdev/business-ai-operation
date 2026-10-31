import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { files, products, videoProjects } from '../../db/schema';
import { storage } from '../../integrations/storage';
import { enqueueJob } from '../jobs/queue';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { who } from '../portfolio/shared';
import { imageQuotaStatus } from './service';
import { estimateMinutes, renderSchema, type RenderInput, type StoredScene } from './video-rules';

// D-086. The video projects: a saved script and, once someone asks, the video built from it by the `video.render` job.

export type VideoRow = typeof videoProjects.$inferSelect;
export type VideoScriptData = { title: string; hook: string; cta: string; seconds: number; scenes: StoredScene[] };

/** What the list needs. The script's text stays out of it; opening one project returns the whole script. */
export async function listVideos(ctx: Ctx) {
  assertCan(ctx, 'marketing.use');
  return db
    .select({
      id: videoProjects.id,
      title: videoProjects.title,
      productId: videoProjects.productId,
      productName: products.name,
      purpose: videoProjects.purpose,
      seconds: videoProjects.seconds,
      aspect: videoProjects.aspect,
      narrator: videoProjects.narrator,
      status: videoProjects.status,
      stage: videoProjects.stage,
      progress: videoProjects.progress,
      error: videoProjects.error,
      hasFile: videoProjects.fileId,
      durationMs: videoProjects.durationMs,
      createdBy: videoProjects.createdBy,
      createdAt: videoProjects.createdAt,
    })
    .from(videoProjects)
    .leftJoin(products, and(eq(products.orgId, videoProjects.orgId), eq(products.id, videoProjects.productId)))
    .where(eq(videoProjects.orgId, ctx.orgId))
    .orderBy(desc(videoProjects.createdAt))
    .limit(50)
    .then((rows) => rows.map((r) => ({ ...r, hasFile: r.hasFile !== null })));
}

export async function loadVideo(ctx: Ctx, id: string): Promise<VideoRow> {
  const [row] = await db.select().from(videoProjects).where(and(eq(videoProjects.orgId, ctx.orgId), eq(videoProjects.id, id)));
  if (!row) throw new DomainError('not_found', 'video');
  return row;
}

export async function getVideo(ctx: Ctx, id: string) {
  assertCan(ctx, 'marketing.use');
  const row = await loadVideo(ctx, id);
  return { ...row, script: row.script as unknown as VideoScriptData, hasFile: row.fileId !== null, estimateMinutes: estimateMinutes((row.script as unknown as VideoScriptData).scenes.length, row.seconds) };
}

/** The scenes with the person's edits laid over them. Only the narration and the on-screen text can change. */
export function applyEdits(script: VideoScriptData, edits: NonNullable<RenderInput['scenes']> | undefined): VideoScriptData {
  if (!edits) return script;
  if (edits.length !== script.scenes.length) throw new DomainError('validation', 'scenes');
  return { ...script, scenes: script.scenes.map((s, i) => ({ ...s, voiceover: edits[i]!.voiceover.trim() || s.voiceover, onScreenText: edits[i]!.onScreenText.trim() })) };
}

/**
 * Asks for the video (D-086). The daily image quota is checked first, since every scene is one picture (BR-M10-06); the
 * AI budget is checked again inside each model call. A project that is waiting or rendering cannot be asked again; a
 * finished one is made again as a new project from its script, so no video is ever overwritten.
 */
export async function requestRender(ctx: Ctx, id: string, raw: RenderInput) {
  assertCan(ctx, 'marketing.use');
  const input = renderSchema.parse(raw);
  const row = await loadVideo(ctx, id);
  if (!can(ctx.role, 'marketing.delete_any') && row.createdBy !== ctx.userId) throw new DomainError('forbidden', 'only your own videos');
  if (row.status === 'queued' || row.status === 'rendering') throw new DomainError('invalid_state', 'video is already being made');
  if (row.status === 'done') throw new DomainError('invalid_state', 'video is already made');
  const script = applyEdits(row.script as unknown as VideoScriptData, input.scenes);
  const quota = await imageQuotaStatus(ctx);
  if (script.scenes.length > quota.remaining) return { ok: false as const, kind: 'quota', message: 'quota', needed: script.scenes.length, remaining: quota.remaining };
  await db.transaction(async (tx) => {
    await tx
      .update(videoProjects)
      .set({ status: 'queued', stage: null, progress: 0, error: null, narrator: input.narrator, aspect: input.aspect, script: script as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(and(eq(videoProjects.orgId, ctx.orgId), eq(videoProjects.id, id)));
    await enqueueJob(tx, { orgId: ctx.orgId, type: 'video.render', payload: { projectId: id } });
    await recordAudit(tx, who(ctx), { action: 'video.render_requested', entityType: 'video_project', entityId: id, summary: { scenes: script.scenes.length, narrator: input.narrator, aspect: input.aspect } });
  });
  return { ok: true as const, estimateMinutes: estimateMinutes(script.scenes.length, row.seconds) };
}

export async function readVideoFile(ctx: Ctx, id: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  assertCan(ctx, 'marketing.use');
  const row = await loadVideo(ctx, id);
  if (!row.fileId) throw new DomainError('not_found', 'file');
  const [file] = await db.select().from(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, row.fileId), isNull(files.deletedAt)));
  if (!file) throw new DomainError('not_found', 'file');
  return { bytes: await storage().get(file.storageKey), mime: file.mime, name: `video-${row.id}.mp4` };
}

/** Owner and Admin delete any video; Staff only their own. A video still being made cannot be deleted (it would be rebuilt into nothing). */
export async function deleteVideo(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, 'marketing.use');
  const row = await loadVideo(ctx, id);
  if (!can(ctx.role, 'marketing.delete_any') && row.createdBy !== ctx.userId) throw new DomainError('forbidden', 'only your own videos');
  if (row.status === 'rendering') throw new DomainError('invalid_state', 'video is being made');
  const keys = await db.transaction(async (tx) => {
    await tx.delete(videoProjects).where(and(eq(videoProjects.orgId, ctx.orgId), eq(videoProjects.id, id)));
    const removed = row.fileId ? await tx.delete(files).where(and(eq(files.orgId, ctx.orgId), inArray(files.id, [row.fileId]))).returning({ key: files.storageKey }) : [];
    await recordAudit(tx, who(ctx), { action: 'video.deleted', entityType: 'video_project', entityId: id, summary: { status: row.status } });
    return removed.map((f) => f.key);
  });
  await Promise.all(keys.map((key) => storage().delete(key).catch((err) => console.error('video could not be removed from storage', err instanceof Error ? err.message : err))));
}
