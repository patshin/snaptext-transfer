import { describe, expect, it } from 'vitest';
import { buildPackage } from '../src/codec/package';
import { parseOcrText } from '../src/receiver/parseOcrText';
import { reconstructSession } from '../src/receiver/reconstruct';
import { buildOcrTransfer } from '../src/sender/buildSheets';

describe('transfer roundtrip', () => {
  it('reconstructs text from generated OCR lines', async () => {
    const input = [
      '你好，世界',
      'console.log("中文测试");',
      '\tconst tpl = `emoji: 🙂`;',
    ].join('\n');
    const built = await buildPackage({
      plainText: input,
      passphrase: 'long passphrase for testing',
      encrypted: true,
      iterations: 1000,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const transfer = await buildOcrTransfer(built.bytes, 'balanced');
    const parsed = parseOcrText(transfer.lines.map((entry) => entry.line).join('\n'));
    const recovered = await reconstructSession(parsed.sessions[0], 'long passphrase for testing');

    expect(recovered.plainText).toBe(input);
  });
});
