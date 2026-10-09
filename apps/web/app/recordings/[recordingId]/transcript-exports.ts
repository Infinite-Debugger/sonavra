import type { TranscriptResponse } from '@sonavra/types';

type Transcript = Pick<TranscriptResponse, 'speakers' | 'segments'>;

export function speakerName(transcript: Transcript, speakerId: string | null) {
  const speaker = transcript.speakers.find((item) => item.id === speakerId);
  return speaker?.displayName || speaker?.label || 'Speaker';
}

export function transcriptLines(transcript: Transcript) {
  return transcript.segments.map((segment) => ({
    ...segment,
    speaker: speakerName(transcript, segment.speakerId),
  }));
}

function timestamp(ms: number, separator: ',' | '.') {
  const value = Math.max(0, Math.floor(ms));
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor((value % 3600000) / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  const millis = value % 1000;
  return (
    [hours, minutes, seconds]
      .map((part) => String(part).padStart(2, '0'))
      .join(':') +
    separator +
    String(millis).padStart(3, '0')
  );
}

export function transcriptText(transcript: Transcript) {
  return transcriptLines(transcript)
    .map((segment) => `${segment.speaker}: ${segment.text.trim()}`)
    .join('\n\n');
}

export function transcriptSrt(transcript: Transcript) {
  return (
    transcriptLines(transcript)
      .map(
        (segment, index) =>
          `${index + 1}\n${timestamp(segment.startMs, ',')} --> ${timestamp(segment.endMs, ',')}\n${segment.speaker}: ${segment.text.trim()}`,
      )
      .join('\n\n') + '\n'
  );
}

export function transcriptVtt(transcript: Transcript) {
  return (
    'WEBVTT\n\n' +
    transcriptLines(transcript)
      .map(
        (segment) =>
          `${timestamp(segment.startMs, '.')} --> ${timestamp(segment.endMs, '.')}\n${segment.speaker}: ${segment.text.trim()}`,
      )
      .join('\n\n') +
    '\n'
  );
}
