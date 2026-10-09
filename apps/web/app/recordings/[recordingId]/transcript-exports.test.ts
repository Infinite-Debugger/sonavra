import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TranscriptResponse } from '@sonavra/types';
import { createTranscriptDocx } from './transcript-docx';
import {
  transcriptSrt,
  transcriptText,
  transcriptVtt,
} from './transcript-exports';

type Transcript = Pick<TranscriptResponse, 'speakers' | 'segments'>;

const transcript: Transcript = {
  speakers: [
    { id: 'speaker-a', label: 'Speaker 1', displayName: 'Ada' },
    { id: 'speaker-b', label: 'Speaker 2', displayName: null },
  ],
  segments: [
    {
      id: 'segment-1',
      sequence: 0,
      startMs: 0,
      endMs: 1250,
      speakerId: 'speaker-a',
      text: '  Hello <world> & welcome.  ',
    },
    {
      id: 'segment-2',
      sequence: 1,
      startMs: 1250,
      endMs: 3723456,
      speakerId: 'speaker-a',
      text: 'Second line from Ada.',
    },
    {
      id: 'segment-3',
      sequence: 2,
      startMs: 3723456,
      endMs: 3726789,
      speakerId: 'speaker-b',
      text: 'Reply with default speaker label.',
    },
    {
      id: 'segment-4',
      sequence: 3,
      startMs: -25,
      endMs: 500,
      speakerId: null,
      text: 'Unknown speaker.',
    },
  ],
};

function unzipStoredFiles(bytes: Uint8Array) {
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let cursor = 0;

  while (cursor < bytes.length) {
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset + cursor,
      bytes.byteLength - cursor,
    );
    const signature = view.getUint32(0, true);
    if (signature !== 0x04034b50) break;

    const compressedSize = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = cursor + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    const content = decoder.decode(
      bytes.slice(dataStart, dataStart + compressedSize),
    );

    files.set(name, content);
    cursor = dataStart + compressedSize;
  }

  return files;
}

describe('transcript exports', () => {
  it('creates clean speaker-grouped TXT output', () => {
    assert.equal(
      transcriptText(transcript),
      [
        'Ada:',
        'Hello <world> & welcome.',
        'Second line from Ada.',
        '',
        'Speaker 2:',
        'Reply with default speaker label.',
        '',
        'Speaker:',
        'Unknown speaker.',
      ].join('\n'),
    );
  });

  it('creates SRT output with numbered cues and comma timestamps', () => {
    assert.equal(
      transcriptSrt(transcript),
      [
        '1',
        '00:00:00,000 --> 00:00:01,250',
        'Ada: Hello <world> & welcome.',
        '',
        '2',
        '00:00:01,250 --> 01:02:03,456',
        'Ada: Second line from Ada.',
        '',
        '3',
        '01:02:03,456 --> 01:02:06,789',
        'Speaker 2: Reply with default speaker label.',
        '',
        '4',
        '00:00:00,000 --> 00:00:00,500',
        'Speaker: Unknown speaker.',
        '',
      ].join('\n'),
    );
  });

  it('creates VTT output with dot timestamps and header', () => {
    assert.equal(
      transcriptVtt(transcript),
      [
        'WEBVTT',
        '',
        '00:00:00.000 --> 00:00:01.250',
        'Ada: Hello <world> & welcome.',
        '',
        '00:00:01.250 --> 01:02:03.456',
        'Ada: Second line from Ada.',
        '',
        '01:02:03.456 --> 01:02:06.789',
        'Speaker 2: Reply with default speaker label.',
        '',
        '00:00:00.000 --> 00:00:00.500',
        'Speaker: Unknown speaker.',
        '',
      ].join('\n'),
    );
  });

  it('creates a DOCX package with escaped speaker-structured document XML', () => {
    const files = unzipStoredFiles(createTranscriptDocx(transcript));

    assert.match(
      files.get('[Content_Types].xml') ?? '',
      /officedocument\.wordprocessingml\.document\.main\+xml/,
    );
    assert.match(files.get('_rels/.rels') ?? '', /word\/document\.xml/);

    const document = files.get('word/document.xml') ?? '';
    assert.match(document, /<w:b\/>/);
    assert.match(document, /<w:t xml:space="preserve">Ada<\/w:t>/);
    assert.match(document, /Hello &lt;world&gt; &amp; welcome\./);
    assert.match(document, /Second line from Ada\./);
    assert.match(document, /<w:br\/>/);
    assert.match(document, /<w:t xml:space="preserve">Speaker 2<\/w:t>/);
    assert.doesNotMatch(document, /Hello <world> & welcome/);
  });
});
