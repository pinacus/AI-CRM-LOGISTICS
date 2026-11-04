import type { ReactElement } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import AppShell from './components/AppShell';
import Admin from './pages/Admin';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import Login from './pages/Login';
import NewRequirement from './pages/NewRequirement';
import Payments from './pages/Payments';
import Privacy from './pages/Privacy';
import RateCard from './pages/RateCard';
import RequirementDetail from './pages/RequirementDetail';
import Requirements from './pages/Requirements';
import Terms from './pages/Terms';
import Trips from './pages/Trips';
import Vendors from './pages/Vendors';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="landing-wrap">
        <p className="muted">Loading the console.</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

function NotFound() {
  return (
    <div className="landing-wrap">
      <h1>Page not found</h1>
      <p className="muted">That address does not match anything in this build.</p>
      <p>
        <Link to="/">Back to the product overview</Link>
      </p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="requirements" element={<Requirements />} />
          <Route path="requirements/new" element={<NewRequirement />} />
          <Route path="requirements/:id" element={<RequirementDetail />} />
          <Route path="trips" element={<Trips />} />
          <Route path="payments" element={<Payments />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="ratecard" element={<RateCard />} />
          <Route path="admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
