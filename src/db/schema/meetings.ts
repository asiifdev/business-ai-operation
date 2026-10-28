import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, tstz, updatedAtColumn } from './_shared';
import { organizations } from './auth';

export const fileKind = pgEnum('file_kind', ['meeting_audio', 'marketing_image']);
export const meetingStatus = pgEnum('meeting_status', ['uploaded', 'processing', 'done', 'failed']);

/**
 * ERD 3.6, D-023. A pointer to a stored object (R2 or local disk) and the basis of every access check: a download always
 * goes through the row's `org_id`. `deleted_at` marks an object removed with its meeting content (BR-M09-10).
 */
export const files = pgTable(
  'files',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    kind: fileKind('kind').notNull(),
    /** `org/<org_id>/…`, unique across all organizations. */
    storageKey: text('storage_key').notNull().unique('uq_files_storage_key'),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256'),
    originalName: text('original_name'),
    isAiGenerated: boolean('is_ai_generated').notNull().default(false),
    createdBy: text('created_by').notNull(),
    createdAt: createdAtColumn(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [unique('uq_files_org_id').on(t.orgId, t.id), check('files_size_ck', sql`${t.sizeBytes} >= 0`)],
);

/**
 * ERD 3.6, BRD-M09. One recording and what came out of it. Deleting the recording deletes its transcript in the same
 * action (`content_deleted_at`, D-028); the row stays as a record, and the minutes and drafts made from it stay too.
 * `minutes_document_id` points at `documents`; that foreign key is added with the documents tables (ERD section 9, the
 * meetings/documents cycle).
 */
export const meetings = pgTable(
  'meetings',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    /** `upload` (web) or `telegram` (voice note). */
    source: text('source').notNull().default('upload'),
    fileId: text('file_id'),
    status: meetingStatus('status').notNull().default('uploaded'),
    durationMs: integer('duration_ms'),
    /** Speaker label to a person's name, for example `{"A":"Budi"}`. Set by a person, never guessed (BR-M09-12). */
    speakerMap: jsonb('speaker_map').$type<Record<string, string>>(),
    minutesDocumentId: text('minutes_document_id'),
    error: text('error'),
    contentDeletedAt: tstz('content_deleted_at'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_meetings_org_id').on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.fileId], foreignColumns: [files.orgId, files.id], name: 'fk_meetings_file' }),
    index('idx_meetings_org_created').on(t.orgId, t.createdAt),
  ],
);

/** ERD 3.6. One speaker turn, in order. `start_ms`/`end_ms` already include the offset of the piece they came from. */
export const meetingTurns = pgTable(
  'meeting_turns',
  {
    id: idColumn(),
    orgId: text('org_id').notNull(),
    meetingId: text('meeting_id').notNull(),
    seq: integer('seq').notNull(),
    speaker: text('speaker'),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
  },
  (t) => [
    unique('uq_meeting_turns_seq').on(t.meetingId, t.seq),
    foreignKey({ columns: [t.orgId, t.meetingId], foreignColumns: [meetings.orgId, meetings.id], name: 'fk_meeting_turns_meeting' }),
  ],
);
