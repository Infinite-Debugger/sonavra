import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const recordingStatus = pgEnum('recording_status', [
  'uploaded',
  'queued',
  'processing',
  'completed',
  'failed',
]);

export const transcriptionJobStatus = pgEnum('transcription_job_status', [
  'queued',
  'processing',
  'completed',
  'failed',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

export const guestSessions = pgTable(
  'guest_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('guest_sessions_expires_at_idx').on(table.expiresAt)],
);

export const recordings = pgTable(
  'recordings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    guestSessionId: uuid('guest_session_id').references(() => guestSessions.id, {
      onDelete: 'cascade',
    }),
    originalFilename: text('original_filename').notNull(),
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    durationMs: integer('duration_ms'),
    status: recordingStatus('status').default('uploaded').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('recordings_user_id_idx').on(table.userId),
    index('recordings_guest_session_id_idx').on(table.guestSessionId),
    index('recordings_expires_at_idx').on(table.expiresAt),
  ],
);

export const transcriptionJobs = pgTable(
  'transcription_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    status: transcriptionJobStatus('status').default('queued').notNull(),
    provider: text('provider'),
    providerJobId: text('provider_job_id'),
    errorCode: text('error_code'),
    attemptCount: integer('attempt_count').default(0).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('transcription_jobs_recording_id_idx').on(table.recordingId)],
);

export const transcripts = pgTable('transcripts', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordingId: uuid('recording_id')
    .notNull()
    .references(() => recordings.id, { onDelete: 'cascade' })
    .unique(),
  language: text('language'),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const speakers = pgTable(
  'speakers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    transcriptId: uuid('transcript_id')
      .notNull()
      .references(() => transcripts.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('speakers_transcript_id_idx').on(table.transcriptId)],
);

export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    transcriptId: uuid('transcript_id')
      .notNull()
      .references(() => transcripts.id, { onDelete: 'cascade' }),
    speakerId: uuid('speaker_id').references(() => speakers.id, { onDelete: 'set null' }),
    sequence: integer('sequence').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('transcript_segments_transcript_sequence_idx').on(
      table.transcriptId,
      table.sequence,
    ),
    index('transcript_segments_speaker_id_idx').on(table.speakerId),
  ],
);
