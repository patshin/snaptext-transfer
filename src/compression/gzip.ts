import { gzipSync, gunzipSync } from 'fflate';

export type CompressionName = 'gzip';

export function compressBytes(bytes: Uint8Array): Uint8Array {
  return gzipSync(bytes, { level: 9, mtime: 0 });
}

export function decompressBytes(bytes: Uint8Array): Uint8Array {
  try {
    return gunzipSync(bytes);
  } catch (error) {
    throw new Error('Unable to decompress package body.');
  }
}
