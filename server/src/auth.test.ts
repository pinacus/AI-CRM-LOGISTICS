import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import {
  attachUser,
  createSession,
  ensureSeedUsers,
  getSessionUser,
  hashPassword,
  loginFailure,
  loginLocked,
  loginSuccess,
  readCookie,
  requireAuth,
  requireRole,
  revokeSession,
  SESSION_COOKIE,
  verifyPassword,
} from './auth';
import { openDatabase, type Db } from './db';

function tempDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freightdesk-auth-'));
  return openDatabase(path.join(dir, 'test.db'));
}

function fakeReq(overrides: Partial<Request> = {}): Request {
  return { headers: {}, ...overrides } as Request;
}

function fakeRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: unknown };
}

function seedUserId(db: Db, email: string): number {
  const row = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: number } | undefined;
  assert.ok(row, `seed user ${email} missing`);
  return row.id;
}

test('password hash round-trips and rejects wrong passwords', () => {
  const hash = hashPassword('admin123');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('admin123', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.equal(verifyPassword('admin123', 'garbage'), false);
  assert.equal(verifyPassword('admin123', 'scrypt$1$1$1$abc$def'), false);
});

test('same password produces different hashes (unique salt)', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'));
});

test('session lookup returns the user and clears after revoke', () => {
  const db = tempDb();
  ensureSeedUsers(db);
  const { token } = createSession(db, seedUserId(db, 'admin@freightdesk.local'), '127.0.0.1');

  const user = getSessionUser(db, token);
  assert.equal(user?.email, 'admin@freightdesk.local');
  assert.equal(user?.role, 'admin');

  revokeSession(db, token);
  assert.equal(getSessionUser(db, token), null);
  db.close();
});

test('expired sessions are rejected and deleted', () => {
  const db = tempDb();
  ensureSeedUsers(db);
  const { token } = createSession(db, seedUserId(db, 'admin@freightdesk.local'));
  db.prepare(`UPDATE sessions SET expires_at = ?`).run('2000-01-01T00:00:00.000Z');

  assert.equal(getSessionUser(db, token), null);
  const remaining = db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number };
  assert.equal(remaining.n, 0);
  db.close();
});

test('readCookie extracts the session cookie from a header', () => {
  assert.equal(readCookie(`a=1; ${SESSION_COOKIE}=abc123; b=2`, SESSION_COOKIE), 'abc123');
  assert.equal(readCookie(undefined, SESSION_COOKIE), null);
  assert.equal(readCookie('other=1', SESSION_COOKIE), null);
});

test('login rate limit locks after repeated failures and clears on success', () => {
  const key = 'ip|someone@example.com';
  assert.equal(loginLocked(key), 0);
  for (let i = 0; i < 8; i++) loginFailure(key);
  assert.ok(loginLocked(key) > 0);
  loginSuccess(key);
  assert.equal(loginLocked(key), 0);
});

test('requireAuth rejects anonymous and requireRole enforces roles', () => {
  const res1 = fakeRes();
  requireAuth(fakeReq(), res1, (() => {}) as NextFunction);
  assert.equal(res1.statusCode, 401);

  const res2 = fakeRes();
  requireRole('admin')(
    fakeReq({ user: { id: 1, name: 'x', email: 'x@y', role: 'sales' } }),
    res2,
    (() => {}) as NextFunction,
  );
  assert.equal(res2.statusCode, 403);

  const res3 = fakeRes();
  requireRole('admin')(
    fakeReq({ user: { id: 1, name: 'x', email: 'x@y', role: 'admin' } }),
    res3,
    (() => {}) as NextFunction,
  );
  assert.equal(res3.statusCode, 200);
});

test('attachUser resolves the session cookie onto the request', () => {
  const db = tempDb();
  ensureSeedUsers(db);
  const { token } = createSession(db, seedUserId(db, 'ops@freightdesk.local'));

  const req = fakeReq({ headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  let called = false;
  attachUser(db)(req, fakeRes(), () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(req.user?.email, 'ops@freightdesk.local');
  assert.equal(req.user?.role, 'ops');
  db.close();
});

test('seed users are created exactly once', () => {
  const db = tempDb();
  ensureSeedUsers(db);
  ensureSeedUsers(db);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  assert.equal(row.n, 4);
  db.close();
});
