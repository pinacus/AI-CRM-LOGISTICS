import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type TripListItem } from '../api';
import { Badge, EmptyState, Icon, Panel } from '../components/ui';
import { TRIP_STATUS_LABEL, TRIP_STATUS_ORDER, type TripStatus } from '../../../shared/types';

const NEXT_LABEL: Record<string, string> = {
  vendor_confirmed: 'Assign vehicle',
  vehicle_assigned: 'Dispatch',
  dispatched: 'Start transit',
  in_transit: 'Mark delivered',
  delivered: 'Raise invoice',
  billed: 'Record payment',
};

function isBlockedByPod(trip: TripListItem): boolean {
  return trip.status === 'dispatched' || trip.status === 'in_transit' || trip.status === 'vendor_confirmed' || trip.status === 'vehicle_assigned';
}

export default function Trips() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<TripListItem[]>('/api/trips')
      .then((rows) => {
        setTrips(rows);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(name: string, call: () => Promise<unknown>): Promise<void> {
    setBusy(name);
    setError(null);
    try {
      await call();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const byStatus = new Map<TripStatus, TripListItem[]>();
  for (const status of TRIP_STATUS_ORDER) byStatus.set(status, []);
  for (const trip of trips) {
    const list = byStatus.get(trip.status) ?? [];
    list.push(trip);
    byStatus.set(trip.status, list);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Trip board</h1>
          <div className="sub">
            Dispatch, transit, delivery, billing and payment in one place. Proof of delivery must be attached before
            a trip can be marked delivered, and raising the invoice or recording payment is a click on the card.
          </div>
        </div>
        <div className="btn-row">
          <Link to="/app/payments" className="btn">
            <Icon name="rupee" size={15} />
            Payments
          </Link>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {trips.length === 0 ? (
        <Panel title="No trips yet">
          <EmptyState title="Nothing has been dispatched">
            Confirm a customer order from a requirement to create the first trip.
          </EmptyState>
        </Panel>
      ) : (
        <div className="kanban">
          {TRIP_STATUS_ORDER.map((status) => {
            const column = byStatus.get(status) ?? [];
            return (
              <div className="kanban-col" key={status}>
                <div className="col-head">
                  <span>{TRIP_STATUS_LABEL[status]}</span>
                  <span className="count">{column.length}</span>
                </div>
                <div className="col-body">
                  {column.length === 0 ? (
                    <span className="small faint">Empty</span>
                  ) : (
                    column.map((trip) => (
                      <div className="kanban-card" key={trip.id}>
                        <div className="id">{trip.id}</div>
                        <div className="route">{trip.route}</div>
                        <div className="meta">
                          {trip.vehicleNo} <span className="faint">|</span> {trip.customerName}
                        </div>
                        <div className="meta">
                          POD: {trip.podFile ?? 'pending'}
                          {trip.status === 'billed' || trip.status === 'paid' ? (
                            <span className="td-sub">Invoice raised</span>
                          ) : null}
                        </div>
                        <div className="actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => navigate(`/app/requirements/${trip.requirementId}`)}
                          >
                            Open requirement
                          </button>
                          {isBlockedByPod(trip) ? (
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busy !== null}
                              title="Sample file attached in place of an upload"
                              onClick={() =>
                                void run(`${trip.id}-pod`, () =>
                                  api.post(`/api/trips/${trip.id}/pod`, { file: `POD_${trip.id}.pdf` }),
                                )
                              }
                            >
                              {trip.podFile ? 'POD attached' : 'Attach POD'}
                            </button>
                          ) : null}
                          {status !== 'paid' ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={busy !== null}
                              onClick={() => void run(`${trip.id}-advance`, () => api.post(`/api/trips/${trip.id}/advance`))}
                            >
                              {busy === `${trip.id}-advance` ? <span className="spinner" /> : null}
                              {NEXT_LABEL[trip.status] ?? 'Advance'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Panel title="What each status means" hint="Triggers and notifications in this build">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Trigger</th>
                <th>Notification</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Vendor confirmed</td>
                <td>Vendor accepts the job at the locked price</td>
                <td>Sales agent, customer</td>
              </tr>
              <tr>
                <td>Vehicle assigned</td>
                <td>Vehicle number and driver captured at lock-in</td>
                <td>Customer, ops</td>
              </tr>
              <tr>
                <td>Dispatched</td>
                <td>Vehicle reaches the pickup point and loads</td>
                <td>Customer</td>
              </tr>
              <tr>
                <td>In transit</td>
                <td>Driver status update, manual or WhatsApp check-in</td>
                <td>Customer</td>
              </tr>
              <tr>
                <td>Delivered</td>
                <td>Proof of delivery attached to the trip</td>
                <td>Customer, accounts</td>
              </tr>
              <tr>
                <td>Billed</td>
                <td>Invoice generated from the customer price</td>
                <td>Customer</td>
              </tr>
              <tr>
                <td>Paid</td>
                <td>Payment recorded against the invoice</td>
                <td>Sales, accounts</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
