import { describe, expect, it } from 'vitest';
import { decode, encode, normalize } from '../src/codec/ocr32';

function deterministicBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let value = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    out[i] = value & 0xff;
  }
  return out;
}

describe('ocr32', () => {
  it('roundtrips random-looking bytes without padding', () => {
    for (let length = 0; length < 128; length += 1) {
      const bytes = deterministicBytes(length, 0x12345678 + length);
      expect(decode(encode(bytes))).toEqual(bytes);
    }
  });

  it('normalizes common OCR confusions conservatively', () => {
    expect(normalize('oIl u S Z 5')).toBe('011SZ5');
  });
});
