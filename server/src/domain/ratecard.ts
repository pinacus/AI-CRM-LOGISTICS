import type { Axle, RateCardRow, RateLookupInput, RateLookupResult, VehicleType, WeightBand } from '../../../shared/types';
import { WEIGHT_BANDS, weightBandFor } from '../../../shared/types';

export const RATE_CARD_SIZE = 300;

export const ORIGINS = [
  'Ambattur', 'Sriperumbudur', 'Oragadam', 'Poonamallee', 'Gummidipoondi',
  'Ranipet', 'Vellore', 'Hosur', 'Coimbatore', 'Tiruppur',
  'Salem', 'Karur', 'Erode', 'Madurai', 'Tiruchirappalli',
] as const;

export const DESTINATIONS = [
  'Bengaluru', 'Hyderabad', 'Chennai', 'Coimbatore', 'Madurai', 'Tiruppur',
  'Salem', 'Kochi', 'Vijayawada', 'Visakhapatnam', 'Mysuru', 'Tiruchirappalli', 'Hosur',
] as const;

interface VehicleConfig {
  vehicleType: VehicleType;
  bodySizeFt: number;
  axle: Axle;
}

const VEHICLE_CONFIGS: VehicleConfig[] = [
  { vehicleType: 'open_truck', bodySizeFt: 14, axle: 'single' },
  { vehicleType: 'open_truck', bodySizeFt: 32, axle: 'multi' },
  { vehicleType: 'container', bodySizeFt: 22, axle: 'single' },
  { vehicleType: 'container', bodySizeFt: 32, axle: 'multi' },
  { vehicleType: 'trailer', bodySizeFt: 40, axle: 'multi' },
  { vehicleType: 'open_truck', bodySizeFt: 19, axle: 'single' },
];

const BAND_MID_T: Record<WeightBand, number> = {
  '0-3 T': 1.5,
  '3-5 T': 4,
  '5-9 T': 7,
  '9-16 T': 12,
  '16+ T': 20,
};

const VEHICLE_FACTOR: Record<VehicleType, number> = { open_truck: 0, container: 1400, trailer: 2600 };

/** Stable 32 bit hash so rows and rates are identical on every restart. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Approximate coordinates for every hub, so distances and rates look like the real road network. */
const HUB_COORDS: Record<string, { lat: number; lon: number }> = {
  Ambattur: { lat: 13.07, lon: 80.16 },
  Sriperumbudur: { lat: 12.97, lon: 79.95 },
  Oragadam: { lat: 12.93, lon: 79.93 },
  Poonamallee: { lat: 13.05, lon: 79.87 },
  Gummidipoondi: { lat: 13.21, lon: 79.98 },
  Ranipet: { lat: 12.93, lon: 79.33 },
  Vellore: { lat: 12.92, lon: 79.13 },
  Hosur: { lat: 12.74, lon: 77.83 },
  Coimbatore: { lat: 11.02, lon: 76.96 },
  Tiruppur: { lat: 11.11, lon: 77.34 },
  Salem: { lat: 11.66, lon: 78.15 },
  Karur: { lat: 10.96, lon: 78.08 },
  Erode: { lat: 11.34, lon: 77.72 },
  Madurai: { lat: 9.93, lon: 78.12 },
  Tiruchirappalli: { lat: 10.79, lon: 78.7 },
  Bengaluru: { lat: 12.97, lon: 77.59 },
  Hyderabad: { lat: 17.39, lon: 78.49 },
  Chennai: { lat: 13.08, lon: 80.27 },
  Kochi: { lat: 9.93, lon: 76.27 },
  Vijayawada: { lat: 16.51, lon: 80.65 },
  Visakhapatnam: { lat: 17.69, lon: 83.22 },
  Mysuru: { lat: 12.3, lon: 76.64 },
};

/** Road distance estimate: straight line between hubs with a road factor. */
export function pseudoDistanceKm(origin: string, destination: string): number {
  if (origin === destination) return 0;
  const from = HUB_COORDS[origin];
  const to = HUB_COORDS[destination];
  if (from && to) {
    const toRad = (d: number): number => (d * Math.PI) / 180;
    const dLat = toRad(to.lat - from.lat);
    const dLon = toRad(to.lon - from.lon);
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLon / 2) ** 2;
    const straightKm = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
    return Math.max(35, Math.round(straightKm * 1.25));
  }
  // Unknown hub: stable fallback so rows still differ between routes.
  return 90 + (hash(`${origin}>${destination}`) % 950);
}

export function computeRate(origin: string, destination: string, cfg: VehicleConfig, band: WeightBand): number {
  const km = pseudoDistanceKm(origin, destination);
  const raw =
    km * 26 +
    BAND_MID_T[band] * 1700 +
    cfg.bodySizeFt * 170 +
    VEHICLE_FACTOR[cfg.vehicleType] +
    (cfg.axle === 'multi' ? 850 : 0);
  const floored = Math.max(6000, raw);
  return Math.round(floored / 50) * 50;
}

