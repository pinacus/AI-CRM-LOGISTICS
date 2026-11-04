import type { Quote, QuoteSummary } from '../../../shared/types';

/**
 * Quote normalisation and L1 suggestion.
 *
 * Quotes arrive with different terms, so a quote whose price excludes toll gets a
 * small allowance (2% of the quoted rate) to make it comparable with all-in quotes.
 * The allowance is stored on the quote so the agent can see exactly what was added.
 */
export const TOLL_ALLOWANCE_PCT = 0.02;
export const TOP_QUOTE_COUNT = 5;

export function withNormalisation(quote: Quote): Quote {
  const tollAllowance = quote.rate !== null && !quote.tollIncluded ? Math.round(quote.rate * TOLL_ALLOWANCE_PCT) : 0;
  return {
    ...quote,
    tollAllowance,
    normalisedRate: quote.rate === null ? 0 : quote.rate + tollAllowance,
  };
}

function round(n: number): number {
  return Math.round(n);
}

/**
 * A quote is usable for the L1 suggestion when it parsed to a number and is not
 * flagged, or has been verified by a sales agent after being flagged.
 */
export function isUsable(quote: Quote): boolean {
  return quote.rate !== null && (quote.flagReason === null || quote.verified);
}

export function summariseQuotes(requirementId: string, quotes: Quote[], marginPct: number | null): QuoteSummary {
  const usable = quotes.filter(isUsable).slice().sort((a, b) => a.normalisedRate - b.normalisedRate);
  const top = usable.slice(0, TOP_QUOTE_COUNT);

  if (top.length === 0) {
    return { requirementId, quotes, considered: 0, average: null, l1: null, l2: null, spread: null, customerPrice: null, marginPct };
  }

  const rates = top.map((q) => q.normalisedRate);
  const average = round(rates.reduce((sum, r) => sum + r, 0) / rates.length);
  const l1 = top[0] ?? null;
  const l2 = top[1] ?? null;
  const spread = (rates[rates.length - 1] ?? 0) - (rates[0] ?? 0);
  const customerPrice = l1 && marginPct !== null ? round(l1.normalisedRate * (1 + marginPct / 100)) : null;

  return { requirementId, quotes, considered: top.length, average, l1, l2, spread, customerPrice, marginPct };
}
