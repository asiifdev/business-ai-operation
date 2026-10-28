import { createHash } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { newId } from '../../db/ids';
import { documents, files, jobs, leads, meetings, meetingTurns, tasks, users } from '../../db/schema';
import { storage } from '../../integrations/storage';
import { enqueueJob } from '../jobs/queue';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { who } from '../portfolio/shared';
import { MAX_UPLOAD_BYTES, sniffAudio, type AudioFormat } from './rules';

type MeetingRecord = typeof meetings.$inferSelect;

const MIME: Record<AudioFormat, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm' };

export const meetingUploadSchema = z.object({
  title: z.string().trim().min(2).max(160),
  /** BR-M09-11: the uploader confirms the people in the recording agreed to it. */
  consent: z.literal(true),
});

/** Why a recording cannot be accepted, or null. The endpoint reports it as the field `file:<reason>`. */
export function audioProblem(bytes: Uint8Array): 'empty' | 'size' | 'format' | null {
  if (bytes.byteLength === 0) return 'empty';
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return 'size';
  return sniffAudio(bytes) ? null : 'format';
}

async function loadMeeting(orgId: string, id: string): Promise<MeetingRecord> {
  const [row] = await db.select().from(meetings).where(and(eq(meetings.orgId, orgId), eq(meetings.id, id)));
  if (!row) throw new DomainError('not_found', 'meeting');
  return row;
}

/** Managers see every meeting; staff only their own (BRD-M09 section 2). Someone else's meeting simply does not exist. */
function assertCanSee(ctx: Ctx, m: Pick<MeetingRecord, 'createdBy'>) {
  if (can(ctx.role, 'meeting.read_any')) return;
  if (can(ctx.role, 'meeting.read_own') && m.createdBy === ctx.userId) return;
  throw new DomainError('not_found', 'meeting');
}

/**
 * Stores a recording and queues its processing (BRD-M09 section 4). The format is recognised from the bytes; anything
 * else, an empty file, or one over the limit is refused with a clear reason (BR-M09-01, -02). The file row, the meeting
 * and the job are written in one transaction, after the object is stored, so the job never points at nothing.
 */
export async function createMeeting(ctx: Ctx, raw: z.input<typeof meetingUploadSchema>, file: { bytes: Uint8Array; name?: string }, opts: { source?: 'upload' | 'telegram' } = {}): Promise<{ id: string }> {
  assertCan(ctx, 'meeting.upload');
  const input = meetingUploadSchema.parse(raw);
  const problem = audioProblem(file.bytes);
  if (problem) throw new DomainError('validation', `file:${problem}`);
  const format = sniffAudio(file.bytes)!;

  const fileId = newId();
  const key = `org/${ctx.orgId}/meetings/${fileId}.${format}`;
  await storage().put(key, file.bytes, MIME[format]);
  try {
    return await db.transaction(async (tx) => {
      await tx.insert(files).values({
        id: fileId,
        orgId: ctx.orgId,
        kind: 'meeting_audio',
        storageKey: key,
        mime: MIME[format],
        sizeBytes: file.bytes.byteLength,
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
        originalName: file.name?.slice(0, 200) ?? null,
        createdBy: ctx.userId,
      });
      const [row] = await tx.insert(meetings).values({ orgId: ctx.orgId, title: input.title, source: opts.source ?? 'upload', fileId, createdBy: ctx.userId }).returning({ id: meetings.id });
      await enqueueJob(tx, { orgId: ctx.orgId, type: 'meeting.process', payload: { meetingId: row.id } });
      await recordAudit(tx, who(ctx), { action: 'meeting.uploaded', entityType: 'meeting', entityId: row.id, summary: { format, bytes: file.bytes.byteLength, source: opts.source ?? 'upload' } });
      return { id: row.id };
    });
  } catch (err) {
    await storage().delete(key).catch(() => undefined); // nothing points at it any more
    throw err;
  }
}

export interface MeetingRow {
  id: string;
  title: string;
  source: string;
  status: MeetingRecord['status'];
  durationMs: number | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
  contentDeleted: boolean;
  hasMinutes: boolean;
  error: string | null;
}

