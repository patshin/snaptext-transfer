import { describe, expect, it } from 'vitest';
import { crc32Hex } from '../src/codec/crc32';
import { utf8Encode } from '../src/utils/bytes';

describe('crc32', () => {
  it('matches the standard test vector', () => {
    expect(crc32Hex(utf8Encode('123456789'))).toBe('CBF43926');
  });
});
