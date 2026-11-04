/**
 * Quote parser for free text replies: voice transcripts and WhatsApp messages.
 *
 * Vendors reply in short English and shorthand, for example:
 *   "38500, toll extra"
 *   "rate 41k, toll extra"
 *   "Rs. 41,000, vehicle ready tomorrow"
 *
 * This is a deterministic rules parser with an explicit confidence score. Anything
 * below the confidence threshold, or far from the rate card reference, is flagged
 * for a sales agent to verify before the quote is used, per the POC guardrails.
 */

export interface ParsedQuote {
  rate: number | null;
  tollIncluded: boolean;
  availableOnDate: boolean | null;
  conditions: string[];
  confidence: number;
}

export const CONFIDENCE_THRESHOLD = 0.8;
export const RATE_CARD_TOLERANCE = 0.3;
const MIN_PLAUSIBLE_RATE = 3000;
const MAX_PLAUSIBLE_RATE = 300000;

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALE_WORDS: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000 };

/** Words that may sit between number words without breaking the amount. */
const FILLER_WORDS = new Set(['and', 'rupee', 'rupees', 'rs', 'inr', 'only', 'around', 'about']);

/**
 * Reads an amount spoken as words ("fifteen thousand", "twenty five thousand
 * five hundred") out of a transcript. Voice replies rarely contain digits.
 */
function findSpokenRateCandidates(text: string): number[] {
  const found: number[] = [];
  let total = 0;
  let current = 0;

  const flush = () => {
    const value = total + current;
    if (value >= MIN_PLAUSIBLE_RATE && value <= MAX_PLAUSIBLE_RATE) found.push(value);
    total = 0;
    current = 0;
  };

  for (const token of text.toLowerCase().split(/[^a-z]+/)) {
    if (token.length === 0) continue;
    const small = NUMBER_WORDS[token];
    if (small !== undefined) {
      current += small;
      continue;
    }
    const scale = SCALE_WORDS[token];
    if (scale !== undefined) {
      if (scale === 100) current = Math.max(current, 1) * 100;
      else {
        total += Math.max(current, 1) * scale;
        current = 0;
      }
      continue;
    }
    if (FILLER_WORDS.has(token)) continue;
    flush();
  }
  flush();

  return found;
}

function findRateCandidates(text: string): number[] {
  const found: number[] = [];

  // "41,000" / "41000" / "38 500"? keep to comma-grouped or 4-6 digit numbers
  for (const m of text.matchAll(/\b(\d{1,3}(?:,\d{2,3})+|\d{4,6})\b/g)) {
    const raw = (m[1] ?? '').replace(/,/g, '');
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= MIN_PLAUSIBLE_RATE && n <= MAX_PLAUSIBLE_RATE) found.push(n);
  }

  // "41k" style shorthand
  for (const m of text.matchAll(/\b(\d{2,4})\s*k\b/g)) {
    const n = Number.parseInt(m[1] ?? '', 10) * 1000;
    if (!Number.isNaN(n) && n >= MIN_PLAUSIBLE_RATE && n <= MAX_PLAUSIBLE_RATE) found.push(n);
  }

  // Spoken replies arrive as words: "fifteen thousand", "twenty five thousand only".
  found.push(...findSpokenRateCandidates(text));

  return Array.from(new Set(found));
}

export function parseQuoteReply(raw: string, referenceRate?: number | null): ParsedQuote {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const conditions: string[] = [];

  if (text.length === 0) {
    return { rate: null, tollIncluded: true, availableOnDate: null, conditions, confidence: 0 };
  }

  // Look at the phrase around the keyword so "toll included" is not read as extra.
  const tollPhrase = lower.match(/\btoll[^,.;]*/)?.[0] ?? '';
  const tollExtra = tollPhrase.length > 0 && /(extra|not|separate|actual|add)/.test(tollPhrase);
  if (tollExtra) conditions.push('Toll extra');

  const taxPhrase = lower.match(/\b(?:gst|tax)[^,.;]*/)?.[0] ?? '';
  const taxExtra = taxPhrase.length > 0 && /(extra|not|separate|actual|add)/.test(taxPhrase);
  if (taxExtra) conditions.push('Taxes extra');
  if (/detention/.test(lower)) conditions.push('Detention charges extra');
  if (/\bloading\b|\bunloading\b/.test(lower) && /(extra|not|charge)/.test(lower)) conditions.push('Loading and unloading extra');

  let availableOnDate: boolean | null = null;
  if (/(not available|no vehicle|no lorry)/.test(lower)) availableOnDate = false;
  else if (/(available|ready|ready to load|vehicle ready)/.test(lower)) availableOnDate = true;

  const candidates = findRateCandidates(text);
  if (candidates.length === 0) {
    return { rate: null, tollIncluded: !tollExtra, availableOnDate, conditions, confidence: 0.1 };
  }

  // The first plausible number in a short reply is the rate; extra numbers are ambiguity.
  const rate = candidates[0] ?? null;
  let confidence = 0.62;
  if (candidates.length === 1) confidence += 0.15;
  if (/\b(rs|inr|rupees|₹)\b/.test(lower)) confidence += 0.1;
  if (conditions.length > 0) confidence += 0.05;
  if (/\b(maybe|call me|confirm|check|will send)\b/.test(lower)) confidence -= 0.2;
  if (candidates.length > 2) confidence -= 0.15;

  if (referenceRate && referenceRate > 0 && rate !== null) {
    const drift = Math.abs(rate - referenceRate) / referenceRate;
    if (drift <= RATE_CARD_TOLERANCE) confidence += 0.1;
    else confidence -= 0.25;
  }

  confidence = Math.min(0.98, Math.max(0.05, Math.round(confidence * 100) / 100));

  return { rate, tollIncluded: !tollExtra, availableOnDate, conditions, confidence };
}

/** Reason a quote should be held back from L1 until an agent checks it, or null. */
export function flagReason(rate: number | null, confidence: number, referenceRate: number | null): string | null {
  if (rate === null) return 'No rate could be parsed from the reply';
  if (referenceRate && referenceRate > 0) {
    const drift = Math.abs(rate - referenceRate) / referenceRate;
    if (drift > RATE_CARD_TOLERANCE) {
      const pct = Math.round(drift * 100);
      return `Rate is ${pct}% away from the rate card reference of Rs. ${referenceRate.toLocaleString('en-IN')}`;
    }
  }
  if (confidence < CONFIDENCE_THRESHOLD) return `Parse confidence ${confidence.toFixed(2)} is below ${CONFIDENCE_THRESHOLD}`;
  return null;
}
