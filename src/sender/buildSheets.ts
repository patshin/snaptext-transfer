import { crc32Hex } from '../codec/crc32';
import { encodeChunkLine, parseLine } from '../codec/lineFormat';
import { encode as encodeOcr32 } from '../codec/ocr32';
import { sha256Bytes } from '../crypto/sha256';

export type ProfileName = 'safe' | 'balanced' | 'dense';

export interface TransferProfile {
  name: ProfileName;
  label: string;
  dataCharsPerLine: number;
  fontSize: number;
  linesPerPage: number;
  description: string;
}

export const PROFILES: Record<ProfileName, TransferProfile> = {
  safe: {
    name: 'safe',
    label: 'Safe',
    dataCharsPerLine: 64,
    fontSize: 22,
    linesPerPage: 28,
    description: 'Phone camera friendly',
  },
  balanced: {
    name: 'balanced',
    label: 'Balanced',
    dataCharsPerLine: 96,
    fontSize: 18,
    linesPerPage: 40,
    description: 'Clear photos or screenshots',
  },
  dense: {
    name: 'dense',
    label: 'Dense',
    dataCharsPerLine: 128,
    fontSize: 14,
    linesPerPage: 55,
    description: '4K screens and sharp captures',
  },
};

export interface OcrLineEntry {
  index: number;
  line: string;
  len: number;
  crc32: string;
}

export interface OcrSheet {
  session: string;
  profile: TransferProfile;
  pageNumber: number;
  pageCount: number;
  lines: OcrLineEntry[];
  totalChunks: number;
  retransmit: boolean;
}

export interface BuiltSheets {
  session: string;
  profile: TransferProfile;
  chunkBytesPerLine: number;
  totalChunks: number;
  lines: OcrLineEntry[];
  sheets: OcrSheet[];
}

export function chunkBytesForProfile(profile: TransferProfile): number {
  const nominalBytes = Math.floor((profile.dataCharsPerLine * 5) / 8);
  if (profile.name === 'safe') {
    return Math.min(nominalBytes, 24);
  }
  if (profile.name === 'balanced') {
    return Math.min(nominalBytes, 32);
  }
  return Math.min(nominalBytes, 48);
}

async function sessionFromPackage(packageBytes: Uint8Array): Promise<string> {
  const hash = await sha256Bytes(packageBytes);
  return encodeOcr32(hash).slice(0, 6);
}

export async function buildOcrTransfer(
  packageBytes: Uint8Array,
  profileName: ProfileName,
): Promise<BuiltSheets> {
  const profile = PROFILES[profileName];
  const chunkSize = chunkBytesForProfile(profile);
  const totalChunks = Math.ceil(packageBytes.length / chunkSize);
  const session = await sessionFromPackage(packageBytes);
  const lines: OcrLineEntry[] = [];

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const chunk = packageBytes.slice(start, Math.min(start + chunkSize, packageBytes.length));
    const line = encodeChunkLine({ session, index, total: totalChunks, chunkBytes: chunk });
    lines.push({
      index,
      line,
      len: chunk.length,
      crc32: crc32Hex(chunk),
    });
  }

  return {
    session,
    profile,
    chunkBytesPerLine: chunkSize,
    totalChunks,
    lines,
    sheets: paginateOcrLines(lines, {
      session,
      profile,
      totalChunks,
      retransmit: false,
    }),
  };
}

export function paginateOcrLines(
  lines: OcrLineEntry[],
  context: {
    session: string;
    profile: TransferProfile;
    totalChunks: number;
    retransmit: boolean;
  },
): OcrSheet[] {
  const pageCount = Math.max(1, Math.ceil(lines.length / context.profile.linesPerPage));
  const sheets: OcrSheet[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    sheets.push({
      session: context.session,
      profile: context.profile,
      pageNumber: pageIndex + 1,
      pageCount,
      lines: lines.slice(
        pageIndex * context.profile.linesPerPage,
        (pageIndex + 1) * context.profile.linesPerPage,
      ),
      totalChunks: context.totalChunks,
      retransmit: context.retransmit,
    });
  }
  return sheets;
}

export function filterLinesByIndexes(lines: OcrLineEntry[], indexes: number[]): OcrLineEntry[] {
  const wanted = new Set(indexes);
  return lines.filter((entry) => wanted.has(entry.index));
}

export function validateGeneratedLine(line: string): boolean {
  try {
    parseLine(line);
    return true;
  } catch {
    return false;
  }
}
