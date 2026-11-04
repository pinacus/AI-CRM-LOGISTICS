import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDate, formatDateTime, rupees, type PaymentsResponse } from '../api';
import { Badge, EmptyState, Icon, Metric, Panel } from '../components/ui';

export default function Payments() {
  const [data, setData] = useState<PaymentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<PaymentsResponse>('/api/payments')
      .then((d) => {
        setData(d);
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

  const rows = data?.rows ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payments</h1>
          <div className="sub">
            Receivables against customers, payouts against vendors, and the margin kept per trip. Invoice dates come
            from the trip reaching billed, due dates from each customer&apos;s credit terms.
          </div>
        </div>
        <div className="btn-row">
          <Link to="/app/trips" className="btn">
            <Icon name="truck" size={15} />
            Trip board
          </Link>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="metrics">
        <Metric label="Receivable outstanding" value={rupees(data?.summary.receivableOutstanding ?? null)} note="Customer invoices not received" small />
        <Metric label="Payable outstanding" value={rupees(data?.summary.payableOutstanding ?? null)} note="Vendor payouts not released" small />
        <Metric label="Margin booked" value={rupees(data?.summary.marginBooked ?? null)} note="Across all billed trips" small />
        <Metric label="Invoices" value={rows.length} note={`${rows.filter((r) => r.status === 'paid').length} settled`} />
      </div>

      <Panel title="Invoices" hint="Sorted by due date" tight>
        {rows.length === 0 ? (
          <EmptyState title="No invoices yet">Raise one by advancing a delivered trip to billed.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th className="num">Customer pays</th>
                  <th className="num">Vendor gets</th>
                  <th className="num">Margin</th>
                  <th>Due</th>
                  <th>Receipt</th>
                  <th>Vendor payout</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td-strong">
                      {r.id}
                      <span className="td-sub">
                        <Link to={`/app/requirements/${r.requirementId}`}>{r.requirementId}</Link>
                      </span>
                    </td>
                    <td>
                      {r.customerName}
                      <span className="td-sub">{r.route}</span>
                    </td>
                    <td className="num">{rupees(r.amount)}</td>
                    <td className="num">{rupees(r.vendorPayout)}</td>
                    <td className="num td-strong">{rupees(r.margin)}</td>
                    <td className="nowrap">
                      {formatDate(r.dueDate)}
                      <span className="td-sub">
                        {r.status === 'paid'
                          ? `paid ${r.paidOn ? formatDate(r.paidOn) : ''}`
                          : r.daysToDue < 0
                            ? `${Math.abs(r.daysToDue)} days overdue`
                            : `${r.daysToDue} days left`}
                      </span>
                    </td>
                    <td>{r.status === 'paid' ? <Badge tone="success">Received</Badge> : <Badge tone="warning">Unpaid</Badge>}</td>
                    <td>
                      {r.vendorPayoutStatus === 'paid' ? (
                        <Badge tone="success">Paid</Badge>
                      ) : r.vendorPayoutStatus === 'approved' ? (
                        <Badge tone="info">Approved</Badge>
                      ) : (
                        <Badge tone="plain">Pending</Badge>
                      )}
                    </td>
                    <td>
                      <div className="btn-row">
                        {r.status === 'unpaid' ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-success"
                            disabled={busy !== null}
                            onClick={() => void run(`pay-${r.id}`, () => api.post(`/api/payments/${r.id}/pay`))}
                          >
                            {busy === `pay-${r.id}` ? <span className="spinner" /> : null}
                            Record payment
                          </button>
                        ) : null}
                        {r.vendorPayoutStatus !== 'paid' ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy !== null}
                            onClick={() =>
                              void run(`payout-${r.id}`, () =>
                                api.post(`/api/payments/${r.id}/payout`, {
                                  status: r.vendorPayoutStatus === 'pending' ? 'approved' : 'paid',
                                }),
                              )
                            }
                          >
                            {r.vendorPayoutStatus === 'pending' ? 'Approve payout' : 'Mark vendor paid'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Notes on billing" hint="Scope boundaries from the design document">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li className="small">Invoices are records only. GST e-invoicing and accounting integration are later phases.</li>
          <li className="small">Customer credit terms come from the customer master, 15 to 45 days in this sample data.</li>
          <li className="small">
            Payment reminders would go out over WhatsApp in production; this build records due dates and status only.
            Last invoice activity {rows.length > 0 ? formatDateTime(rows[rows.length - 1]?.issuedAt ?? new Date().toISOString()) : 'none yet'}.
          </li>
        </ul>
      </Panel>
    </>
  );
}
