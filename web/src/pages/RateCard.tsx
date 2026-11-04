import { useEffect, useMemo, useState } from 'react';
import { api, rupees, VEHICLE_LABELS, type ListResponse, type RateCardRow } from '../api';
import { Badge, EmptyState, Panel } from '../components/ui';

export default function RateCard() {
  const [rows, setRows] = useState<RateCardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ListResponse<RateCardRow>>('/api/ratecard?limit=200')
      .then((res) => {
        setRows(res.rows);
        setTotal(res.total);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      api
        .get<ListResponse<RateCardRow>>(`/api/ratecard?limit=200&q=${encodeURIComponent(query)}`)
        .then((res) => {
          setRows(res.rows);
          setTotal(res.total);
          setError(null);
        })
        .catch((err: Error) => setError(err.message));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const uniqueOrigins = useMemo(() => new Set(rows.map((r) => r.origin)).size, [rows]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Rate card</h1>
          <div className="sub">
            Pre-fed standard rates for the routes the business quotes every day. Exact route, vehicle and weight band
            matches return a price instantly; anything else falls back to a nearest reference plus live quoting.
          </div>
        </div>
        <div className="btn-row">
          <input
            className="search"
            placeholder="Search origin or destination"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search rate card"
          />
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <Panel title="Standard rates" hint={`${total} rows match, showing ${rows.length}`} tight>
        {rows.length === 0 ? (
          <EmptyState title="No rate card rows match">Try a different origin or destination.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Origin</th>
                  <th>Destination</th>
                  <th>Vehicle</th>
                  <th className="num">Body</th>
                  <th>Axle</th>
                  <th>Weight band</th>
                  <th className="num">Rate</th>
                  <th>Valid from</th>
                  <th>Valid to</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td className="td-strong">{r.origin}</td>
                    <td className="td-strong">{r.destination}</td>
                    <td>{VEHICLE_LABELS[r.vehicleType]}</td>
                    <td className="num">{r.bodySizeFt} ft</td>
                    <td>{r.axle}</td>
                    <td>{r.weightBand}</td>
                    <td className="num td-strong">{rupees(r.rate)}</td>
                    <td className="nowrap small">{r.validFrom}</td>
                    <td className="nowrap small">{r.validTo}</td>
                    <td>{r.curated ? <Badge tone="success">Business file</Badge> : <Badge tone="plain">Generated</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Rate card rules" hint="From section 10 of the design document">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li className="small">Exact route, vehicle and weight band match returns the card price immediately.</li>
          <li className="small">No exact match shows the nearest row as a reference and triggers live vendor quoting.</li>
          <li className="small">
            Rows carry validity dates: {uniqueOrigins} origins currently covered, and expired rows prompt a refresh.
          </li>
          <li className="small">Live vendor quotes can suggest rate card updates over time, which is the learning loop.</li>
          <li className="small">Import from the business team&apos;s spreadsheet through a one-time upload during discovery.</li>
        </ul>
      </Panel>
    </>
  );
}
