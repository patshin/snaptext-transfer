export const OCR32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const OCR32_SET = new Set(OCR32_ALPHABET.split(''));
const VALUE_BY_CHAR = new Map<string, number>(
  OCR32_ALPHABET.split('').map((char, index) => [char, index]),
);

export function normalize(text: string): string {
  let out = '';
  for (const rawChar of text.toUpperCase()) {
    const char = rawChar === 'O' ? '0' : rawChar === 'I' || rawChar === 'L' ? '1' : rawChar;
    if (char === 'U' || /\s/.test(char)) {
      continue;
    }
    if (OCR32_SET.has(char)) {
      out += char;
    }
  }
  return out;
}

export function encode(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let out = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += OCR32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    out += OCR32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}

export function decode(text: string): Uint8Array {
  const normalized = normalize(text);
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;

  for (const char of normalized) {
    const chunk = VALUE_BY_CHAR.get(char);
    if (chunk === undefined) {
      throw new Error(`Invalid OCR32 character: ${char}`);
    }
    value = (value << 5) | chunk;
    bits += 5;
    while (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

export function isOcr32(text: string): boolean {
  return normalize(text).length === text.replace(/\s/g, '').length;
}
