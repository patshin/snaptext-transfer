import { LineFormatError, type ParsedLine, parseLine } from '../codec/lineFormat';
import { OCR32_ALPHABET } from '../codec/ocr32';
import { normalize as normalizeOcr32 } from '../codec/ocr32';

export interface SessionParse {
  session: string;
  total: number;
  records: Map<number, ParsedLine>;
  duplicateLines: number;
  inconsistentTotals: number;
}

export interface ParsedOcrText {
  sessions: SessionParse[];
  parsedLines: number;
  crcFailures: number;
  invalidLines: number;
  duplicateLines: number;
}

export interface ParseOcrTextOptions {
  repairLength?: boolean;
  repairSubstitutions?: boolean;
}

interface ParseCounters {
  parsedLines: number;
  duplicateLines: number;
}

interface HeaderCandidate {
  session: string;
  index: string;
  total: string;
  len: string;
  crc32: string;
  byteLength: number;
}

function getOrCreateSession(sessions: Map<string, SessionParse>, line: ParsedLine): SessionParse {
  let session = sessions.get(line.session);
  if (!session) {
    session = {
      session: line.session,
      total: line.total,
      records: new Map(),
      duplicateLines: 0,
      inconsistentTotals: 0,
    };
    sessions.set(line.session, session);
  }
  return session;
}

function addParsedLine(
  sessions: Map<string, SessionParse>,
  line: ParsedLine,
  counters: ParseCounters,
  countDuplicate = true,
): void {
  const session = getOrCreateSession(sessions, line);
  if (session.total !== line.total) {
    session.inconsistentTotals += 1;
    session.total = Math.max(session.total, line.total);
  }
  if (session.records.has(line.index)) {
    if (countDuplicate) {
      counters.duplicateLines += 1;
      session.duplicateLines += 1;
    }
    return;
  }
  session.records.set(line.index, line);
  counters.parsedLines += 1;
}

function normalizeDecimalToken(text: string, width: number): string | null {
  let out = '';
  for (const rawChar of text.toUpperCase()) {
    const char = rawChar === 'O' || rawChar === 'Q' ? '0' : rawChar === 'I' || rawChar === 'L' ? '1' : rawChar;
    if (/[0-9]/.test(char)) {
      out += char;
    }
  }
  return out.length === width ? out : null;
}

function normalizeHexCandidates(text: string): string[] {
  let out = '';
  for (const rawChar of text.toUpperCase()) {
    const char = rawChar === 'O' || rawChar === 'Q' ? '0' : rawChar === 'I' || rawChar === 'L' ? '1' : rawChar;
    if (/[0-9A-F]/.test(char)) {
      out += char;
    }
  }
  if (out.length === 8) {
    return [out];
  }

  const candidates = new Set<string>();
  if (out.length === 7) {
    for (let index = 0; index <= out.length; index += 1) {
      for (const char of '0123456789ABCDEF') {
        candidates.add(out.slice(0, index) + char + out.slice(index));
      }
    }
  } else if (out.length === 9) {
    for (let index = 0; index < out.length; index += 1) {
      candidates.add(out.slice(0, index) + out.slice(index + 1));
    }
  }
  return Array.from(candidates);
}

function normalizeSessionToken(text: string): string | null {
  const session = normalizeOcr32(text);
  return session.length === 6 ? session : null;
}

function ocr32CharsForBytes(byteLength: number): number {
  return Math.ceil((byteLength * 8) / 5);
}

const MAX_SINGLE_SUBSTITUTION_REPAIR_CHARS = 64;
const OCR32_CONFUSIONS: Record<string, string[]> = {
  '0': ['Q', 'D'],
  '1': ['T'],
  '2': ['Z'],
  '5': ['S'],
  '6': ['G'],
  '8': ['B'],
  B: ['8'],
  D: ['0'],
  G: ['6'],
  M: ['N'],
  N: ['M'],
  Q: ['0'],
  S: ['5'],
  T: ['1'],
  V: ['Y'],
  Y: ['V'],
  Z: ['2'],
};

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseHeader(tokens: string[], offset: number): HeaderCandidate | null {
  return parseHeaderCandidates(tokens, offset)[0] ?? null;
}

function looksLikeEncodedLine(tokens: string[]): boolean {
  return parseHeaderCandidates(tokens, 0).length > 0 || (
    tokens.length >= 6 &&
    normalizeSessionToken(tokens[0]) !== null &&
    normalizeDecimalToken(tokens[1], 6) !== null &&
    normalizeDecimalToken(tokens[2], 6) !== null &&
    normalizeDecimalToken(tokens[3], 4) !== null
  );
}

