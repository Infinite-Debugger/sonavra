import { createHash } from 'node:crypto';
import { createDatabase, type PrismaClient } from '@sonavra/database';
import type { TranscriptSummaryResponse } from '@sonavra/types';
import { recordingAccess } from './recording-access.js';
import {
  OllamaSummaryGenerator,
  SummaryError,
  type SummaryGenerator,
} from './summary-generator.js';

type AccessWhere = Awaited<ReturnType<typeof recordingAccess>>['where'];
export type SummaryAccess = () => Promise<AccessWhere>;
const include = {
  transcript: {
    include: {
      summary: true,
      speakers: true,
      segments: { orderBy: { sequence: 'asc' as const } },
    },
  },
};

function snapshot(transcript: {
  segments: { text: string; speakerId: string | null }[];
  speakers: { id: string; displayName: string | null; label: string }[];
}) {
  const names = new Map(
    transcript.speakers.map((speaker) => [
      speaker.id,
      speaker.displayName ?? speaker.label,
    ]),
  );
  const source = transcript.segments
    .map(
      (segment) =>
        `${segment.speakerId ? (names.get(segment.speakerId) ?? 'Speaker') : 'Speaker'}: ${segment.text}`,
    )
    .join('\n');
  return { source, hash: createHash('sha256').update(source).digest('hex') };
}

export class TranscriptSummaryService {
  constructor(
    readonly database: PrismaClient = createDatabase(),
    private readonly generator: SummaryGenerator = new OllamaSummaryGenerator(),
  ) {}

  private async recording(
    database: Pick<PrismaClient, 'recording'>,
    id: string,
    access: SummaryAccess,
  ) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      )
    )
      throw new SummaryError('Recording not found.', 404);
    const recording = await database.recording.findFirst({
      where: { id, ...(await access()) },
      include,
    });
    if (!recording) throw new SummaryError('Recording not found.', 404);
    if (recording.status !== 'COMPLETED' || !recording.transcript)
      throw new SummaryError('A completed transcript is required.', 409);
    return recording.transcript;
  }

  async get(
    id: string,
    access: SummaryAccess,
  ): Promise<TranscriptSummaryResponse> {
    const transcript = await this.recording(this.database, id, access);
    const summary = transcript.summary;
    return {
      available: this.generator.available,
      summary: summary
        ? {
            text: summary.text,
            keyPoints: summary.keyPoints,
            actionItems: summary.actionItems,
            generatedAt: summary.generatedAt.toISOString(),
            stale: summary.sourceHash !== snapshot(transcript).hash,
          }
        : null,
    };
  }

  async generate(
    id: string,
    access: SummaryAccess,
  ): Promise<TranscriptSummaryResponse> {
    const transcript = await this.recording(this.database, id, access);
    if (!transcript.segments.some((segment) => segment.text.trim()))
      throw new SummaryError('This transcript has no text to summarize.', 422);
    const source = snapshot(transcript);
    const result = await this.generator.generate(source.source);
    await this.database.$transaction(async (tx) => {
      // Serialize persistence with ownership transfers and deletion markers.
      await tx.$queryRaw`SELECT "id" FROM "Recording" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const current = await this.recording(tx, id, access);
      if (snapshot(current).hash !== source.hash)
        throw new SummaryError(
          'The transcript changed during generation. Please generate a new summary.',
          409,
        );
      const data = {
        ...result,
        sourceHash: source.hash,
        generatedAt: new Date(),
      };
      await tx.transcriptSummary.upsert({
        where: { transcriptId: current.id },
        create: { transcriptId: current.id, ...data },
        update: data,
      });
    });
    // Recheck ownership and retention before returning sensitive generated text.
    return this.get(id, access);
  }
}
