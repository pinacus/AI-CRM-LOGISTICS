import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, useAuth } from '../auth';
import { Icon, Logo, type IconName } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operations',
    items: [
      { to: '/app', label: 'Dashboard', icon: 'grid', end: true },
      { to: '/app/requirements', label: 'Requirements', icon: 'clipboard' },
      { to: '/app/trips', label: 'Trip board', icon: 'truck' },
      { to: '/app/payments', label: 'Payments', icon: 'rupee' },
    ],
  },
  {
    title: 'Master data',
    items: [
      { to: '/app/vendors', label: 'Vendors', icon: 'users' },
      { to: '/app/ratecard', label: 'Rate card', icon: 'table' },
    ],
  },
];

const ADMIN_GROUP: { title: string; items: NavItem[] } = {
  title: 'Administration',
  items: [{ to: '/app/admin', label: 'Users and audit', icon: 'shield' }],
};

export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const groups = user?.role === 'admin' ? [...GROUPS, ADMIN_GROUP] : GROUPS;

  async function logout() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <Logo />
          FreightDesk
          <small>CRM and logistics automation</small>
        </Link>
        <div className="topbar-right">
          {user ? (
            <span className="user-chip">
              {user.name}
              <em>{ROLE_LABEL[user.role]}</em>
            </span>
          ) : null}
          <Link to="/">Product overview</Link>
          <button type="button" className="btn btn-sm" onClick={() => void logout()}>
            Sign out
          </button>
          <Link to="/app/requirements/new" className="btn btn-primary btn-sm">
            <Icon name="plus" size={14} />
            New requirement
          </Link>
        </div>
      </header>

      <div className="shell">
        <nav className="sidebar">
          {groups.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-group-title">{group.title}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <main className="main">
          <div className="content-width">
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}
