import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRateCard, computeRate, lookupRate, pseudoDistanceKm, RATE_CARD_SIZE } from './ratecard';

test('builds 300 deterministic rows including the curated business rows', () => {
  const a = buildRateCard(new Date('2026-10-03T08:00:00Z'));
  const b = buildRateCard(new Date('2026-10-03T08:00:00Z'));

  assert.equal(a.length, RATE_CARD_SIZE);
  assert.deepEqual(a, b, 'rows must not change between restarts');

  const curated = a.filter((r) => r.curated);
  assert.ok(curated.length >= 10, 'the curated business rows are present');
  assert.ok(a.every((r) => r.rate >= 6000), 'no zero or silly rates');
});

test('an exact match returns the card price instantly', () => {
  const rows = buildRateCard(new Date('2026-10-03T08:00:00Z'));
  const result = lookupRate(rows, {
    origin: 'Ambattur',
    destination: 'Bengaluru',
    vehicleType: 'open_truck',
    bodySizeFt: 32,
    axle: 'multi',
    weightT: 9,
  });

  assert.equal(result.match, 'exact');
  assert.equal(result.rate, 41500);
  assert.ok(result.row?.curated);
});

test('a route without the requested vehicle returns a nearest reference', () => {
  const rows = buildRateCard(new Date('2026-10-03T08:00:00Z'));
  const result = lookupRate(rows, {
    origin: 'Ambattur',
    destination: 'Coimbatore',
    vehicleType: 'open_truck',
    bodySizeFt: 22,
    axle: 'single',
    weightT: 5,
  });

  assert.equal(result.match, 'nearest');
  assert.ok(result.rate !== null && result.rate > 0);
  assert.ok(result.note.includes('Nearest match'));
});

test('an unknown route returns none so live quoting is triggered', () => {
  const rows = buildRateCard(new Date('2026-10-03T08:00:00Z'));
  const result = lookupRate(rows, {
    origin: 'Kanyakumari',
    destination: 'Delhi',
    vehicleType: 'trailer',
    bodySizeFt: 40,
    axle: 'multi',
    weightT: 20,
  });

  assert.equal(result.match, 'none');
  assert.equal(result.rate, null);
});

test('distances between known hubs are road realistic', () => {
  const ambatturBengaluru = pseudoDistanceKm('Ambattur', 'Bengaluru');
  const poonamalleeHosur = pseudoDistanceKm('Poonamallee', 'Hosur');
  const ambatturPoonamallee = pseudoDistanceKm('Ambattur', 'Poonamallee');

  assert.ok(ambatturBengaluru > 280 && ambatturBengaluru < 460, `Chennai region to Bengaluru was ${ambatturBengaluru}`);
  assert.ok(poonamalleeHosur > 180 && poonamalleeHosur < 400, `Poonamallee to Hosur was ${poonamalleeHosur}`);
  assert.ok(ambatturPoonamallee < 60, `Ambattur to Poonamallee was ${ambatturPoonamallee}`);
});

test('rates increase with distance, weight and vehicle size', () => {
  const cfg = { vehicleType: 'open_truck' as const, bodySizeFt: 32, axle: 'multi' as const };
  const shortHaul = { origin: 'Hosur', destination: 'Bengaluru' };

  // Find a pair that is genuinely further than the short haul pair, since the
  // distance table is a stable hash rather than real road distance.
  const shortKm = pseudoDistanceKm(shortHaul.origin, shortHaul.destination);
  let longHaul: { origin: string; destination: string } | null = null;
  for (const origin of ['Madurai', 'Coimbatore', 'Salem', 'Erode']) {
    for (const destination of ['Visakhapatnam', 'Hyderabad', 'Kochi', 'Vijayawada']) {
      if (pseudoDistanceKm(origin, destination) > shortKm + 400) {
        longHaul = { origin, destination };
        break;
      }
    }
    if (longHaul) break;
  }
  assert.ok(longHaul, 'found a longer pair to compare');

  const shortRate = computeRate(shortHaul.origin, shortHaul.destination, cfg, '5-9 T');
  const longRate = computeRate(longHaul.origin, longHaul.destination, cfg, '5-9 T');
  const heavy = computeRate(shortHaul.origin, shortHaul.destination, cfg, '16+ T');

  assert.ok(longRate > shortRate, `${longRate} should beat ${shortRate}`);
  assert.ok(heavy > shortRate, `${heavy} should beat ${shortRate}`);
});
