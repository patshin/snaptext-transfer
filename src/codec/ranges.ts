export function parseRanges(input: string): number[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const values = new Set<number>();
  for (const rawPart of trimmed.split(',')) {
    const part = rawPart.trim();
    if (!part) {
      throw new Error('Range list contains an empty item.');
    }
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) {
      throw new Error(`Invalid range item: ${part}`);
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < 0) {
      throw new Error(`Invalid range number: ${part}`);
    }
    if (start > end) {
      throw new Error(`Range start is greater than end: ${part}`);
    }
    for (let value = start; value <= end; value += 1) {
      values.add(value);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

export function formatMissingRanges(receivedSet: Set<number>, total: number): string {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('Total must be a non-negative integer.');
  }

  const ranges: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;

  for (let index = 0; index < total; index += 1) {
    if (receivedSet.has(index)) {
      if (start !== null && previous !== null) {
        ranges.push(start === previous ? String(start) : `${start}-${previous}`);
        start = null;
        previous = null;
      }
      continue;
    }
    if (start === null) {
      start = index;
    }
    previous = index;
  }

  if (start !== null && previous !== null) {
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
  }

  return ranges.join(',');
}