export async function listMeetings(ctx: Ctx): Promise<MeetingRow[]> {
  assertCan(ctx, 'meeting.read_own');
  const rows = await db
    .select({ m: meetings, createdByName: users.name })
    .from(meetings)
    .leftJoin(users, and(eq(users.orgId, meetings.orgId), eq(users.id, meetings.createdBy)))
    .where(and(eq(meetings.orgId, ctx.orgId), can(ctx.role, 'meeting.read_any') ? undefined : eq(meetings.createdBy, ctx.userId)))
    .orderBy(desc(meetings.createdAt))
    .limit(200);
  return rows.map(({ m, createdByName }) => ({
    id: m.id,
    title: m.title,
    source: m.source,
    status: m.status,
    durationMs: m.durationMs,
    createdBy: m.createdBy,
    createdByName,
    createdAt: m.createdAt,
    contentDeleted: m.contentDeletedAt !== null,
    hasMinutes: m.minutesDocumentId !== null,
    error: m.error,
  }));
}

export interface MeetingDetail extends MeetingRow {
  fileName: string | null;
  speakerMap: Record<string, string>;
  /** Labels that occur in the transcript, for the speaker-to-name form. */
  speakers: string[];
  turns: Array<{ seq: number; speaker: string | null; startMs: number; endMs: number; text: string }>;
  minutes: { documentId: string; narrative: string | null; isAiDraft: boolean } | null;
  tasks: Array<{ id: string; title: string; isDraft: boolean; status: string; sourceQuote: string | null }>;
  leads: Array<{ id: string; name: string; isDraft: boolean; stage: string }>;
  /** The processing job, for the progress line: attempts so far and the last error. */
  job: { status: string; attempts: number; maxAttempts: number } | null;
  canChange: boolean;
}

export async function getMeeting(ctx: Ctx, id: string): Promise<MeetingDetail> {
  assertCan(ctx, 'meeting.read_own');
  const m = await loadMeeting(ctx.orgId, id);
  assertCanSee(ctx, m);
  const [[file], turns, [minutes], taskRows, leadRows, [job], [creator]] = await Promise.all([
    m.fileId ? db.select({ name: files.originalName }).from(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, m.fileId))) : Promise.resolve([]),
    db.select({ seq: meetingTurns.seq, speaker: meetingTurns.speaker, startMs: meetingTurns.startMs, endMs: meetingTurns.endMs, text: meetingTurns.text }).from(meetingTurns).where(and(eq(meetingTurns.orgId, ctx.orgId), eq(meetingTurns.meetingId, id))).orderBy(asc(meetingTurns.seq)),
    m.minutesDocumentId
      ? db.select({ documentId: documents.id, narrative: documents.narrative, isAiDraft: documents.isAiDraft }).from(documents).where(and(eq(documents.orgId, ctx.orgId), eq(documents.id, m.minutesDocumentId)))
      : Promise.resolve([]),
    db.select({ id: tasks.id, title: tasks.title, isDraft: tasks.isDraft, status: tasks.status, sourceQuote: tasks.sourceQuote }).from(tasks).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.meetingId, id))),
    can(ctx.role, 'lead.read') ? db.select({ id: leads.id, name: leads.name, isDraft: leads.isDraft, stage: leads.stage }).from(leads).where(and(eq(leads.orgId, ctx.orgId), eq(leads.meetingId, id))) : Promise.resolve([]),
    db.select({ status: jobs.status, attempts: jobs.attempts, maxAttempts: jobs.maxAttempts }).from(jobs).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.type, 'meeting.process'), eq(jobs.payload, { meetingId: id }))).orderBy(desc(jobs.createdAt)).limit(1),
    db.select({ name: users.name }).from(users).where(and(eq(users.orgId, ctx.orgId), eq(users.id, m.createdBy))),
  ]);
  return {
    id: m.id,
    title: m.title,
    source: m.source,
    status: m.status,
    durationMs: m.durationMs,
    createdBy: m.createdBy,
    createdByName: creator?.name ?? null,
    createdAt: m.createdAt,
    contentDeleted: m.contentDeletedAt !== null,
    hasMinutes: m.minutesDocumentId !== null,
    error: m.error,
    fileName: file?.name ?? null,
    speakerMap: m.speakerMap ?? {},
    speakers: [...new Set(turns.map((t) => t.speaker).filter((s): s is string => Boolean(s)))].sort(),
    turns,
    minutes: minutes ?? null,
    tasks: taskRows,
    leads: leadRows,
    job: job ?? null,
    canChange: can(ctx.role, 'meeting.read_any') || m.createdBy === ctx.userId,
  };
}