/** Rows supplied by the business team for the routes they quote every day. */
const CURATED: Array<Omit<RateCardRow, 'id' | 'validFrom' | 'validTo' | 'curated'>> = [
  { origin: 'Ambattur', destination: 'Bengaluru', vehicleType: 'open_truck', bodySizeFt: 32, axle: 'multi', weightBand: '9-16 T', rate: 41500 },
  { origin: 'Ambattur', destination: 'Hosur', vehicleType: 'open_truck', bodySizeFt: 22, axle: 'single', weightBand: '5-9 T', rate: 12800 },
  { origin: 'Ambattur', destination: 'Coimbatore', vehicleType: 'open_truck', bodySizeFt: 14, axle: 'single', weightBand: '3-5 T', rate: 18600 },
  { origin: 'Sriperumbudur', destination: 'Bengaluru', vehicleType: 'trailer', bodySizeFt: 40, axle: 'multi', weightBand: '16+ T', rate: 68000 },
  { origin: 'Sriperumbudur', destination: 'Hosur', vehicleType: 'container', bodySizeFt: 22, axle: 'single', weightBand: '5-9 T', rate: 13500 },
  { origin: 'Oragadam', destination: 'Bengaluru', vehicleType: 'container', bodySizeFt: 32, axle: 'multi', weightBand: '9-16 T', rate: 44000 },
  { origin: 'Gummidipoondi', destination: 'Vijayawada', vehicleType: 'open_truck', bodySizeFt: 32, axle: 'multi', weightBand: '9-16 T', rate: 39000 },
  { origin: 'Coimbatore', destination: 'Chennai', vehicleType: 'open_truck', bodySizeFt: 32, axle: 'multi', weightBand: '9-16 T', rate: 37500 },
  { origin: 'Tiruppur', destination: 'Bengaluru', vehicleType: 'container', bodySizeFt: 22, axle: 'single', weightBand: '5-9 T', rate: 17800 },
  { origin: 'Madurai', destination: 'Chennai', vehicleType: 'open_truck', bodySizeFt: 32, axle: 'multi', weightBand: '9-16 T', rate: 42000 },
];

function rowKey(r: { origin: string; destination: string; vehicleType: string; bodySizeFt: number; axle: string; weightBand: string }): string {
  return [r.origin, r.destination, r.vehicleType, r.bodySizeFt, r.axle, r.weightBand].join('|');
}

/**
 * Builds the rate card: the curated rows first, then a deterministic sample that
 * puts about two rows on every origin and destination pair, giving 300 rows total.
 */
export function buildRateCard(now = new Date()): RateCardRow[] {
  const validFrom = new Date(now.getTime() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const validTo = new Date(now.getTime() + 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const rows: RateCardRow[] = [];
  const seen = new Set<string>();
  let seq = 1;

  const push = (base: Omit<RateCardRow, 'id' | 'validFrom' | 'validTo' | 'curated'>, curated: boolean): void => {
    const key = rowKey(base);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ ...base, id: `RC-${String(seq++).padStart(4, '0')}`, validFrom, validTo, curated });
  };

  for (const c of CURATED) push(c, true);

  // First pass: one row for every origin and destination pair, so every hub is
  // covered before any route gets a second vehicle and weight combination.
  // Second pass: fill up to RATE_CARD_SIZE with a second row per route.
  for (let pick = 0; pick < 2 && rows.length < RATE_CARD_SIZE; pick++) {
    for (const origin of ORIGINS) {
      for (const destination of DESTINATIONS) {
        if (rows.length >= RATE_CARD_SIZE) break;
        if (origin === destination) continue;
        const h = hash(`${origin}|${destination}|${pick}`);
        const cfg = VEHICLE_CONFIGS[h % VEHICLE_CONFIGS.length] ?? VEHICLE_CONFIGS[0];
        const band = WEIGHT_BANDS[Math.floor(h / 7) % WEIGHT_BANDS.length];
        if (!cfg || !band) continue;
        push(
          {
            origin,
            destination,
            vehicleType: cfg.vehicleType,
            bodySizeFt: cfg.bodySizeFt,
            axle: cfg.axle,
            weightBand: band,
            rate: computeRate(origin, destination, cfg, band),
          },
          false,
        );
      }
      if (rows.length >= RATE_CARD_SIZE) break;
    }
  }

  return rows;
}

/**
 * Exact match returns the card price instantly. When the route exists but the
 * vehicle or weight band differs, the nearest row is returned as a reference and
 * live vendor quoting should still be triggered.
 */
export function lookupRate(rows: RateCardRow[], input: RateLookupInput): RateLookupResult {
  const band = weightBandFor(input.weightT);
  const onRoute = rows.filter((r) => r.origin === input.origin && r.destination === input.destination);
  if (onRoute.length === 0) {
    return { match: 'none', rate: null, row: null, note: `No rate card entry for ${input.origin} to ${input.destination}` };
  }

  const exact =
    onRoute.find(
      (r) =>
        r.vehicleType === input.vehicleType &&
        r.bodySizeFt === input.bodySizeFt &&
        r.axle === input.axle &&
        r.weightBand === band,
    ) ?? null;

  if (exact) {
    return { match: 'exact', rate: exact.rate, row: exact, note: 'Exact rate card match, quote available instantly' };
  }

  const nearest =
    onRoute.find((r) => r.vehicleType === input.vehicleType && r.weightBand === band) ??
    onRoute.find((r) => r.weightBand === band) ??
    onRoute[0] ??
    null;

  return {
    match: 'nearest',
    rate: nearest ? nearest.rate : null,
    row: nearest,
    note: nearest
      ? `Nearest match: ${nearest.vehicleType}, ${nearest.bodySizeFt} ft, ${nearest.axle} axle, ${nearest.weightBand}. Live vendor quotes still needed.`
      : 'No comparable row',
  };
}
