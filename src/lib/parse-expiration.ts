export type ExpirationCandidate = {
  iso: string;
  source: string;
  index: number;
};

const MONTHS: Record<string, number> = {
  enero: 1,
  ene: 1,
  january: 1,
  jan: 1,
  febrero: 2,
  feb: 2,
  february: 2,
  marzo: 3,
  mar: 3,
  march: 3,
  abril: 4,
  abr: 4,
  april: 4,
  apr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  june: 6,
  julio: 7,
  jul: 7,
  july: 7,
  agosto: 8,
  ago: 8,
  august: 8,
  aug: 8,
  septiembre: 9,
  setiembre: 9,
  sept: 9,
  sep: 9,
  set: 9,
  september: 9,
  octubre: 10,
  oct: 10,
  october: 10,
  noviembre: 11,
  nov: 11,
  november: 11,
  diciembre: 12,
  dic: 12,
  december: 12,
  dec: 12,
};

const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

const KEYWORD =
  /\b(?:venc(?:imiento|to|e)?|vcto|vencto|vto|f\s*\.?\s*v|exp(?:iracion|ira)?|caduc(?:idad|a)?|best\s*before|best\s*by|use\s*by|consum(?:ir|e|o)(?:\s+antes)?|bbd|bb)\b/gi;

const NEGATIVE_KEYWORD =
  /\b(?:elab(?:oracion)?|fab(?:ricacion)?|envasad[oa]|produccion|lote)\b/gi;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function expandYear(year: number) {
  return year < 100 ? 2000 + year : year;
}

function lastDayIso(year: number, month: number) {
  return toIsoDate(year, month, new Date(year, month, 0).getDate());
}

function stripAccents(value: string) {
  return value
    .replace(/[áàä]/gi, 'a')
    .replace(/[éèë]/gi, 'e')
    .replace(/[íìï]/gi, 'i')
    .replace(/[óòö]/gi, 'o')
    .replace(/[úùü]/gi, 'u')
    .replace(/ñ/gi, 'n');
}

function joinSplitDigits(line: string) {
  const collapsedYears = line.replace(
    /(?<!\d)(?:\d\s+){3,}\d(?!\d)/g,
    (match) => match.replace(/\s+/g, ''),
  );
  return collapsedYears
    .replace(/(\d)\s+(\d)(?=\s*[\/\-.,])/g, '$1$2')
    .replace(/([\/\-.,]\s*)(\d)\s+(\d)(?!\d)/g, '$1$2$3');
}

function containsMonth(token: string) {
  const lower = token.toLowerCase();
  return Object.keys(MONTHS).some((month) => month.length >= 3 && lower.includes(month));
}

function fixOcrTokens(line: string) {
  return line.replace(/[A-Za-z0-9]{2,}/g, (token) => {
    if (MONTHS[token.toLowerCase()] || containsMonth(token)) return token;
    const hasDigit = /\d/.test(token);
    const onlyConfusable = /^[OoIlSsBbZz]+$/.test(token);
    if (!hasDigit && !onlyConfusable) return token;
    const letters = token.replace(/[0-9]/g, '').length;
    if (hasDigit && letters > token.length / 2) return token;
    return token
      .replace(/[Oo]/g, '0')
      .replace(/[Il]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8')
      .replace(/[Zz]/g, '2');
  });
}

function stitchLines(lines: string[]) {
  const stitched: string[] = [];
  const monthOnly = new RegExp(`^(?:${MONTH_PATTERN})$`, 'i');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? '';
    if (/\d{1,2}\s*[\/\-.]\s*\d{1,2}$/.test(line) && /^\d{2,4}$/.test(next)) {
      stitched.push(`${line}/${next}`);
      index += 1;
      continue;
    }
    if (monthOnly.test(line) && /^\d{2,4}$/.test(next)) {
      stitched.push(`${line} ${next}`);
      index += 1;
      continue;
    }
    stitched.push(line);
  }
  return stitched;
}

export function normalizeOcrText(input: string) {
  const lines = stripAccents(input)
    .replace(/\r/g, '\n')
    .replace(/[|]/g, '1')
    .split('\n')
    .map((line) => joinSplitDigits(fixOcrTokens(line.replace(/[ \t]+/g, ' ').trim())))
    .filter((line) => line.length > 0);
  return stitchLines(lines).join('\n');
}

function allowShortYear(yearValue: number) {
  const year = expandYear(yearValue);
  const current = new Date().getFullYear();
  return year >= current - 2 && year <= current + 10;
}

