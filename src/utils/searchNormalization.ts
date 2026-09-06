/**
 * Reusable Symbol-Insensitive Search & Optical Power Normalization Utilities
 * Supports Tally-style instant search across Parties, Stock Items, and Batches.
 */

export interface SearchCandidate {
  id: string;
  name: string;
  code?: string;
  sph?: number | string | null;
  cyl?: number | string | null;
  axis?: number | string | null;
  add?: number | string | null;
  side?: string | null;
  barcode?: string;
  categoryCode?: string;
  rawText?: string;
}

/**
 * Normalizes text by removing non-alphanumeric punctuation and collapsing whitespace.
 * e.g., "HC_SV_-6/-2" -> "hc sv 6 2"
 */
export function normalizeSearchText(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[*_+\\-\\/.()[\\]{}:,;~#@!&|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips all non-alphanumeric characters.
 * e.g., "HC SV -6/-2" -> "hcsv62"
 */
export function stripSymbols(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Tokenizes search query into clean normalized tokens.
 */
export function tokenizeSearch(query: string | null | undefined): string[] {
  if (!query) return [];
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

/**
 * Generates searchable power variants for an optical number.
 * e.g. -2.50 -> ["2.50", "2.5", "250", "25", "-2.50", "-2.5", "-250", "-25"]
 */
export function getOpticalPowerTokens(val: number | string | null | undefined): string[] {
  if (val === null || val === undefined || val === '') return [];
  const num = typeof val === 'number' ? val : parseFloat(String(val).trim());
  if (isNaN(num)) return [];

  const absNum = Math.abs(num);
  const fixed2 = absNum.toFixed(2);
  const fixed1 = absNum.toFixed(1);
  const trimmed = String(absNum);
  const intComp = Math.round(absNum * 100);
  const intShort = intComp % 10 === 0 ? Math.round(intComp / 10) : intComp;

  const variants = new Set<string>([
    fixed2,
    fixed1,
    trimmed,
    String(intComp),
    String(intShort),
  ]);

  if (num < 0) {
    variants.add('-' + fixed2);
    variants.add('-' + fixed1);
    variants.add('-' + trimmed);
    variants.add('-' + intComp);
    variants.add('-' + intShort);
  } else if (num > 0) {
    variants.add('+' + fixed2);
    variants.add('+' + fixed1);
    variants.add('+' + trimmed);
    variants.add('+' + intComp);
    variants.add('+' + intShort);
  }

  return Array.from(variants);
}

/**
 * Scores a search candidate against a query using symbol-insensitive multi-layer ranking:
 * 1. Exact match (1000)
 * 2. Starts with match (800)
 * 3. Stripped substring / token matches (500-700)
 * 4. Signed power bonus (+100 if typed sign aligns with batch power)
 */
export function scoreCandidate(c: SearchCandidate, query: string): number {
  if (!query || !query.trim()) return 100;

  const qRaw = query.trim().toLowerCase();
  const qNormalized = normalizeSearchText(qRaw);
  const qStripped = stripSymbols(qRaw);
  const qTokens = qRaw.split(/\s+/).filter(Boolean);

  const candidateTexts: string[] = [c.name, c.code || '', c.barcode || '', c.rawText || ''].filter(Boolean);
  const normCandidates = candidateTexts.map(normalizeSearchText);
  const strippedCandidates = candidateTexts.map(stripSymbols);

  const hasPowerFields = c.sph !== undefined && c.sph !== null;
  let powerTokens: string[] = [];
  if (hasPowerFields) {
    powerTokens = [
      ...getOpticalPowerTokens(c.sph),
      ...getOpticalPowerTokens(c.cyl),
      ...getOpticalPowerTokens(c.axis),
      ...getOpticalPowerTokens(c.add),
    ];
    if (c.side && c.side !== 'NONE') {
      powerTokens.push(c.side.toLowerCase());
    }
  }

  // 1. Exact match
  for (const s of strippedCandidates) {
    if (s === qStripped && s.length > 0) return 1000;
  }
  for (const n of normCandidates) {
    if (n === qNormalized && n.length > 0) return 900;
  }

  // 2. Starts-with match
  for (const s of strippedCandidates) {
    if (s.startsWith(qStripped) && qStripped.length > 0) return 800;
  }
  for (const n of normCandidates) {
    if (n.startsWith(qNormalized) && n.length > 0) return 700;
  }

  // 3. Stripped substring match (e.g., query 'hcsv62' in candidate 'hcsv62')
  let strippedSubstringScore = 0;
  for (const s of strippedCandidates) {
    if (s.includes(qStripped) && qStripped.length > 0) {
      strippedSubstringScore = 600;
      break;
    }
  }

  // 4. Token-by-token matching across names, codes, and optical power variants
  let allTokensMatched = true;
  let tokenMatchScore = 0;
  let signedBonus = 0;

  for (const token of qTokens) {
    const tStripped = stripSymbols(token);
    const tNorm = normalizeSearchText(token);
    let matchedThisToken = false;

    // Check textual matches in candidate fields
    for (const n of normCandidates) {
      if (n.includes(tNorm) && tNorm.length > 0) {
        matchedThisToken = true;
        tokenMatchScore += 50;
        break;
      }
    }
    if (!matchedThisToken) {
      for (const s of strippedCandidates) {
        if (s.includes(tStripped) && tStripped.length > 0) {
          matchedThisToken = true;
          tokenMatchScore += 40;
          break;
        }
      }
    }

    // Check optical power tokens
    if (!matchedThisToken && hasPowerFields) {
      for (const pt of powerTokens) {
        if (pt.toLowerCase() === token.toLowerCase()) {
          matchedThisToken = true;
          tokenMatchScore += 60;
          if (token.startsWith('-') || token.startsWith('+')) {
            signedBonus += 100;
          }
          break;
        } else if (pt.toLowerCase() === tStripped) {
          matchedThisToken = true;
          tokenMatchScore += 40;
          break;
        }
      }
    }

    if (!matchedThisToken) {
      allTokensMatched = false;
    }
  }

  if (allTokensMatched && qTokens.length > 0) {
    return Math.max(strippedSubstringScore, 500 + tokenMatchScore + signedBonus);
  }

  if (strippedSubstringScore > 0) {
    return strippedSubstringScore;
  }

  return 0;
}

/**
 * Filter and rank any list of items by search query using symbol-tolerant normalization.
 */
export function rankSearchMatch<T>(
  items: T[],
  query: string,
  extractCandidate: (item: T) => SearchCandidate
): T[] {
  if (!query || !query.trim()) return items;

  const scored = items
    .map(item => {
      const candidate = extractCandidate(item);
      const score = scoreCandidate(candidate, query);
      return { item, score };
    })
    .filter(res => res.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map(res => res.item);
}

/**
 * Canonical Batch Name Formatter
 * Generates uniform optical batch names adhering to ERP standards:
 * - Single Vision: "+0.25 / 0.00", "-2.50 / -1.00", "-3.00 / -2.00 × 90"
 * - Kryptok: "+0.25 / -0.50 × 90 +2.00" or "+0.25 / -0.50 × 90 +2.00 R"
 * - Progressive: "-2.00 / -1.00 × 90 +2.00 R"
 */
export function formatOpticalBatchName(powers: {
  sph?: number | string | null;
  cyl?: number | string | null;
  axis?: number | string | null;
  add?: number | string | null;
  side?: string | null;
  categoryCode?: string | null;
}): string {
  const sphNum = powers.sph !== undefined && powers.sph !== null && powers.sph !== '' ? Number(powers.sph) : 0;
  const cylNum = powers.cyl !== undefined && powers.cyl !== null && powers.cyl !== '' ? Number(powers.cyl) : 0;
  const axisNum = powers.axis !== undefined && powers.axis !== null && powers.axis !== '' ? Number(powers.axis) : 0;
  const addNum = powers.add !== undefined && powers.add !== null && powers.add !== '' ? Number(powers.add) : 0;
  const side = powers.side ? powers.side.toUpperCase().trim() : 'NONE';

  const sphStr = sphNum > 0 ? `+${sphNum.toFixed(2)}` : sphNum.toFixed(2);
  const cylStr = cylNum > 0 ? `+${cylNum.toFixed(2)}` : cylNum.toFixed(2);

  let result = `${sphStr} / ${cylStr}`;

  // AXIS: only if CYL != 0 and AXIS > 0
  if (cylNum !== 0 && axisNum > 0) {
    result += ` × ${Math.round(axisNum)}`;
  }

  // ADD: if ADD > 0
  if (addNum > 0) {
    result += ` +${addNum.toFixed(2)}`;
  }

  // SIDE: if SIDE is R, L, or BE
  if (side && side !== 'NONE') {
    result += ` ${side}`;
  }

  return result;
}
