import assert from 'node:assert/strict';
import test from 'node:test';
import type { Requirement, Vendor } from '../../../shared/types';
import { hardFilter, matchVendors, scoreVendor } from './matching';

function req(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'REQ-T1',
    customerName: 'Test Customer',
    origin: 'Ambattur',
    destination: 'Bengaluru',
    cargo: 'General',
    weightT: 9,
    vehicleType: 'open_truck',
    bodySizeFt: 32,
    axle: 'multi',
    loadingDate: '2026-10-04',
    loadingTime: '08:00',
    notes: '',
    status: 'intake',
    createdAt: new Date().toISOString(),
    rateCardRate: null,
    rateCardMatch: 'none',
    rateCardNote: '',
    marginPct: null,
    l1QuoteId: null,
    ...overrides,
  };
}

function vendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: 1,
    name: 'Test Carriers',
    phone: '+91 98400 00001',
    whatsapp: '+91 98400 00001',
    origins: ['Ambattur'],
    corridors: ['Bengaluru'],
    vehicleTypes: ['open_truck'],
    bodySizes: [32],
    axles: ['multi'],
    maxCapacityT: 16,
    cargoTypes: ['General'],
    fleetSize: 12,
    availableVehicles: 4,
    rating: 4.5,
    onTimePct: 92,
    avgRateVsMarketPct: -2,
    avgResponseMins: 6,
    preferredChannel: 'voice',
    paymentTermsDays: 30,
    kycDone: true,
    active: true,
    ...overrides,
  };
}

test('hard filters pass a capable vendor', () => {
  assert.deepEqual(hardFilter(vendor(), req()), []);
});

test('hard filters reject corridor, capacity, axle, cargo and KYC problems', () => {
  assert.ok(hardFilter(vendor({ corridors: ['Hyderabad'] }), req()).length > 0, 'corridor');
  assert.ok(hardFilter(vendor({ maxCapacityT: 7 }), req()).length > 0, 'capacity');
  assert.ok(hardFilter(vendor({ axles: ['single'] }), req()).length > 0, 'axle');
  assert.ok(hardFilter(vendor({ cargoTypes: ['Pharma'] }), req()).length > 0, 'cargo');
  assert.ok(hardFilter(vendor({ kycDone: false }), req()).length > 0, 'kyc');
  assert.ok(hardFilter(vendor({ bodySizes: [22] }), req()).length > 0, 'body size');
  assert.ok(hardFilter(vendor({ origins: ['Coimbatore'] }), req()).length > 0, 'origin');
});

test('scores stay inside 0 to 100 and stronger vendors score higher', () => {
  const strong = scoreVendor(vendor()).score;
  const weak = scoreVendor(
    vendor({ availableVehicles: 0, rating: 3.2, onTimePct: 76, avgRateVsMarketPct: 7, avgResponseMins: 45 }),
  ).score;
  assert.ok(strong >= 0 && strong <= 100, `strong ${strong}`);
  assert.ok(weak >= 0 && weak <= 100, `weak ${weak}`);
  assert.ok(strong > weak, `${strong} should beat ${weak}`);
});

test('matchVendors shortlists passing vendors by score and explains exclusions', () => {
  const vendors: Vendor[] = [
    vendor({ id: 1, name: 'Slow mover', availableVehicles: 1, rating: 3.5, onTimePct: 80, avgRateVsMarketPct: 5, avgResponseMins: 40 }),
    vendor({ id: 2, name: 'Fast mover', availableVehicles: 6, rating: 4.9, onTimePct: 97, avgRateVsMarketPct: -6, avgResponseMins: 2 }),
    vendor({ id: 3, name: 'Wrong lane', corridors: ['Kochi'] }),
  ];

  const result = matchVendors(req(), vendors, 8);

  assert.equal(result.matched.length, 2);
  assert.equal(result.matched[0]?.vendor.id, 2, 'best score first');
  assert.equal(result.matched[0]?.rank, 1);
  assert.equal(result.matched[1]?.rank, 2);
  const excluded = result.excluded.find((e) => e.vendor.id === 3);
  assert.ok(excluded, 'wrong lane vendor is excluded');
  assert.ok(excluded && excluded.reasons.length > 0);
});

test('vendors outside the shortlist limit are reported as outside the top N', () => {
  const vendors: Vendor[] = [];
  for (let i = 1; i <= 12; i++) {
    vendors.push(vendor({ id: i, name: `Vendor ${i}`, rating: 3.5 + i * 0.1, onTimePct: 80 + i }));
  }
  const result = matchVendors(req(), vendors, 5);
  assert.equal(result.matched.length, 5);
  assert.equal(result.excluded.length, 7);
  assert.ok(result.excluded.every((e) => e.reasons[0]?.includes('outside the top 5')));
});