function assertCanChange(ctx: Ctx, m: MeetingRecord) {
  assertCanSee(ctx, m);
  if (!can(ctx.role, 'meeting.read_any') && m.createdBy !== ctx.userId) throw new DomainError('forbidden', 'only the uploader or a manager may change this meeting');
}

export const speakerMapSchema = z.record(z.string().regex(/^[A-Z][0-9]{0,2}$/), z.string().trim().max(80)).refine((m) => Object.keys(m).length <= 26, 'too many speakers');

/** A person names the speakers; the system never guesses who is who (BR-M09-12). An empty name removes the mapping. */
export async function setSpeakerMap(ctx: Ctx, id: string, raw: z.input<typeof speakerMapSchema>): Promise<void> {
  const map = Object.fromEntries(Object.entries(speakerMapSchema.parse(raw)).filter(([, name]) => name !== ''));
  await db.transaction(async (tx) => {
    const m = await loadMeeting(ctx.orgId, id);
    assertCanChange(ctx, m);
    if (m.contentDeletedAt) throw new DomainError('invalid_state', 'the transcript was deleted');
    await tx.update(meetings).set({ speakerMap: map, updatedAt: ctx.clock.now() }).where(and(eq(meetings.orgId, ctx.orgId), eq(meetings.id, id)));
    await recordAudit(tx, who(ctx), { action: 'meeting.speakers_named', entityType: 'meeting', entityId: id, summary: { speakers: Object.keys(map).length } });
  });
}

/**
 * Deletes the recording and its transcript in one action (BR-M09-10, D-028): the turns go, the speaker names are
 * cleared, the file is marked deleted and its object removed. The meeting row stays as a record, and the minutes and the
 * drafts made from it stay. Refused while the recording is being processed, so the job cannot write a transcript back.
 */
export async function deleteMeetingContent(ctx: Ctx, id: string): Promise<void> {
  const keys = await db.transaction(async (tx) => {
    const m = await loadMeeting(ctx.orgId, id);
    assertCanChange(ctx, m);
    if (m.contentDeletedAt) return [];
    if (m.status === 'processing') throw new DomainError('invalid_state', 'the recording is being processed');
    const now = ctx.clock.now();
    await tx.delete(meetingTurns).where(and(eq(meetingTurns.orgId, ctx.orgId), eq(meetingTurns.meetingId, id)));
    await tx.update(meetings).set({ speakerMap: null, contentDeletedAt: now, updatedAt: now }).where(and(eq(meetings.orgId, ctx.orgId), eq(meetings.id, id)));
    // A queued retry must not bring the transcript back.
    await tx.update(jobs).set({ status: 'failed', lastError: 'content deleted', finishedAt: now }).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.type, 'meeting.process'), eq(jobs.status, 'queued'), eq(jobs.payload, { meetingId: id })));
    const fileRows = m.fileId ? await tx.update(files).set({ deletedAt: now }).where(and(eq(files.orgId, ctx.orgId), eq(files.id, m.fileId))).returning({ key: files.storageKey }) : [];
    await recordAudit(tx, who(ctx), { action: 'meeting.content_deleted', entityType: 'meeting', entityId: id, summary: {} });
    return fileRows.map((f) => f.key);
  });
  for (const key of keys) {
    await storage().delete(key).catch((err) => console.error('meeting audio could not be removed from storage', err instanceof Error ? err.message : err));
  }
}

/** Queues another run for a meeting that failed. The audio must still be there. */
export async function retryMeeting(ctx: Ctx, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const m = await loadMeeting(ctx.orgId, id);
    assertCanChange(ctx, m);
    if (m.status !== 'failed') throw new DomainError('invalid_state', 'only a failed meeting can be processed again');
    if (m.contentDeletedAt) throw new DomainError('invalid_state', 'the recording was deleted');
    await tx.update(meetings).set({ status: 'uploaded', error: null, updatedAt: ctx.clock.now() }).where(and(eq(meetings.orgId, ctx.orgId), eq(meetings.id, id)));
    await enqueueJob(tx, { orgId: ctx.orgId, type: 'meeting.process', payload: { meetingId: id } });
    await recordAudit(tx, who(ctx), { action: 'meeting.retried', entityType: 'meeting', entityId: id, summary: {} });
  });
}
