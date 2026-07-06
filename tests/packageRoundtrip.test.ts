import { describe, expect, it } from 'vitest';
import { buildPackage, parsePackage } from '../src/codec/package';

const sample = [
  '你好，世界',
  'console.log("中文测试");',
  '\tconst tpl = `hello ${name}`;',
  "if (value === 'x') { return ['🙂', { ok: true }]; }",
  'long-line:' + 'abcdef0123456789'.repeat(32),
].join('\n');

describe('package', () => {
  it('roundtrips encrypted UTF-8 text byte-for-byte', async () => {
    const built = await buildPackage({
      plainText: sample,
      filename: '../secret/recovered.txt',
      passphrase: 'correct horse battery staple',
      encrypted: true,
      iterations: 1000,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const parsed = await parsePackage(built.bytes, 'correct horse battery staple');
    expect(parsed.plainText).toBe(sample);
    expect(parsed.meta.filename).toBe('recovered.txt');
    expect(JSON.stringify(parsed.meta)).not.toContain('中文测试');
  });

  it('roundtrips unencrypted text', async () => {
    const built = await buildPackage({
      plainText: sample,
      encrypted: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const parsed = await parsePackage(built.bytes);
    expect(parsed.plainText).toBe(sample);
    expect(parsed.meta.encrypted).toBe(false);
  });
});
