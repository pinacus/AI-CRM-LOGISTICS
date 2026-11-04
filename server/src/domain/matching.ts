import type { MatchFactor, MatchResult, Requirement, Vendor, VendorMatch } from '../../../shared/types';

/**
 * Vendor matching works in two passes, as described in the POC:
 * 1. hard filters remove vendors who cannot do the job at all,
 * 2. a weighted score ranks the survivors.
 *
 * Weights are the suggested ones from the POC and are tunable here.
 */
export const SCORE_WEIGHTS = {
  availability: 0.3,
  reliability: 0.3,
  price: 0.25,
  response: 0.15,
} as const;

export const DEFAULT_SHORTLIST_LIMIT = 8;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Returns the reasons a vendor cannot do this job; empty array means the vendor passes. */
export function hardFilter(vendor: Vendor, req: Requirement): string[] {
  const reasons: string[] = [];

  if (!vendor.active) reasons.push('Inactive in CRM');
  if (!vendor.kycDone) reasons.push('KYC not complete');
  if (!vendor.origins.includes(req.origin)) reasons.push(`Does not operate from ${req.origin}`);
  if (!vendor.corridors.includes(req.destination)) reasons.push(`Does not operate on the ${req.destination} corridor`);
  if (!vendor.vehicleTypes.includes(req.vehicleType)) reasons.push('Vehicle type not handled');
  if (!vendor.bodySizes.includes(req.bodySizeFt)) reasons.push(`No ${req.bodySizeFt} ft body`);
  if (!vendor.axles.includes(req.axle)) reasons.push(`${req.axle === 'multi' ? 'Multi' : 'Single'} axle not available`);
  if (vendor.maxCapacityT < req.weightT) reasons.push(`Max capacity ${vendor.maxCapacityT} T is below ${req.weightT} T`);
  if (!vendor.cargoTypes.includes(req.cargo)) reasons.push(`${req.cargo} cargo not handled`);

  return reasons;
}

/** Availability of vehicles on the loading date, 0 to 1. */
export function availabilityScore(vendor: Vendor): number {
  return clamp01(vendor.availableVehicles / 4);
}

/** Reliability: past rating combined with on-time delivery rate. */
export function reliabilityScore(vendor: Vendor): number {
  return clamp01(0.5 * (vendor.rating / 5) + 0.5 * (vendor.onTimePct / 100));
}

/** Price competitiveness: cheaper than market scores higher. */
export function priceScore(vendor: Vendor): number {
  const pct = Math.min(10, Math.max(-10, vendor.avgRateVsMarketPct));
  return clamp01((10 - pct) / 20);
}

/** Response speed on earlier quote requests, capped at 60 minutes. */
export function responseScore(vendor: Vendor): number {
  return clamp01(1 - Math.min(60, Math.max(0, vendor.avgResponseMins)) / 60);
}

export function scoreVendor(vendor: Vendor): { score: number; factors: MatchFactor[] } {
  const factors: MatchFactor[] = [
    { label: `Availability (${vendor.availableVehicles} vehicles free)`, weightPct: 30, score: round1(availabilityScore(vendor) * 100) },
    { label: `Reliability (${vendor.rating.toFixed(1)}/5, ${vendor.onTimePct}% on time)`, weightPct: 30, score: round1(reliabilityScore(vendor) * 100) },
    { label: `Price vs market (${vendor.avgRateVsMarketPct > 0 ? '+' : ''}${vendor.avgRateVsMarketPct}%)`, weightPct: 25, score: round1(priceScore(vendor) * 100) },
    { label: `Response speed (${vendor.avgResponseMins} min avg)`, weightPct: 15, score: round1(responseScore(vendor) * 100) },
  ];
  const score =
    SCORE_WEIGHTS.availability * availabilityScore(vendor) +
    SCORE_WEIGHTS.reliability * reliabilityScore(vendor) +
    SCORE_WEIGHTS.price * priceScore(vendor) +
    SCORE_WEIGHTS.response * responseScore(vendor);
  return { score: round1(score * 100), factors };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function matchVendors(req: Requirement, vendors: Vendor[], limit = DEFAULT_SHORTLIST_LIMIT): MatchResult {
  const matched: VendorMatch[] = [];
  const excluded: { vendor: Vendor; reasons: string[] }[] = [];

  for (const vendor of vendors) {
    const reasons = hardFilter(vendor, req);
    if (reasons.length > 0) {
      excluded.push({ vendor, reasons });
      continue;
    }
    const { score, factors } = scoreVendor(vendor);
    matched.push({ vendor, rank: null, score, factors });
  }

  matched.sort((a, b) => b.score - a.score || a.vendor.id - b.vendor.id);
  const shortlist = matched.slice(0, limit);
  shortlist.forEach((m, i) => {
    m.rank = i + 1;
  });

  // Vendors who pass every filter but do not make the shortlist are still shown,
  // with the reason, so the agent can widen the list if quotes are thin.
  for (const m of matched.slice(limit)) {
    excluded.push({ vendor: m.vendor, reasons: [`Passed every filter but is outside the top ${limit}`] });
  }

  return { requirementId: req.id, matched: shortlist, excluded, limit };
}
