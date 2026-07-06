import { LineFormatError, type ParsedLine, parseLine } from '../codec/lineFormat';
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

interface ParseCounters {
  parsedLines: number;
  duplicateLines: number;
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
    const char = rawChar === 'O' ? '0' : rawChar === 'I' || rawChar === 'L' ? '1' : rawChar;
    if (/[0-9]/.test(char)) {
      out += char;
    }
  }
  return out.length === width ? out : null;
}

function normalizeHexToken(text: string): string | null {
  let out = '';
  for (const rawChar of text.toUpperCase()) {
    const char = rawChar === 'O' ? '0' : rawChar === 'I' || rawChar === 'L' ? '1' : rawChar;
    if (/[0-9A-F]/.test(char)) {
      out += char;
    }
  }
  return out.length === 8 ? out : null;
}

function normalizeSessionToken(text: string): string | null {
  const session = normalizeOcr32(text);
  return session.length === 6 ? session : null;
}

function ocr32CharsForBytes(byteLength: number): number {
  return Math.ceil((byteLength * 8) / 5);
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseHeader(tokens: string[], offset: number): null | {
  session: string;
  index: string;
  total: string;
  len: string;
  crc32: string;
  byteLength: number;
} {
  if (offset + 4 >= tokens.length) {
    return null;
  }
  const session = normalizeSessionToken(tokens[offset]);
  const index = normalizeDecimalToken(tokens[offset + 1], 6);
  const total = normalizeDecimalToken(tokens[offset + 2], 6);
  const len = normalizeDecimalToken(tokens[offset + 3], 4);
  const crc32 = normalizeHexToken(tokens[offset + 4]);
  if (!session || !index || !total || !len || !crc32) {
    return null;
  }
  return {
    session,
    index,
    total,
    len,
    crc32,
    byteLength: Number(len),
  };
}

function tryParseTokenStreamAfterHeader(tokens: string[], offset: number): { line: ParsedLine; nextOffset: number } | null {
  const header = parseHeader(tokens, offset);
  if (!header) {
    return null;
  }
  const neededChars = ocr32CharsForBytes(header.byteLength);
  let data = '';
  let cursor = offset + 5;
  while (cursor < tokens.length && data.length < neededChars) {
    data += normalizeOcr32(tokens[cursor]);
    cursor += 1;
  }
  if (data.length < neededChars) {
    return null;
  }
  const candidate = [
    header.session,
    header.index,
    header.total,
    header.len,
    header.crc32,
    data.slice(0, neededChars),
  ].join(' ');
  return {
    line: parseLine(candidate),
    nextOffset: cursor,
  };
}

function tryParseTokenStreamBeforeHeader(tokens: string[], offset: number): { line: ParsedLine; nextOffset: number } | null {
  const header = parseHeader(tokens, offset + 1);
  if (!header) {
    return null;
  }
  const neededChars = ocr32CharsForBytes(header.byteLength);
  const data = normalizeOcr32(tokens[offset]);
  if (data.length < neededChars) {
    return null;
  }
  const candidate = [
    header.session,
    header.index,
    header.total,
    header.len,
    header.crc32,
    data.slice(0, neededChars),
  ].join(' ');
  return {
    line: parseLine(candidate),
    nextOffset: offset + 6,
  };
}

function parseTokenStream(text: string, sessions: Map<string, SessionParse>, counters: ParseCounters): number {
  const tokens = tokenize(text);
  let crcFailures = 0;
  let offset = 0;

  while (offset < tokens.length) {
    let parsed: { line: ParsedLine; nextOffset: number } | null = null;
    try {
      parsed = tryParseTokenStreamAfterHeader(tokens, offset);
    } catch (error) {
      if (error instanceof LineFormatError && error.code === 'crc') {
        crcFailures += 1;
      }
    }
    if (!parsed) {
      try {
        parsed = tryParseTokenStreamBeforeHeader(tokens, offset);
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

export function parseOcrText(text: string): ParsedOcrText {
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
      } else {
        invalidLines += 1;
      }
    }
  }

  crcFailures += parseTokenStream(text, sessions, counters);

  return {
    sessions: Array.from(sessions.values()).sort((a, b) => b.records.size - a.records.size),
    parsedLines: counters.parsedLines,
    crcFailures,
    invalidLines,
    duplicateLines: counters.duplicateLines,
  };
}
