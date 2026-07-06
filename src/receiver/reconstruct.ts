import { formatMissingRanges } from '../codec/ranges';
import { parsePackage, type ParsedPackage } from '../codec/package';
import { concatBytes } from '../utils/bytes';
import type { SessionParse } from './parseOcrText';

export interface ReconstructionResult extends ParsedPackage {
  packageBytes: Uint8Array;
}

export function getReceivedSet(session: SessionParse): Set<number> {
  return new Set(session.records.keys());
}

export function getMissingRanges(session: SessionParse): string {
  return formatMissingRanges(getReceivedSet(session), session.total);
}

export function isSessionComplete(session: SessionParse): boolean {
  return session.records.size === session.total && !getMissingRanges(session);
}

export async function reconstructSession(
  session: SessionParse,
  passphrase: string,
): Promise<ReconstructionResult> {
  const missing = getMissingRanges(session);
  if (missing) {
    throw new Error(`Missing OCR lines: ${missing}`);
  }

  const chunks: Uint8Array[] = [];
  for (let index = 0; index < session.total; index += 1) {
    const record = session.records.get(index);
    if (!record) {
      throw new Error(`Missing OCR line: ${index}`);
    }
    chunks.push(record.chunkBytes);
  }
  const packageBytes = concatBytes(chunks);
  const parsed = await parsePackage(packageBytes, passphrase);
  return {
    ...parsed,
    packageBytes,
  };
}
