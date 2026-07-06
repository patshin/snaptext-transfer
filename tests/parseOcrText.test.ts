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
  it('ignores sheet header and footer while parsing valid OCR lines', () => {
    const chunks = Array.from({ length: 4 }, (_, chunkIndex) => (
      new Uint8Array(Array.from({ length: 60 }, (_, byteIndex) => (chunkIndex * 43 + byteIndex * 17 + 9) & 0xff))
    ));
    const lines = chunks.map((chunkBytes, index) => encodeChunkLine({
      session: 'XZQSVC',
      index,
      total: chunks.length,
      chunkBytes,
    }));
    const text = [
      'SNAPTEXT v1',
      'session XZQSVC        page 171        Balanced profile - 96 chars line',
      ...lines,
      'Only scan with snaptext-transfer Encrypted yes',
    ].join('\n');

    const parsed = parseOcrText(text);

    expect(parsed.parsedLines).toBe(4);
    expect(parsed.sessions[0].records.size).toBe(4);
    expect(parsed.crcFailures).toBe(0);
  });

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

  it('accepts grouped OCR32 data rendered with spaces', () => {
    const groupedData = data.match(/.{1,4}/g)?.join(' ') ?? data;
    const parsed = parseOcrText([session, index, total, len, crc32, groupedData].join(' '));

    expect(parsed.parsedLines).toBe(1);
    expect(parsed.sessions[0].records.get(5)?.chunkBytes).toEqual(chunk);
  });

  it('repairs a single dropped trailing CRC character only when CRC validation passes', () => {
    const parsed = parseOcrText([session, index, total, len, crc32.slice(0, 7), data].join(' '));

    expect(parsed.parsedLines).toBe(1);
    expect(parsed.sessions[0].records.get(5)?.crc32).toBe(crc32);
  });

  it('repairs a single dropped CRC character in the middle only when CRC validation passes', () => {
    const damagedCrc = crc32.slice(0, 3) + crc32.slice(4);
    const parsed = parseOcrText([session, index, total, len, damagedCrc, data].join(' '));

    expect(parsed.parsedLines).toBe(1);
    expect(parsed.sessions[0].records.get(5)?.crc32).toBe(crc32);
  });

  it('repairs one inserted OCR32 data character in sheet-style rows only when CRC validation passes', () => {
    const damagedData = data.slice(0, 12) + '0' + data.slice(12);
    const text = [
      [session, index, total, len, crc32].join(' '),
      damagedData.slice(0, 48).match(/.{1,2}/g)?.join(' '),
      damagedData.slice(48).match(/.{1,2}/g)?.join(' '),
    ].join('\n');

    const parsed = parseOcrText(text);

    expect(parsed.parsedLines).toBe(1);
    expect(parsed.sessions[0].records.get(5)?.chunkBytes).toEqual(chunk);
  });

  it('repairs one missing OCR32 data character in sheet-style rows only when CRC validation passes', () => {
    const damagedData = data.slice(0, 12) + data.slice(13);
    const text = [
      [session, index, total, len, crc32].join(' '),
      damagedData.slice(0, 48).match(/.{1,2}/g)?.join(' '),
      damagedData.slice(48).match(/.{1,2}/g)?.join(' '),
    ].join('\n');

    const parsed = parseOcrText(text);

    expect(parsed.parsedLines).toBe(1);
    expect(parsed.sessions[0].records.get(5)?.chunkBytes).toEqual(chunk);
  });
});