function parseHeaderCandidates(tokens: string[], offset: number): HeaderCandidate[] {
  if (offset + 4 >= tokens.length) {
    return [];
  }
  const session = normalizeSessionToken(tokens[offset]);
  const index = normalizeDecimalToken(tokens[offset + 1], 6);
  const total = normalizeDecimalToken(tokens[offset + 2], 6);
  const len = normalizeDecimalToken(tokens[offset + 3], 4);
  const crcCandidates = normalizeHexCandidates(tokens[offset + 4]);
  if (!session || !index || !total || !len || crcCandidates.length === 0) {
    return [];
  }
  return crcCandidates.map((crc32) => ({
    session,
    index,
    total,
    len,
    crc32,
    byteLength: Number(len),
  }));
}

function parseCandidate(header: HeaderCandidate, data: string): ParsedLine {
  const neededChars = ocr32CharsForBytes(header.byteLength);
  const candidate = [
    header.session,
    header.index,
    header.total,
    header.len,
    header.crc32,
    data.slice(0, neededChars),
  ].join(' ');
  return parseLine(candidate);
}

function candidateDataStrings(
  data: string,
  neededChars: number,
  options: Required<ParseOcrTextOptions>,
): string[] {
  const candidates = new Set<string>();
  const addSingleSubstitutionRepairs = (candidate: string): void => {
    if (!options.repairSubstitutions) {
      return;
    }
    if (candidate.length > MAX_SINGLE_SUBSTITUTION_REPAIR_CHARS) {
      return;
    }
    for (let index = 0; index < candidate.length; index += 1) {
      for (const char of OCR32_CONFUSIONS[candidate[index]] ?? []) {
        if (char !== candidate[index] && OCR32_ALPHABET.includes(char)) {
          candidates.add(candidate.slice(0, index) + char + candidate.slice(index + 1));
        }
      }
    }
  };

  if (data.length >= neededChars) {
    const prefix = data.slice(0, neededChars);
    candidates.add(prefix);
    if (data.length === neededChars) {
      addSingleSubstitutionRepairs(prefix);
    }

    if (options.repairLength && data.length > neededChars) {
      const repairWindow = data.slice(0, neededChars + 1);
      for (let index = 0; index < repairWindow.length; index += 1) {
        candidates.add(repairWindow.slice(0, index) + repairWindow.slice(index + 1));
      }
    }
  } else if (options.repairLength && neededChars - data.length === 1) {
    for (let index = 0; index <= data.length; index += 1) {
      for (const char of OCR32_ALPHABET) {
        candidates.add(data.slice(0, index) + char + data.slice(index));
      }
    }
  }
  return Array.from(candidates);
}

function tryParseHeaderWithData(
  headers: HeaderCandidate[],
  data: string,
  options: Required<ParseOcrTextOptions>,
): ParsedLine | null {
  if (headers.length === 0) {
    return null;
  }
  const neededChars = ocr32CharsForBytes(headers[0].byteLength);
  let sawCrcFailure = false;

  for (const dataCandidate of candidateDataStrings(data, neededChars, options)) {
    for (const header of headers) {
      try {
        return parseCandidate(header, dataCandidate);
      } catch (error) {
        if (error instanceof LineFormatError && error.code === 'crc') {
          sawCrcFailure = true;
        } else {
          throw error;
        }
      }
    }
  }

  if (sawCrcFailure) {
    throw new LineFormatError('Line CRC32 did not match.', 'crc');
  }
  return null;
}

function tryParseTokenStreamAfterHeader(
  tokens: string[],
  offset: number,
  options: Required<ParseOcrTextOptions>,
): { line: ParsedLine; nextOffset: number } | null {
  const headers = parseHeaderCandidates(tokens, offset);
  if (headers.length === 0) {
    return null;
  }
  let sawCrcFailure = false;
  const neededChars = ocr32CharsForBytes(headers[0].byteLength);
  let data = '';
  let cursor = offset + 5;
  while (cursor < tokens.length && data.length < neededChars) {
    data += normalizeOcr32(tokens[cursor]);
    cursor += 1;
  }
  if (data.length < neededChars - 1) {
    return null;
  }
  try {
    const line = tryParseHeaderWithData(headers, data, options);
    if (line) {
      return {
        line,
        nextOffset: cursor,
      };
    }
  } catch (error) {
    if (error instanceof LineFormatError && error.code === 'crc') {
      sawCrcFailure = true;
    } else {
      throw error;
    }
  }
  if (sawCrcFailure) {
    throw new LineFormatError('Line CRC32 did not match.', 'crc');
  }
  return null;
}

