import { compressBytes, decompressBytes } from '../compression/gzip';
import { sha256Hex } from '../crypto/sha256';
import {
  AES_GCM_TAG_LENGTH_BITS,
  DEFAULT_PBKDF2_ITERATIONS,
  decryptAesGcm,
  encryptAesGcm,
} from '../crypto/webcrypto';
import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  readUint32BE,
  sanitizeFilename,
  uint32ToBytesBE,
  utf8Decode,
  utf8Encode,
} from '../utils/bytes';

const MAGIC = utf8Encode('STP1');
const VERSION = 1;
const HEADER_BYTES = 10;

export interface PackageMeta {
  app: 'snaptext-transfer';
  protocolVersion: 1;
  createdAt: string;
  plainTextBytes: number;
  compressedBytes: number;
  bodyBytes: number;
  compression: 'gzip';
  encrypted: boolean;
  kdf?: {
    name: 'PBKDF2-SHA256';
    iterations: number;
    saltBase64: string;
  };
  cipher?: {
    name: 'AES-GCM';
    keyBits: 256;
    ivBase64: string;
    tagLength: 128;
  };
  plainSha256Hex: string;
  compressedSha256Hex: string;
  filename: string;
}

export interface BuildPackageInput {
  plainText: string;
  filename?: string;
  passphrase?: string;
  encrypted?: boolean;
  iterations?: number;
  createdAt?: string;
}

export interface BuiltPackage {
  bytes: Uint8Array;
  meta: PackageMeta;
  compressedBytes: Uint8Array;
  bodyBytes: Uint8Array;
}

export interface ParsedPackage {
  meta: PackageMeta;
  plainText: string;
  plainBytes: Uint8Array;
  compressedBytes: Uint8Array;
}

function assertMagic(bytes: Uint8Array): void {
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (bytes[i] !== MAGIC[i]) {
      throw new Error('Invalid package magic. Expected STP1.');
    }
  }
}

function validateMeta(meta: PackageMeta): void {
  if (meta.app !== 'snaptext-transfer' || meta.protocolVersion !== 1) {
    throw new Error('Unsupported package metadata.');
  }
  if (meta.compression !== 'gzip') {
    throw new Error(`Unsupported compression: ${meta.compression}`);
  }
  if (meta.encrypted && (!meta.kdf || !meta.cipher)) {
    throw new Error('Encrypted package is missing crypto metadata.');
  }
}

export async function buildPackage(input: BuildPackageInput): Promise<BuiltPackage> {
  const encrypted = input.encrypted ?? true;
  const plainBytes = utf8Encode(input.plainText);
  const compressedBytes = compressBytes(plainBytes);
  const plainSha256Hex = await sha256Hex(plainBytes);
  const compressedSha256Hex = await sha256Hex(compressedBytes);
  const filename = sanitizeFilename(input.filename);

  let bodyBytes = compressedBytes;
  let kdf: PackageMeta['kdf'];
  let cipher: PackageMeta['cipher'];

  if (encrypted) {
    const result = await encryptAesGcm(
      compressedBytes,
      input.passphrase ?? '',
      input.iterations ?? DEFAULT_PBKDF2_ITERATIONS,
    );
    bodyBytes = result.cipherBytes;
    kdf = {
      name: 'PBKDF2-SHA256',
      iterations: result.iterations,
      saltBase64: bytesToBase64(result.salt),
    };
    cipher = {
      name: 'AES-GCM',
      keyBits: 256,
      ivBase64: bytesToBase64(result.iv),
      tagLength: AES_GCM_TAG_LENGTH_BITS,
    };
  }

  const meta: PackageMeta = {
    app: 'snaptext-transfer',
    protocolVersion: 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
    plainTextBytes: plainBytes.length,
    compressedBytes: compressedBytes.length,
    bodyBytes: bodyBytes.length,
    compression: 'gzip',
    encrypted,
    ...(kdf ? { kdf } : {}),
    ...(cipher ? { cipher } : {}),
    plainSha256Hex,
    compressedSha256Hex,
    filename,
  };

  const metaBytes = utf8Encode(JSON.stringify(meta));
  const header = concatBytes([MAGIC, new Uint8Array([VERSION, encrypted ? 1 : 0]), uint32ToBytesBE(metaBytes.length)]);
  return {
    bytes: concatBytes([header, metaBytes, bodyBytes]),
    meta,
    compressedBytes,
    bodyBytes,
  };
}

export async function parsePackage(bytes: Uint8Array, passphrase = ''): Promise<ParsedPackage> {
  if (bytes.length < HEADER_BYTES) {
    throw new Error('Package is too short.');
  }
  assertMagic(bytes);
  const version = bytes[4];
  if (version !== VERSION) {
    throw new Error(`Unsupported package version: ${version}`);
  }
  const metaLen = readUint32BE(bytes, 6);
  const metaStart = HEADER_BYTES;
  const metaEnd = metaStart + metaLen;
  if (metaLen <= 0 || metaEnd > bytes.length) {
    throw new Error('Invalid package metadata length.');
  }

  const meta = JSON.parse(utf8Decode(bytes.slice(metaStart, metaEnd))) as PackageMeta;
  validateMeta(meta);
  const bodyBytes = bytes.slice(metaEnd);
  if (bodyBytes.length !== meta.bodyBytes) {
    throw new Error('Package body length does not match metadata.');
  }

  let compressedBytes: Uint8Array;
  if (meta.encrypted) {
    if (!meta.kdf || !meta.cipher) {
      throw new Error('Encrypted package is missing crypto metadata.');
    }
    compressedBytes = await decryptAesGcm({
      cipherBytes: bodyBytes,
      passphrase,
      salt: base64ToBytes(meta.kdf.saltBase64),
      iv: base64ToBytes(meta.cipher.ivBase64),
      iterations: meta.kdf.iterations,
    });
  } else {
    compressedBytes = bodyBytes;
  }

  const compressedHash = await sha256Hex(compressedBytes);
  if (compressedHash !== meta.compressedSha256Hex) {
    throw new Error('Compressed SHA-256 mismatch. Refusing to recover text.');
  }
  const plainBytes = decompressBytes(compressedBytes);
  const plainHash = await sha256Hex(plainBytes);
  if (plainHash !== meta.plainSha256Hex) {
    throw new Error('Plain text SHA-256 mismatch. Refusing to recover text.');
  }

  return {
    meta,
    plainText: utf8Decode(plainBytes),
    plainBytes,
    compressedBytes,
  };
}
