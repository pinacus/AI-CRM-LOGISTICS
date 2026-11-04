import type { Db } from './db';
import type { SessionUser } from './auth';

/**
 * Append-only audit trail. Every mutating action in the API records who did it,
 * what changed and when, and the trail is visible to admins in the app.
 */

export interface AuditRow {
  id: number;
  at: string;
  userId: number | null;
  userName: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: string | null;
}

export interface AuditInput {
  user: SessionUser | null;
  action: string;
  entity?: string;
  entityId?: string;
  detail?: string;
}

export function recordAudit(db: Db, entry: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_log (at, user_id, user_name, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    new Date().toISOString(),
    entry.user?.id ?? null,
    entry.user?.name ?? 'system',
    entry.action,
    entry.entity ?? null,
    entry.entityId ?? null,
    entry.detail ?? null,
  );
}

export function listAudit(db: Db, limit = 200): AuditRow[] {
  const rows = db
    .prepare(
      `SELECT id, at, user_id, user_name, action, entity, entity_id, detail
       FROM audit_log ORDER BY id DESC LIMIT ?`,
    )
    .all(Math.min(1000, Math.max(1, limit))) as {
    id: number;
    at: string;
    user_id: number | null;
    user_name: string | null;
    action: string;
    entity: string | null;
    entity_id: string | null;
    detail: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    userId: r.user_id,
    userName: r.user_name,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    detail: r.detail,
  }));
}