function tryParseTokenStreamBeforeHeader(
  tokens: string[],
  offset: number,
  options: Required<ParseOcrTextOptions>,
): { line: ParsedLine; nextOffset: number } | null {
  const headers = parseHeaderCandidates(tokens, offset + 1);
  if (headers.length === 0) {
    return null;
  }
  const neededChars = ocr32CharsForBytes(headers[0].byteLength);
  const data = normalizeOcr32(tokens[offset]);
  if (data.length < neededChars - 1) {
    return null;
  }
  let sawCrcFailure = false;
  try {
    const line = tryParseHeaderWithData(headers, data, options);
    if (line) {
      return {
        line,
        nextOffset: offset + 6,
      };
    }
  } catch (error) {
    if (error instanceof LineFormatError && error.code === 'crc') {
      sawCrcFailure = true;
    } else {
      throw error;
    }
  }
  if (sawCrcFailure) {
    throw new LineFormatError('Line CRC32 did not match.', 'crc');
  }
  return null;
}

function parseLineBlocks(
  text: string,
  sessions: Map<string, SessionParse>,
  counters: ParseCounters,
  options: Required<ParseOcrTextOptions>,
): number {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  let crcFailures = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const tokens = tokenize(lines[lineIndex]);
    const headers = parseHeaderCandidates(tokens, 0);
    if (headers.length === 0) {
      continue;
    }

    const neededChars = ocr32CharsForBytes(headers[0].byteLength);
    let data = normalizeOcr32(tokens.slice(5).join(''));
    let nextLineIndex = lineIndex + 1;
    while (nextLineIndex < lines.length && data.length < neededChars + 1) {
      const nextTokens = tokenize(lines[nextLineIndex]);
      if (parseHeader(nextTokens, 0)) {
        break;
      }
      data += normalizeOcr32(nextTokens.join(''));
      nextLineIndex += 1;
    }

    if (data.length < neededChars - 1) {
      continue;
    }

    try {
      const parsed = tryParseHeaderWithData(headers, data, options);
      if (parsed) {
        addParsedLine(sessions, parsed, counters, false);
      }
    } catch (error) {
      if (error instanceof LineFormatError && error.code === 'crc') {
        crcFailures += 1;
      }
    }
  }

  return crcFailures;
}

function parseTokenStream(
  text: string,
  sessions: Map<string, SessionParse>,
  counters: ParseCounters,
  options: Required<ParseOcrTextOptions>,
): number {
  const tokens = tokenize(text);
  const tokenStreamOptions: Required<ParseOcrTextOptions> = {
    ...options,
    repairLength: false,
    repairSubstitutions: false,
  };
  let crcFailures = 0;
  let offset = 0;

  while (offset < tokens.length) {
    let parsed: { line: ParsedLine; nextOffset: number } | null = null;
    try {
      parsed = tryParseTokenStreamAfterHeader(tokens, offset, tokenStreamOptions);
    } catch (error) {
      if (error instanceof LineFormatError && error.code === 'crc') {
        crcFailures += 1;
      }
    }
    if (!parsed) {
      try {
        parsed = tryParseTokenStreamBeforeHeader(tokens, offset, tokenStreamOptions);
      } catch (error) {
        if (error instanceof LineFormatError && error.code === 'crc') {
          crcFailures += 1;
        }
      }
    }
    if (parsed) {
      addParsedLine(sessions, parsed.line, counters, false);
      offset = Math.max(offset + 1, parsed.nextOffset);
    } else {
      offset += 1;
    }
  }

  return crcFailures;
}

export function parseOcrText(text: string, options: ParseOcrTextOptions = {}): ParsedOcrText {
  const normalizedOptions: Required<ParseOcrTextOptions> = {
    repairLength: options.repairLength ?? true,
    repairSubstitutions: options.repairSubstitutions ?? true,
  };
  const sessions = new Map<string, SessionParse>();
  const counters: ParseCounters = {
    parsedLines: 0,
    duplicateLines: 0,
  };
  let crcFailures = 0;
  let invalidLines = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = parseLine(line);
      addParsedLine(sessions, parsed, counters);
    } catch (error) {
      if (error instanceof LineFormatError && error.code === 'crc') {
        crcFailures += 1;
      } else if (looksLikeEncodedLine(tokenize(line))) {
        invalidLines += 1;
      }
    }
  }

  crcFailures += parseTokenStream(text, sessions, counters, normalizedOptions);
  crcFailures += parseLineBlocks(text, sessions, counters, normalizedOptions);

  return {
    sessions: Array.from(sessions.values()).sort((a, b) => b.records.size - a.records.size),
    parsedLines: counters.parsedLines,
    crcFailures,
    invalidLines,
    duplicateLines: counters.duplicateLines,
  };
}
