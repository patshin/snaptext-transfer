import { describe, expect, it } from 'vitest';
import { encodeChunkLine } from '../src/codec/lineFormat';
import { parseOcrText } from '../src/receiver/parseOcrText';

const chunk = new Uint8Array(Array.from({ length: 60 }, (_, index) => (index * 17 + 9) & 0xff));
const line = encodeChunkLine({
  session: 'XZQSVC',
  index: 5,
  total: 21,
  chunkBytes: chunk,
});
const [session, index, total, len, crc32, data] = line.split(' ');

describe('parseOcrText', () => {
  it('reconstructs a record when OCR splits fields onto separate lines', () => {
    const text = [session.toLowerCase(), index, total, len, crc32, data.slice(0, 40), data.slice(40)].join('\n\n');
    const parsed = parseOcrText(text);

    expect(parsed.parsedLines).toBe(1);
    expect(parsed.sessions[0].session).toBe(session);
    expect(parsed.sessions[0].records.get(5)?.chunkBytes).toEqual(chunk);
  });

  it('reconstructs a record when OCR emits data before the header fields', () => {
    const text = [data, session.toLowerCase(), index, total, len, crc32].join('\n\n');
    const parsed = parseOcrText(text);

    expect(parsed.parsedLines).toBe(1);
    expect(parsed.sessions[0].session).toBe(session);
    expect(parsed.sessions[0].records.get(5)?.chunkBytes).toEqual(chunk);
  });
});
