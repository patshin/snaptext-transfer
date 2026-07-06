import { describe, expect, it } from 'vitest';
import { decryptAesGcm, encryptAesGcm } from '../src/crypto/webcrypto';
import { utf8Decode, utf8Encode } from '../src/utils/bytes';

describe('webcrypto', () => {
  it('encrypts and decrypts with PBKDF2-SHA256 and AES-GCM', async () => {
    const encrypted = await encryptAesGcm(utf8Encode('secret text'), 'passphrase', 1000);
    const plain = await decryptAesGcm({
      cipherBytes: encrypted.cipherBytes,
      passphrase: 'passphrase',
      salt: encrypted.salt,
      iv: encrypted.iv,
      iterations: encrypted.iterations,
    });
    expect(utf8Decode(plain)).toBe('secret text');
  });

  it('rejects a wrong passphrase without returning garbage', async () => {
    const encrypted = await encryptAesGcm(utf8Encode('secret text'), 'passphrase', 1000);
    await expect(
      decryptAesGcm({
        cipherBytes: encrypted.cipherBytes,
        passphrase: 'wrong passphrase',
        salt: encrypted.salt,
        iv: encrypted.iv,
        iterations: encrypted.iterations,
      }),
    ).rejects.toThrow(/Decryption failed/);
  });
});
