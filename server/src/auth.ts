import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db';
import { config } from './config';

export type Role = 'admin' | 'sales' | 'ops' | 'finance';

export const ROLES: Role[] = ['admin', 'sales', 'ops', 'finance'];

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionToken?: string;
    }
  }
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
export const SESSION_COOKIE = 'fd_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64');
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('base64');
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, expected] = parts;
  if (!salt || !expected) return false;
  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, 64, { N: Number(n), r: Number(r), p: Number(p) });
  } catch {
    return false;
  }
  const expectedBuf = Buffer.from(expected, 'base64');
  if (expectedBuf.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuf);
}

function tokenHash(token: string): string {
  return scryptSync(token, 'freightdesk-session', 32).toString('hex');
}

export function createSession(db: Db, userId: number, ip?: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = new Date(now + config.sessionTtlDays * 86400000).toISOString();
  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)`).run(
    tokenHash(token),
    userId,
    new Date(now).toISOString(),
    expiresAt,
    ip ?? null,
  );
  return { token, expiresAt };
}

export function getSessionUser(db: Db, token: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash(token)) as
    | { id: number; name: string; email: string; role: string; active: number; expires_at: string }
    | undefined;
  if (!row) return null;
  if (row.active !== 1) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash(token));
    return null;
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role as Role };
}

export function revokeSession(db: Db, token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash(token));
}

export function revokeAllSessions(db: Db, userId: number): void {
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}

/** Drops expired sessions; called opportunistically on login. */
export function pruneSessions(db: Db): void {
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
}

/* ---------------------------------------------------------- seed accounts */

const SEED_USERS: { name: string; email: string; password: string; role: Role }[] = [
  { name: 'Asha Menon', email: 'admin@freightdesk.local', password: 'admin123', role: 'admin' },
  { name: 'Ravi Kumar', email: 'sales@freightdesk.local', password: 'sales123', role: 'sales' },
  { name: 'Deepa Singh', email: 'ops@freightdesk.local', password: 'ops123', role: 'ops' },
  { name: 'Joseph Mathew', email: 'finance@freightdesk.local', password: 'finance123', role: 'finance' },
];

/** Creates the default accounts once, on the first boot against an empty database. */
export function ensureSeedUsers(db: Db): void {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  if (row.n > 0) return;
  for (const user of SEED_USERS) {
    db.prepare(
      `INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(user.name, user.email, hashPassword(user.password), user.role, new Date().toISOString());
  }
}

/* ------------------------------------------------------------ login limits */

const MAX_FAILURES = 8;
const LOCK_MS = 5 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

export function loginLocked(key: string): number {
  const entry = failures.get(key);
  if (!entry) return 0;
  if (entry.until < Date.now()) {
    failures.delete(key);
    return 0;
  }
  return entry.until - Date.now();
}

export function loginFailure(key: string): void {
  const entry = failures.get(key) ?? { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.until = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  failures.set(key, entry);
}

export function loginSuccess(key: string): void {
  failures.delete(key);
}

/* ---------------------------------------------------------------- cookies */

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function sessionCookie(token: string): string {
  const maxAge = config.sessionTtlDays * 86400;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/* -------------------------------------------------------------- middleware */

/** Attaches the session user when a valid cookie is present; never rejects. */
export function attachUser(db: Db) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      const user = getSessionUser(db, token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Your role does not allow this action' });
      return;
    }
    next();
  };
}