function nearKeyword(lines: string[], starts: number[], index: number) {
  const line = lineOf(starts, index);
  return hasKeyword(lines[line] ?? '') || hasKeyword(lines[line - 1] ?? '');
}

function hasKeyword(line: string) {
  KEYWORD.lastIndex = 0;
  return KEYWORD.test(line);
}

function overlaps(ranges: Array<{ start: number; end: number }>, start: number, end: number) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function fromGlued(token: string) {
  if (token.length === 8) {
    const dayFirst = toIsoDate(
      expandYear(Number(token.slice(4))),
      Number(token.slice(2, 4)),
      Number(token.slice(0, 2)),
    );
    if (dayFirst) return dayFirst;
    return toIsoDate(Number(token.slice(0, 4)), Number(token.slice(4, 6)), Number(token.slice(6, 8)));
  }
  if (token.length === 6) {
    return toIsoDate(
      expandYear(Number(token.slice(4))),
      Number(token.slice(2, 4)),
      Number(token.slice(0, 2)),
    );
  }
  return null;
}

function lineStarts(text: string) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function lineOf(starts: number[], index: number) {
  let line = 0;
  for (let cursor = 0; cursor < starts.length; cursor += 1) {
    if (starts[cursor] <= index) line = cursor;
    else break;
  }
  return line;
}

