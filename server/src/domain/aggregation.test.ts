import assert from 'node:assert/strict';
import test from 'node:test';
import type { Quote } from '../../../shared/types';
import { isUsable, summariseQuotes, withNormalisation } from './aggregation';

let seq = 0;

function quote(rate: number | null, overrides: Partial<Quote> = {}): Quote {
  seq += 1;
  return {
    id: `Q-${seq}`,
    requirementId: 'REQ-T1',
    vendorId: seq,
    vendorName: `Vendor ${seq}`,
    rate,
    tollIncluded: true,
    availableOnDate: true,
    conditions: [],
    channel: 'voice',
    rawText: `${rate}`,
    confidence: 0.9,
    receivedAt: new Date().toISOString(),
    flagReason: null,
    verified: false,
    tollAllowance: 0,
    normalisedRate: rate ?? 0,
    ...overrides,
  };
}

test('matches the worked example from the POC document', () => {
  const quotes = [quote(42000), quote(38500), quote(37800), quote(41000), quote(39500)];
  const summary = summariseQuotes('REQ-T1', quotes, 8);

  assert.equal(summary.considered, 5);
  assert.equal(summary.l1?.rate, 37800);
  assert.equal(summary.average, 39760);
  assert.equal(summary.spread, 4200);
  assert.equal(summary.customerPrice, 40824, 'L1 plus 8 percent margin');
});

test('only the lowest five quotes are considered', () => {
  const quotes = [quote(30000), quote(31000), quote(32000), quote(33000), quote(34000), quote(50000)];
  const summary = summariseQuotes('REQ-T1', quotes, null);
  assert.equal(summary.considered, 5);
  assert.equal(summary.average, 32000);
  assert.equal(summary.l2?.rate, 31000);
});

test('flagged quotes are excluded until an agent verifies them', () => {
  const bad = quote(10000, { flagReason: 'Rate is far from the rate card reference' });
  const good = quote(40000);
  const summary = summariseQuotes('REQ-T1', [bad, good], null);
  assert.equal(summary.considered, 1);
  assert.equal(summary.l1?.id, good.id);
  assert.equal(isUsable(bad), false);

  bad.verified = true;
  assert.equal(isUsable(bad), true);
  const after = summariseQuotes('REQ-T1', [bad, good], null);
  assert.equal(after.considered, 2);
  assert.equal(after.l1?.id, bad.id);
});

test('a quote without a parsed rate never reaches L1', () => {
  const summary = summariseQuotes('REQ-T1', [quote(null), quote(40000)], null);
  assert.equal(summary.considered, 1);
  assert.equal(summary.l1?.rate, 40000);
});

test('toll exclusive quotes get a visible allowance so quotes compare fairly', () => {
  const withToll = withNormalisation(quote(39000, { tollIncluded: true }));
  const withoutToll = withNormalisation(quote(39000, { tollIncluded: false }));

  assert.equal(withToll.tollAllowance, 0);
  assert.equal(withToll.normalisedRate, 39000);
  assert.equal(withoutToll.tollAllowance, 780);
  assert.equal(withoutToll.normalisedRate, 39780);
});

test('no usable quotes returns nulls rather than a made up price', () => {
  const summary = summariseQuotes('REQ-T1', [], 8);
  assert.equal(summary.l1, null);
  assert.equal(summary.average, null);
  assert.equal(summary.customerPrice, null);
});
