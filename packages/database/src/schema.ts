import { bigint, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const transcriptionJobStatus = pgEnum('transcription_job_status', ['queued', 'processing', 'completed', 'failed']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('users_email_unique').on(table.email)]);

export const guestSessions = pgTable('guest_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('guest_sessions_token_hash_unique').on(table.tokenHash), index('guest_sessions_expires_at_idx').on(table.expiresAt)]);

export const recordings = pgTable('recordings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  guestSessionId: uuid('guest_session_id').references(() => guestSessions.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  originalFilename: text('original_filename'),
  mediaType: text('media_type'),
  durationMs: bigint('duration_ms', { mode: 'number' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('recordings_user_id_idx').on(table.userId), index('recordings_guest_session_id_idx').on(table.guestSessionId)]);

export const transcriptionJobs = pgTable('transcription_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  recordingId: uuid('recording_id').notNull().references(() => recordings.id, { onDelete: 'cascade' }),
  status: transcriptionJobStatus('status').notNull().default('queued'),
  attempts: bigint('attempts', { mode: 'number' }).notNull().default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('transcription_jobs_recording_id_idx').on(table.recordingId), index('transcription_jobs_status_idx').on(table.status)]);

export const transcripts = pgTable('transcripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  recordingId: uuid('recording_id').notNull().references(() => recordings.id, { onDelete: 'cascade' }),
  language: text('language'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('transcripts_recording_id_unique').on(table.recordingId)]);

export const speakers = pgTable('speakers', {
  id: uuid('id').primaryKey().defaultRandom(),
  transcriptId: uuid('transcript_id').notNull().references(() => transcripts.id, { onDelete: 'cascade' }),
  engineSpeakerId: text('engine_speaker_id').notNull(),
  label: text('label').notNull(),
}, (table) => [uniqueIndex('speakers_transcript_engine_id_unique').on(table.transcriptId, table.engineSpeakerId)]);

export const transcriptSegments = pgTable('transcript_segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  transcriptId: uuid('transcript_id').notNull().references(() => transcripts.id, { onDelete: 'cascade' }),
  speakerId: uuid('speaker_id').references(() => speakers.id, { onDelete: 'set null' }),
  startMs: bigint('start_ms', { mode: 'number' }).notNull(),
  endMs: bigint('end_ms', { mode: 'number' }).notNull(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('transcript_segments_transcript_id_idx').on(table.transcriptId), index('transcript_segments_speaker_id_idx').on(table.speakerId)]);
