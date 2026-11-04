import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, useAuth } from '../auth';
import { Logo } from '../components/ui';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('admin@freightdesk.local');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  if (!loading && user) return <Navigate to="/app" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const signedIn = await signIn(email.trim(), password.trim());
      void signedIn;
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  function fillAccount(accEmail: string, accPass: string) {
    setEmail(accEmail);
    setPassword(accPass);
    setError('');
  }

  return (
    <div className="landing-wrap">
      <div className="landing-top">
        <div className="inner">
          <Link to="/" className="brand">
            <Logo />
            FreightDesk
          </Link>
          <nav className="landing-nav">
            <Link to="/">Product overview</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </div>

      <div className="auth-card">
        <h1>Sign in</h1>
        <p className="muted">Operations console for requirements, outreach, trips and payments.</p>

        <form onSubmit={submit} className="auth-form">
          {error ? <div className="error-banner">{error}</div> : null}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="password" style={{ marginBottom: 0 }}>Password</label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--brand-primary, #2563eb)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  padding: 0,
                }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>

        <div className="auth-hint">
          <div className="label">Demo accounts (click to fill):</div>
          <table>
            <tbody>
              <tr
                onClick={() => fillAccount('admin@freightdesk.local', 'admin123')}
                style={{ cursor: 'pointer' }}
                title="Click to fill credentials"
              >
                <td>admin@freightdesk.local</td>
                <td><code>admin123</code></td>
                <td>{ROLE_LABEL.admin}</td>
              </tr>
              <tr
                onClick={() => fillAccount('sales@freightdesk.local', 'sales123')}
                style={{ cursor: 'pointer' }}
                title="Click to fill credentials"
              >
                <td>sales@freightdesk.local</td>
                <td><code>sales123</code></td>
                <td>{ROLE_LABEL.sales}</td>
              </tr>
              <tr
                onClick={() => fillAccount('ops@freightdesk.local', 'ops123')}
                style={{ cursor: 'pointer' }}
                title="Click to fill credentials"
              >
                <td>ops@freightdesk.local</td>
                <td><code>ops123</code></td>
                <td>{ROLE_LABEL.ops}</td>
              </tr>
              <tr
                onClick={() => fillAccount('finance@freightdesk.local', 'finance123')}
                style={{ cursor: 'pointer' }}
                title="Click to fill credentials"
              >
                <td>finance@freightdesk.local</td>
                <td><code>finance123</code></td>
                <td>{ROLE_LABEL.finance}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
