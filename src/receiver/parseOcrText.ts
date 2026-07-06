import { LineFormatError, type ParsedLine, parseLine } from '../codec/lineFormat';

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

export function parseOcrText(text: string): ParsedOcrText {
  const sessions = new Map<string, SessionParse>();
  let parsedLines = 0;
  let crcFailures = 0;
  let invalidLines = 0;
  let duplicateLines = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = parseLine(line);
      parsedLines += 1;
      const session = getOrCreateSession(sessions, parsed);
      if (session.total !== parsed.total) {
        session.inconsistentTotals += 1;
        session.total = Math.max(session.total, parsed.total);
      }
      if (session.records.has(parsed.index)) {
        session.duplicateLines += 1;
        duplicateLines += 1;
      } else {
        session.records.set(parsed.index, parsed);
      }
    } catch (error) {
      if (error instanceof LineFormatError && error.code === 'crc') {
        crcFailures += 1;
      } else {
        invalidLines += 1;
      }
    }
  }

  return {
    sessions: Array.from(sessions.values()).sort((a, b) => b.records.size - a.records.size),
    parsedLines,
    crcFailures,
    invalidLines,
    duplicateLines,
  };
}
