import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { hydrate, isSeeded, openDatabase, persist, tableCounts } from './db';
import { newStore, type Store } from './store';
import type { Quote, Requirement, Vendor } from '../../shared/types';

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freightdesk-db-'));
  return path.join(dir, 'test.db');
}

function sampleStore(): Store {
  const store = newStore();
  const requirement: Requirement = {
    id: 'REQ-2001',
    customerName: 'Test Customer',
    origin: 'Ambattur',
    destination: 'Bengaluru',
    cargo: 'General',
    weightT: 9,
    vehicleType: 'open_truck',
    bodySizeFt: 32,
    axle: 'multi',
    loadingDate: '2026-10-10',
    loadingTime: '08:00',
    notes: 'n',
    status: 'quoted',
    createdAt: '2026-10-06T08:00:00.000Z',
    rateCardRate: 39000,
    rateCardMatch: 'exact',
    rateCardNote: 'exact',
    marginPct: 8,
    l1QuoteId: 'Q-1',
  };
  const vendor = { id: 1, name: 'V', active: true, kycDone: true } as Vendor;
  const quote: Quote = {
    id: 'Q-1',
    requirementId: 'REQ-2001',
    vendorId: 1,
    vendorName: 'V',
    rate: 37800,
    tollIncluded: true,
    availableOnDate: true,
    conditions: [],
    channel: 'voice',
    rawText: '37800',
    confidence: 0.95,
    receivedAt: '2026-10-06T08:10:00.000Z',
    flagReason: null,
    verified: true,
    tollAllowance: 0,
    normalisedRate: 37800,
  };
  store.requirements.push(requirement);
  store.quotes.push(quote);
  store.vendors.push(vendor);
  store.matches['REQ-2001'] = {
    requirementId: 'REQ-2001',
    matched: [{ vendor, rank: 1, score: 80, factors: [] }],
    excluded: [],
    limit: 8,
  };
  store.counters.requirement = 2001;
  return store;
}

test('fresh database has no snapshot to hydrate', () => {
  const db = openDatabase(tempDbPath());
  assert.equal(isSeeded(db), false);
  assert.equal(hydrate(db), null);
  db.close();
});

test('persist then hydrate round-trips the whole store', () => {
  const db = openDatabase(tempDbPath());
  const store = sampleStore();
  persist(db, store);

  assert.equal(isSeeded(db), true);
  const loaded = hydrate(db);
  assert.ok(loaded);
  assert.deepEqual(loaded.requirements, store.requirements);
  assert.deepEqual(loaded.quotes, store.quotes);
  assert.deepEqual(loaded.vendors, store.vendors);
  assert.deepEqual(loaded.matches, store.matches);
  assert.equal(loaded.counters.requirement, 2001);
  db.close();
});

test('a second persist overwrites the previous snapshot', () => {
  const db = openDatabase(tempDbPath());
  const store = sampleStore();
  persist(db, store);

  store.requirements[0]!.status = 'closed';
  store.quotes = [];
  persist(db, store);

  const loaded = hydrate(db);
  assert.ok(loaded);
  assert.equal(loaded.requirements[0]?.status, 'closed');
  assert.equal(loaded.quotes.length, 0);
  db.close();
});

test('counts cover every business table', () => {
  const db = openDatabase(tempDbPath());
  persist(db, sampleStore());
  const counts = tableCounts(db);
  assert.equal(counts.requirements, 1);
  assert.equal(counts.quotes, 1);
  assert.equal(counts.matches, 1);
  assert.equal(counts.users, 0);
  db.close();
});
