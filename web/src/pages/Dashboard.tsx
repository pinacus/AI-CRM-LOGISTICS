import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  formatDateTime,
  plainNumber,
  REQUIREMENT_STATUS_LABEL,
  rupees,
  type DashboardMetrics,
} from '../api';
import { RequirementStatusBadge, Badge, EmptyState, Icon, Metric, Panel } from '../components/ui';
import type { RequirementListItem, TripListItem } from '../api';
import type { PaymentRow } from '../api';

const ACTION_FOR: Record<string, string> = {
  intake: 'Run vendor matching',
  shortlisted: 'Start AI outreach',
  outreach: 'Waiting on vendor replies',
  quoted: 'Price the customer',
  awaiting_customer: 'Confirm the customer order',
  locking: 'Waiting for vendor lock-in',
  confirmed: 'Move the trip forward',
  closed: 'Archived',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [requirements, setRequirements] = useState<RequirementListItem[]>([]);
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<DashboardMetrics>('/api/metrics'),
      api.get<RequirementListItem[]>('/api/requirements'),
      api.get<TripListItem[]>('/api/trips'),
      api.get<{ rows: PaymentRow[] }>('/api/payments'),
    ])
      .then(([m, r, t, p]) => {
        setMetrics(m);
        setRequirements(r);
        setTrips(t);
        setPayments(p.rows);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const openStatuses = new Set(['intake', 'shortlisted', 'outreach', 'quoted', 'awaiting_customer', 'locking']);
  const openRequirements = requirements.filter((r) => openStatuses.has(r.status));
  const inMotion = trips.filter((t) => ['dispatched', 'in_transit', 'delivered', 'billed'].includes(t.status));
  const duePayments = payments.filter((p) => p.status === 'unpaid').slice(0, 5);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">
            Every figure below is summed from the records in the database. Requirements, quotes, trips and
            invoices are the same rows the other screens edit.
          </div>
        </div>
        <div className="btn-row">
          <Link to="/app/requirements/new" className="btn btn-primary">
            <Icon name="plus" size={15} />
            New requirement
          </Link>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="metrics">
        <Metric label="Open requirements" value={metrics ? metrics.openRequirements : '...'} note="Intake through lock-in" />
        <Metric label="Quotes received" value={metrics ? metrics.quotesReceived : '...'} note="Parsed from voice and WhatsApp" />
        <Metric
          label="Average time to L1"
          value={metrics && metrics.avgMinutesToL1 !== null ? `${metrics.avgMinutesToL1} min` : '...'}
          note="Requirement logged to last quote in"
        />
        <Metric
          label="AI outreach response rate"
          value={metrics && metrics.responseRatePct !== null ? `${metrics.responseRatePct}%` : '...'}
          note="Replies against attempts sent"
        />
        <Metric label="Instant price hits" value={metrics ? metrics.instantPriceHits : '...'} note="Requirements answered from the rate card" />
        <Metric label="Trips in transit" value={metrics ? metrics.tripsInTransit : '...'} note="Dispatched or on the road" />
        <Metric label="Receivable outstanding" value={metrics ? rupees(metrics.receivableOutstanding) : '...'} note="Unpaid customer invoices" small />
        <Metric label="Payable outstanding" value={metrics ? rupees(metrics.payableOutstanding) : '...'} note="Vendor payouts not yet released" small />
        <Metric label="Margin booked" value={metrics ? rupees(metrics.marginBooked) : '...'} note="Customer price minus vendor price" small />
        <Metric label="Vendors in master" value={metrics ? plainNumber(metrics.vendorCount) : '...'} note={`${metrics ? metrics.rateCardRows : '...'} rate card rows`} />
      </div>

      <Panel
        title="Requirements that need action"
        hint="Ordered by when they were logged"
        actions={
          <Link to="/app/requirements" className="btn btn-sm">
            All requirements
            <Icon name="arrowRight" size={14} />
          </Link>
        }
        tight
      >
        {openRequirements.length === 0 ? (
          <EmptyState title="Nothing in the pipeline">Log a requirement to start the flow.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Route</th>
                  <th>Status</th>
                  <th className="num">Quotes</th>
                  <th>Next step</th>
                  <th>Logged</th>
                </tr>
              </thead>
              <tbody>
                {openRequirements.slice(0, 6).map((r) => (
                  <tr key={r.id} className="row-click" onClick={() => navigate(`/app/requirements/${r.id}`)}>
                    <td className="td-strong">
                      {r.id}
                      <span className="td-sub">{r.customerName}</span>
                    </td>
                    <td>
                      {r.origin} to {r.destination}
                      <span className="td-sub">
                        {r.weightT} T, {r.bodySizeFt} ft
                      </span>
                    </td>
                    <td>
                      <RequirementStatusBadge status={r.status} />
                    </td>
                    <td className="num">{r.quoteCount}</td>
                    <td>{ACTION_FOR[r.status] ?? ''}</td>
                    <td className="nowrap">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid-2">
        <Panel title="Trips in motion" hint="Dispatched, on the road, delivered or billed" tight>
          {inMotion.length === 0 ? (
            <EmptyState title="No trips in motion" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Trip</th>
                    <th>Route</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {inMotion.slice(0, 5).map((t) => (
                    <tr key={t.id} className="row-click" onClick={() => navigate(`/app/requirements/${t.requirementId}`)}>
                      <td className="td-strong">
                        {t.id}
                        <span className="td-sub">{t.vehicleNo}</span>
                      </td>
                      <td>{t.route}</td>
                      <td>
                        <Badge tone="info">{t.statusLabel}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Receivables due" hint="Customer invoices not yet paid" tight>
          {duePayments.length === 0 ? (
            <EmptyState title="No open invoices" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="num">Amount</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {duePayments.map((p) => (
                    <tr key={p.id} className="row-click" onClick={() => navigate('/app/payments')}>
                      <td className="td-strong">
                        {p.customerName}
                        <span className="td-sub">{p.route}</span>
                      </td>
                      <td className="num">{rupees(p.amount)}</td>
                      <td className="nowrap">
                        {p.daysToDue < 0 ? (
                          <Badge tone="danger">{Math.abs(p.daysToDue)} days overdue</Badge>
                        ) : (
                          <Badge tone="warning">{p.daysToDue} days left</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Requirement stages" hint="What each label means for the agent">
        <div className="btn-row">
          {Object.entries(REQUIREMENT_STATUS_LABEL).map(([key, label]) => (
            <span className="tag" key={key} title={key}>
              {label}
            </span>
          ))}
        </div>
      </Panel>
    </>
  );
}
