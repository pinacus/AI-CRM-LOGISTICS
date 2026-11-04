import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROLE_LABEL, useAuth, type Role } from '../auth';
import { api, formatDateTime } from '../api';
import { Badge, Field, Panel } from '../components/ui';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

interface AuditRow {
  id: number;
  at: string;
  userName: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: string | null;
}

interface SystemInfo {
  version: string;
  node: string;
  uptimeSec: number;
  dbPath: string;
  sessionTtlDays: number;
  channels: { whatsapp: string; voice: string };
  webhookTokenSet: boolean;
  counts: Record<string, number>;
}

const COUNT_LABELS: Record<string, string> = {
  requirements: 'Requirements',
  quotes: 'Quotes',
  attempts: 'Outreach attempts',
  orders: 'Orders',
  trips: 'Trips',
  invoices: 'Invoices',
  vendors: 'Vendors',
  rate_card: 'Rate card rows',
  users: 'Users',
  sessions: 'Active sessions',
  audit_log: 'Audit entries',
};

export default function Admin() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<Role>('sales');
  const [resetId, setResetId] = useState<number | ''>('');
  const [resetPassword, setResetPassword] = useState('');

  const load = useCallback(async () => {
    try {
      const [u, a, s] = await Promise.all([
        api.get<AdminUser[]>('/api/admin/users'),
        api.get<AuditRow[]>('/api/admin/audit?limit=200'),
        api.get<SystemInfo>('/api/system'),
      ]);
      setUsers(u);
      setAudit(a);
      setSystem(s);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api.post('/api/admin/users', { name: newName, email: newEmail, password: newPassword, role: newRole });
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('sales');
      flash('User created');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the user');
    }
  }

  async function resetPasswordFor(event: FormEvent) {
    event.preventDefault();
    if (resetId === '') return;
    setError('');
    try {
      await api.post(`/api/admin/users/${resetId}/reset`, { password: resetPassword });
      setResetId('');
      setResetPassword('');
      flash('Password reset, all sessions for that user were signed out');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password');
    }
  }

  async function toggleActive(target: AdminUser) {
    setError('');
    try {
      await api.post(`/api/admin/users/${target.id}/active`, { active: !target.active });
      flash(target.active ? `${target.name} deactivated` : `${target.name} re-enabled`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the account');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">Administration</div>
          <h1>Users, audit trail and system</h1>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="callout">{notice}</div> : null}

      <Panel title="Accounts" hint={`Signed in as ${user?.name} (${user ? ROLE_LABEL[user.role] : ''}). Roles decide who can open this screen.`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="td-strong">{u.name}</td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>
                    <Badge tone={u.active ? 'success' : 'danger'}>{u.active ? 'Active' : 'Deactivated'}</Badge>
                  </td>
                  <td className="td-sub">{formatDateTime(u.createdAt)}</td>
                  <td>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setResetId(u.id);
                          setResetPassword('');
                        }}
                      >
                        Reset password
                      </button>
                      {u.id === user?.id ? null : (
                        <button
                          type="button"
                          className={u.active ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-success'}
                          onClick={() => void toggleActive(u)}
                        >
                          {u.active ? 'Deactivate' : 'Re-enable'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={createUser} className="form-grid" style={{ marginTop: 18 }}>
          <Field label="Full name">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required minLength={2} />
          </Field>
          <Field label="Email">
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
          </Field>
          <Field label="Password" help="At least 6 characters">
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
          </Field>
          <Field label="Role">
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </Field>
          <div className="field">
            <label>&nbsp;</label>
            <button type="submit" className="btn btn-primary">
              Create user
            </button>
          </div>
        </form>

        {resetId !== '' ? (
          <form onSubmit={resetPasswordFor} className="inline-form" style={{ marginTop: 14 }}>
            <Field label={`New password for ${users.find((u) => u.id === resetId)?.email ?? ''}`}>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                required
                minLength={6}
              />
            </Field>
            <button type="submit" className="btn btn-primary btn-sm">
              Set password
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setResetId('')}>
              Cancel
            </button>
          </form>
        ) : null}
      </Panel>

      <Panel title="System" hint="Where the data lives and which outreach channels are configured">
        {system ? (
          <>
            <div className="kv">
              <div>
                <span>Version</span>
                <strong>{system.version}</strong>
              </div>
              <div>
                <span>Runtime</span>
                <strong>Node {system.node}</strong>
              </div>
              <div>
                <span>Uptime</span>
                <strong>{Math.round(system.uptimeSec / 60)} min</strong>
              </div>
              <div>
                <span>Session lifetime</span>
                <strong>{system.sessionTtlDays} days</strong>
              </div>
              <div>
                <span>Database</span>
                <strong className="mono">{system.dbPath}</strong>
              </div>
              <div>
                <span>WhatsApp channel</span>
                <strong>
                  <Badge tone={system.channels.whatsapp === 'live' ? 'success' : 'neutral'}>{system.channels.whatsapp}</Badge>
                </strong>
              </div>
              <div>
                <span>Voice channel</span>
                <strong>
                  <Badge tone={system.channels.voice === 'live' ? 'success' : 'neutral'}>{system.channels.voice}</Badge>
                </strong>
              </div>
              <div>
                <span>Webhook token</span>
                <strong>{system.webhookTokenSet ? 'configured' : 'missing'}</strong>
              </div>
            </div>
            <div className="metrics" style={{ marginTop: 16 }}>
              {Object.entries(COUNT_LABELS)
                .filter(([key]) => system.counts[key] !== undefined)
                .map(([key, label]) => (
                  <div className="metric" key={key}>
                    <div className="label">{label}</div>
                    <div className="value">{system.counts[key]}</div>
                  </div>
                ))}
            </div>
          </>
        ) : (
          <p className="muted">Loading system information.</p>
        )}
      </Panel>

      <Panel title="Audit trail" hint="Every sign-in, outreach run, price, order, trip change and payment, newest first">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Record</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row) => (
                <tr key={row.id}>
                  <td className="td-sub">{formatDateTime(row.at)}</td>
                  <td>{row.userName ?? 'system'}</td>
                  <td className="mono">{row.action}</td>
                  <td className="td-sub">
                    {row.entity && row.entityId ? `${row.entity} ${row.entityId}` : row.entity ?? ''}
                  </td>
                  <td className="td-sub">{row.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
