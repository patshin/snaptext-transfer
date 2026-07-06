import { describe, expect, it } from 'vitest';
import { formatMissingRanges, parseRanges } from '../src/codec/ranges';

describe('ranges', () => {
  it('parses compact range lists with spaces', () => {
    expect(parseRanges('12-15, 44, 109 - 113')).toEqual([
      12, 13, 14, 15, 44, 109, 110, 111, 112, 113,
    ]);
  });

  it('rejects invalid input', () => {
    expect(() => parseRanges('9-4')).toThrow();
    expect(() => parseRanges('1,,2')).toThrow();
    expect(() => parseRanges('abc')).toThrow();
  });

  it('formats missing ranges', () => {
    expect(formatMissingRanges(new Set([4, 5, 6, 7, 9, 10]), 12)).toBe('0-3,8,11');
  });
});
