import { randomBytes, toArrayBuffer, utf8Encode } from '../utils/bytes';

export const DEFAULT_PBKDF2_ITERATIONS = 600000;
export const AES_GCM_TAG_LENGTH_BITS = 128;

export interface EncryptionResult {
  cipherBytes: Uint8Array;
  salt: Uint8Array;
  iv: Uint8Array;
  iterations: number;
}

function requirePassphrase(passphrase: string): void {
  if (!passphrase) {
    throw new Error('Passphrase is required when encryption is enabled.');
  }
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  requirePassphrase(passphrase);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(utf8Encode(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptAesGcm(
  plainBytes: Uint8Array,
  passphrase: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<EncryptionResult> {
  requirePassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveAesKey(passphrase, salt, iterations);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: AES_GCM_TAG_LENGTH_BITS },
    key,
    toArrayBuffer(plainBytes),
  );
  return {
    cipherBytes: new Uint8Array(cipherBuffer),
    salt,
    iv,
    iterations,
  };
}

export async function decryptAesGcm(args: {
  cipherBytes: Uint8Array;
  passphrase: string;
  salt: Uint8Array;
  iv: Uint8Array;
  iterations: number;
}): Promise<Uint8Array> {
  requirePassphrase(args.passphrase);
  const key = await deriveAesKey(args.passphrase, args.salt, args.iterations);
  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(args.iv), tagLength: AES_GCM_TAG_LENGTH_BITS },
      key,
      toArrayBuffer(args.cipherBytes),
    );
    return new Uint8Array(plainBuffer);
  } catch (error) {
    throw new Error('Decryption failed. Check the passphrase and OCR data.');
  }
}
