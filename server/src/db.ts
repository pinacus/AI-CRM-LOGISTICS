import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newStore, type Store } from './store';

/**
 * SQLite persistence for the MVP.
 *
 * Every business collection is stored as one JSON document per row. All reads
 * happen from the in-memory Store (the whole dataset is a few hundred rows),
 * and `persist` writes a full snapshot inside a single transaction after each
 * mutation, so the database always matches what the API serves. This keeps the
 * routing code free of SQL while making the data survive restarts.
 */

export type Db = DatabaseSync;

const COLLECTIONS = [
  'customers',
  'vendors',
  'rate_card',
  'requirements',
  'matches',
  'attempts',
  'quotes',
  'calls',
  'orders',
  'trips',
  'invoices',
] as const;

type Collection = (typeof COLLECTIONS)[number];

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  for (const table of COLLECTIONS) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    )`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
  `);
}

function rowsOf(db: Db, table: Collection): Record<string, unknown>[] {
  const rows = db.prepare(`SELECT data FROM ${table}`).all() as { data: string }[];
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.data) as Record<string, unknown>);
    } catch {
      // a corrupt row should not stop the process from booting
    }
  }
  return out;
}

export function isSeeded(db: Db): boolean {
  const row = db.prepare(`SELECT 1 AS ok FROM kv WHERE key = 'seeded'`).get() as { ok?: number } | undefined;
  return row?.ok === 1;
}

/** Loads a previously persisted snapshot, or null when the database is fresh. */
export function hydrate(db: Db): Store | null {
  if (!isSeeded(db)) return null;
  const store = newStore();

  store.customers = rowsOf(db, 'customers') as unknown as Store['customers'];
  store.vendors = rowsOf(db, 'vendors') as unknown as Store['vendors'];
  store.rateCard = rowsOf(db, 'rate_card') as unknown as Store['rateCard'];
  store.requirements = rowsOf(db, 'requirements') as unknown as Store['requirements'];
  store.attempts = rowsOf(db, 'attempts') as unknown as Store['attempts'];
  store.quotes = rowsOf(db, 'quotes') as unknown as Store['quotes'];
  store.calls = rowsOf(db, 'calls') as unknown as Store['calls'];
  store.orders = rowsOf(db, 'orders') as unknown as Store['orders'];
  store.trips = rowsOf(db, 'trips') as unknown as Store['trips'];
  store.invoices = rowsOf(db, 'invoices') as unknown as Store['invoices'];

  const matchRows = rowsOf(db, 'matches');
  store.matches = {};
  for (const row of matchRows) {
    const key = String(row.requirementId ?? '');
    if (key) store.matches[key] = row as unknown as Store['matches'][string];
  }

  const counters = db.prepare(`SELECT value FROM kv WHERE key = 'counters'`).get() as { value?: string } | undefined;
  if (counters?.value) {
    try {
      Object.assign(store.counters, JSON.parse(counters.value));
    } catch {
      // keep default counters when the stored ones are unreadable
    }
  }
  return store;
}

function writeCollection(db: Db, table: Collection, rows: unknown[]): void {
  db.prepare(`DELETE FROM ${table}`).run();
  const stmt = db.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?)`);
  let fallback = 0;
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const id = String(record.id ?? record.requirementId ?? `row-${(fallback += 1)}`);
    stmt.run(id, JSON.stringify(row));
  }
}

/** Writes a full snapshot of the working store. Safe to call after any mutation. */
export function persist(db: Db, store: Store): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    writeCollection(db, 'customers', store.customers);
    writeCollection(db, 'vendors', store.vendors);
    writeCollection(db, 'rate_card', store.rateCard);
    writeCollection(db, 'requirements', store.requirements);
    writeCollection(db, 'attempts', store.attempts);
    writeCollection(db, 'quotes', store.quotes);
    writeCollection(db, 'calls', store.calls);
    writeCollection(db, 'orders', store.orders);
    writeCollection(db, 'trips', store.trips);
    writeCollection(db, 'invoices', store.invoices);

    db.prepare(`DELETE FROM matches`).run();
    const matchStmt = db.prepare(`INSERT INTO matches (id, data) VALUES (?, ?)`);
    for (const [reqId, match] of Object.entries(store.matches)) {
      matchStmt.run(reqId, JSON.stringify(match));
    }

    db.prepare(`INSERT INTO kv (key, value) VALUES ('counters', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(store.counters));
    db.prepare(`INSERT INTO kv (key, value) VALUES ('seeded', '1')
                ON CONFLICT(key) DO UPDATE SET value = '1'`).run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface TableCounts {
  [table: string]: number;
}

export function tableCounts(db: Db): TableCounts {
  const counts: TableCounts = {};
  for (const table of [...COLLECTIONS, 'users', 'sessions', 'audit_log']) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    counts[table] = row.n;
  }
  return counts;
}
