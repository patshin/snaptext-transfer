import { describe, expect, it } from 'vitest';
import { crc32Hex } from '../src/codec/crc32';
import { encode } from '../src/codec/ocr32';
import { encodeLine, parseLine } from '../src/codec/lineFormat';
import { utf8Encode } from '../src/utils/bytes';

const chunk = utf8Encode('hello world');
const data = encode(chunk);
const line = encodeLine({
  session: '7G4K2P',
  index: 123,
  total: 1024,
  len: chunk.length,
  crc32: crc32Hex(chunk),
  data,
});

describe('lineFormat', () => {
  it('parses a normal line', () => {
    const parsed = parseLine(line);
    expect(parsed.session).toBe('7G4K2P');
    expect(parsed.index).toBe(123);
    expect(parsed.total).toBe(1024);
    expect(parsed.chunkBytes).toEqual(chunk);
  });

  it('parses lowercase and extra spaces', () => {
    const parsed = parseLine(`  ${line.toLowerCase().replaceAll(' ', '   ')}  `);
    expect(parsed.session).toBe('7G4K2P');
    expect(parsed.chunkBytes).toEqual(chunk);
  });

  it('rejects a line when CRC fails', () => {
    const replacement = line.at(-1) === '0' ? '1' : '0';
    const corrupted = `${line.slice(0, -1)}${replacement}`;
    expect(() => parseLine(corrupted)).toThrow(/CRC32/);
  });
});
