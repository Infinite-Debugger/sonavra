import type { TranscriptResponse } from '@sonavra/types';
import { transcriptTurns } from './transcript-exports';

type Transcript = Pick<TranscriptResponse, 'speakers' | 'segments'>;

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraph(value: string, bold = false) {
  const style = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  const lines = value.split('\n');
  const text = lines
    .map((line, index) => {
      const breakTag = index === 0 ? '' : '<w:br/>';
      return `${breakTag}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`;
    })
    .join('');
  return `<w:p><w:r>${style}${text}</w:r></w:p>`;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Array<[string, string]>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const filename = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + filename.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, filename.length, true);
    local.set(filename, 30);
    chunks.push(local, data);

    const central = new Uint8Array(46 + filename.length);
    const index = new DataView(central.buffer);
    index.setUint32(0, 0x02014b50, true);
    index.setUint16(4, 20, true);
    index.setUint16(6, 20, true);
    index.setUint32(16, checksum, true);
    index.setUint32(20, data.length, true);
    index.setUint32(24, data.length, true);
    index.setUint16(28, filename.length, true);
    index.setUint32(42, offset, true);
    central.set(filename, 46);
    directory.push(central);
    offset += local.length + data.length;
  }

  const directoryLength = directory.reduce(
    (sum, entry) => sum + entry.length,
    0,
  );
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, files.length, true);
  footer.setUint16(10, files.length, true);
  footer.setUint32(12, directoryLength, true);
  footer.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directoryLength + end.length);
  let cursor = 0;
  for (const chunk of [...chunks, ...directory, end]) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

export function createTranscriptDocx(transcript: Transcript) {
  const body = transcriptTurns(transcript)
    .map(
      (turn) => paragraph(turn.speaker, true) + paragraph(turn.text.join('\n')),
    )
    .join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return zip([
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    ['word/document.xml', document],
  ]);
}