export function extractExpirationDates(text: string): ExpirationCandidate[] {
  const normalized = normalizeOcrText(text);
  const ranges: Array<{ start: number; end: number }> = [];
  const matches: ExpirationCandidate[] = [];
  const starts = lineStarts(normalized);
  const lines = normalized.split('\n');
  const keywordLines = new Set<number>();
  lines.forEach((line, index) => {
    if (hasKeyword(line)) keywordLines.add(index);
  });

  const consider = (iso: string | null, source: string, index: number) => {
    const end = index + source.length;
    if (overlaps(ranges, index, end)) return;
    ranges.push({ start: index, end });
    if (iso) matches.push({ iso, source, index });
  };

  const dayMonthYear = (first: number, second: number, year: number) => {
    if (first > 12) return toIsoDate(year, second, first);
    if (second > 12) return toIsoDate(year, first, second);
    return toIsoDate(year, second, first);
  };

  const patterns: Array<{
    regex: RegExp;
    toIso: (match: RegExpMatchArray) => string | null;
    allow: (match: RegExpMatchArray) => boolean;
  }> = [
    {
      regex: /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g,
      toIso: (match) => toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])),
      allow: () => true,
    },
    {
      regex: /\b(\d{1,2})\s*[\/\-.,]\s*(\d{1,2})\s*[\/\-.,]\s*(\d{2,4})\b/g,
      toIso: (match) =>
        dayMonthYear(Number(match[1]), Number(match[2]), expandYear(Number(match[3]))),
      allow: () => true,
    },
    {
      regex: new RegExp(
        `\\b(\\d{1,2})(?:\\s*(?:del?\\s+|[\\/\\-.]))?\\s*(${MONTH_PATTERN})\\.?\\s*(?:del?\\s+|[\\/\\-.])?\\s*(\\d{2,4})\\b`,
        'gi',
      ),
      toIso: (match) => {
        const month = MONTHS[match[2].toLowerCase()];
        if (!month) return null;
        return toIsoDate(expandYear(Number(match[3])), month, Number(match[1]));
      },
      allow: () => true,
    },
    {
      regex: new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s*(?:del?\\s+)?(\\d{2,4})\\b`, 'gi'),
      toIso: (match) => {
        const month = MONTHS[match[1].toLowerCase()];
        const rawYear = Number(match[2]);
        if (!month || (rawYear < 100 && !allowShortYear(rawYear))) return null;
        return lastDayIso(expandYear(rawYear), month);
      },
      allow: () => true,
    },
    {
      regex: /\b(\d{1,2})\s*[\/\-.]\s*(\d{2})\b/g,
      toIso: (match) => {
        const month = Number(match[1]);
        const rawYear = Number(match[2]);
        if (month < 1 || month > 12 || !allowShortYear(rawYear)) return null;
        return lastDayIso(expandYear(rawYear), month);
      },
      allow: (match) => {
        const month = Number(match[1]);
        const rawYear = Number(match[2]);
        if (month < 1 || month > 12 || !allowShortYear(rawYear)) return false;
        if (rawYear > 12) return true;
        return nearKeyword(lines, starts, match.index ?? 0);
      },
    },
    {
      regex: /\b(\d{1,2})\s+(\d{2})\b/g,
      toIso: (match) => {
        const month = Number(match[1]);
        const rawYear = Number(match[2]);
        if (month < 1 || month > 12 || rawYear <= 12 || !allowShortYear(rawYear)) return null;
        return lastDayIso(expandYear(rawYear), month);
      },
      allow: (match) =>
        Number(match[1]) >= 1 &&
        Number(match[1]) <= 12 &&
        Number(match[2]) > 12 &&
        allowShortYear(Number(match[2])) &&
        nearKeyword(lines, starts, match.index ?? 0),
    },
    {
      regex: /\b(\d{1,2})\s*[\/\-]\s*(\d{4})\b/g,
      toIso: (match) => lastDayIso(Number(match[2]), Number(match[1])),
      allow: () => true,
    },
    {
      regex: /\b(\d{1,2})\s+(\d{1,2})\s+(\d{4})\b/g,
      toIso: (match) => dayMonthYear(Number(match[1]), Number(match[2]), Number(match[3])),
      allow: () => true,
    },
    {
      regex: /\b(\d{1,2})\s+(\d{1,2})\s+(\d{2})\b/g,
      toIso: (match) =>
        dayMonthYear(Number(match[1]), Number(match[2]), expandYear(Number(match[3]))),
      allow: (match) => {
        const line = lineOf(starts, match.index ?? 0);
        return keywordLines.has(line) || keywordLines.has(line - 1);
      },
    },
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern.regex)) {
      if (!pattern.allow(match)) continue;
      consider(pattern.toIso(match), match[0], match.index ?? 0);
    }
  }

  lines.forEach((line, lineIndex) => {
    if (!keywordLines.has(lineIndex) && !keywordLines.has(lineIndex - 1)) return;
    const lineStart = starts[lineIndex] ?? 0;
    for (const match of line.matchAll(/(?<!\d)(\d{6}|\d{8})(?!\d)/g)) {
      consider(fromGlued(match[1]), match[0], lineStart + (match.index ?? 0));
    }
  });

  const seen = new Set<string>();
  return matches
    .sort((a, b) => a.index - b.index)
    .filter((match) => {
      if (seen.has(match.iso)) return false;
      seen.add(match.iso);
      return true;
    });
}

export function pickExpirationDate(
  text: string,
  candidates = extractExpirationDates(text),
): ExpirationCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const normalized = normalizeOcrText(text);
  const starts = lineStarts(normalized);
  const lines = normalized.split('\n');
  const keywordLines = new Set<number>();
  lines.forEach((line, index) => {
    if (hasKeyword(line)) keywordLines.add(index);
  });
  KEYWORD.lastIndex = 0;
  const keywordIndexes = [...normalized.matchAll(KEYWORD)].map((match) => match.index ?? 0);

  const today = new Date();
  const scored = candidates.map((candidate) => {
    const line = lineOf(starts, candidate.index);
    const days = daysUntil(candidate.iso, today);
    let score = 0;
    const lineText = lines[line] ?? '';
    NEGATIVE_KEYWORD.lastIndex = 0;
    const looksLikeProduction = NEGATIVE_KEYWORD.test(lineText) && !hasKeyword(lineText);
    if (keywordLines.has(line)) score += 120;
    else if (keywordLines.has(line - 1)) score += 90;
    if (looksLikeProduction) score -= 80;
    if (days >= -60 && days <= 365 * 6) score += 40;
    else if (days < -365) score -= 60;
    if (keywordIndexes.length > 0) {
      const distance = Math.min(
        ...keywordIndexes.map((keywordIndex) => Math.abs(candidate.index - keywordIndex)),
      );
      score -= distance / 20;
    }
    return { candidate, score };
  });

  scored.sort((a, b) => b.score - a.score || b.candidate.iso.localeCompare(a.candidate.iso));
  return scored[0]?.candidate ?? null;
}

export function formatIsoDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

export function isoToInput(iso: string) {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export function inputToIso(value: string) {
  const match = value.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!match) return null;
  return toIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));
}

export function daysUntil(iso: string, today = new Date()) {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function expirationStatus(iso: string, today = new Date()) {
  const days = daysUntil(iso, today);
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  if (days > 1) return `Vence en ${days} días`;
  if (days === -1) return 'Venció ayer';
  return `Venció hace ${Math.abs(days)} días`;
}
