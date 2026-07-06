import { crc32Hex } from './crc32';
import { decode, encode, normalize as normalizeOcr32 } from './ocr32';
import { padNumber } from '../utils/format';

export interface LineFields {
  session: string;
  index: number;
  total: number;
  len: number;
  crc32: string;
  data: string;
}

export interface ParsedLine extends LineFields {
  chunkBytes: Uint8Array;
}

export class LineFormatError extends Error {
  constructor(
    message: string,
    public readonly code: 'shape' | 'crc' | 'length',
  ) {
    super(message);
    this.name = 'LineFormatError';
  }
}

function normalizeDecimal(text: string, width: number): string {
  let out = '';
  for (const rawChar of text.toUpperCase()) {
    const char = rawChar === 'O' ? '0' : rawChar === 'I' || rawChar === 'L' ? '1' : rawChar;
    if (/[0-9]/.test(char)) {
      out += char;
    } else if (!/\s/.test(char)) {
      throw new LineFormatError(`Invalid decimal field: ${text}`, 'shape');
    }
  }
  if (out.length !== width) {
    throw new LineFormatError(`Decimal field must be ${width} digits.`, 'shape');
  }
  return out;
}

function normalizeHex(text: string): string {
  let out = '';
  for (const rawChar of text.toUpperCase()) {
    const char = rawChar === 'O' ? '0' : rawChar === 'I' || rawChar === 'L' ? '1' : rawChar;
    if (/[0-9A-F]/.test(char)) {
      out += char;
    } else if (!/\s/.test(char)) {
      throw new LineFormatError(`Invalid CRC field: ${text}`, 'shape');
    }
  }
  if (out.length !== 8) {
    throw new LineFormatError('CRC field must be 8 hex characters.', 'shape');
  }
  return out;
}

export function encodeLine(fields: LineFields): string {
  if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/.test(fields.session)) {
    throw new Error('Session must be 6 OCR32 characters.');
  }
  if (fields.index < 0 || fields.index > 999999 || fields.total < 0 || fields.total > 999999) {
    throw new Error('Index and total must fit in 6 decimal digits.');
  }
  if (fields.len < 0 || fields.len > 9999) {
    throw new Error('Length must fit in 4 decimal digits.');
  }
  if (!/^[0-9A-F]{8}$/.test(fields.crc32)) {
    throw new Error('CRC32 must be 8 uppercase hex characters.');
  }
  const data = normalizeOcr32(fields.data);
  if (data !== fields.data) {
    throw new Error('Data must already be normalized OCR32.');
  }

  return [
    fields.session,
    padNumber(fields.index, 6),
    padNumber(fields.total, 6),
    padNumber(fields.len, 4),
    fields.crc32,
    fields.data,
  ].join(' ');
}

export function encodeChunkLine(args: {
  session: string;
  index: number;
  total: number;
  chunkBytes: Uint8Array;
}): string {
  return encodeLine({
    session: args.session,
    index: args.index,
    total: args.total,
    len: args.chunkBytes.length,
    crc32: crc32Hex(args.chunkBytes),
    data: encode(args.chunkBytes),
  });
}

export function parseLine(line: string): ParsedLine {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 6) {
    throw new LineFormatError('Line does not contain enough fields.', 'shape');
  }

  const session = normalizeOcr32(parts[0]);
  if (session.length !== 6) {
    throw new LineFormatError('Session must be 6 OCR32 characters.', 'shape');
  }

  const indexText = normalizeDecimal(parts[1], 6);
  const totalText = normalizeDecimal(parts[2], 6);
  const lenText = normalizeDecimal(parts[3], 4);
  const crcText = normalizeHex(parts[4]);
  const data = normalizeOcr32(parts.slice(5).join(''));
  if (!data) {
    throw new LineFormatError('Missing OCR32 data.', 'shape');
  }

  const index = Number(indexText);
  const total = Number(totalText);
  const len = Number(lenText);
  const decoded = decode(data);
  if (decoded.length < len) {
    throw new LineFormatError('Decoded data is shorter than declared length.', 'length');
  }
  const chunkBytes = decoded.slice(0, len);
  const actualCrc = crc32Hex(chunkBytes);
  if (actualCrc !== crcText) {
    throw new LineFormatError('Line CRC32 did not match.', 'crc');
  }

  return {
    session,
    index,
    total,
    len,
    crc32: crcText,
    data,
    chunkBytes,
  };
}
