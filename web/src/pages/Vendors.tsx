import { useEffect, useMemo, useState } from 'react';
import { api, VEHICLE_LABELS, type ListResponse } from '../api';
import { Badge, EmptyState, Icon, Panel } from '../components/ui';
import type { Vendor } from '../../../shared/types';

export default function Vendors() {
  const [rows, setRows] = useState<Vendor[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ListResponse<Vendor>>('/api/vendors')
      .then((res) => setRows(res.rows))
      .catch((err: Error) => setError(err.message));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return rows;
    return rows.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.origins.some((o) => o.toLowerCase().includes(q)) ||
        v.corridors.some((c) => c.toLowerCase().includes(q)) ||
        v.cargoTypes.some((c) => c.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vendors</h1>
          <div className="sub">
            The transporters the matching engine searches: roughly fifteen attributes per vendor, exactly the set
            used for hard filters and scoring.
          </div>
        </div>
        <div className="btn-row">
          <input
            className="search"
            placeholder="Search name, hub, corridor or cargo"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search vendors"
          />
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <Panel title="Vendor master" hint={`${visible.length} of ${rows.length} vendors`} tight>
        {visible.length === 0 ? (
          <EmptyState title="No vendors match" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Operates from</th>
                  <th>Corridors</th>
                  <th>Vehicles handled</th>
                  <th className="num">Capacity</th>
                  <th className="num">Fleet</th>
                  <th className="num">Rating</th>
                  <th className="num">On time</th>
                  <th className="num">Price vs market</th>
                  <th className="num">Avg response</th>
                  <th>Channel</th>
                  <th>Terms</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => (
                  <tr key={v.id}>
                    <td className="td-strong">
                      {v.name}
                      <span className="td-sub">{v.phone}</span>
                    </td>
                    <td className="small">{v.origins.join(', ')}</td>
                    <td className="small">{v.corridors.slice(0, 4).join(', ')}{v.corridors.length > 4 ? ' +' + (v.corridors.length - 4) : ''}</td>
                    <td className="small">
                      {v.vehicleTypes.map((t) => VEHICLE_LABELS[t]).join(', ')}
                      <span className="td-sub">
                        {v.bodySizes.join('/')} ft, {v.axles.join('/')} axle
                      </span>
                    </td>
                    <td className="num">{v.maxCapacityT} T</td>
                    <td className="num">
                      {v.fleetSize}
                      <span className="td-sub">{v.availableVehicles} free</span>
                    </td>
                    <td className="num">{v.rating.toFixed(1)}</td>
                    <td className="num">{v.onTimePct}%</td>
                    <td className="num">
                      {v.avgRateVsMarketPct > 0 ? '+' : ''}
                      {v.avgRateVsMarketPct}%
                    </td>
                    <td className="num">{v.avgResponseMins} min</td>
                    <td className="small">{v.preferredChannel}</td>
                    <td className="num">{v.paymentTermsDays} d</td>
                    <td>
                      <div className="btn-row">
                        {v.kycDone ? <Badge tone="success">KYC</Badge> : <Badge tone="warning">KYC pending</Badge>}
                        {v.active ? null : <Badge tone="danger">Inactive</Badge>}
                      </div>
                      <span className="td-sub">{v.cargoTypes.join(', ')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="How these attributes are used" hint="Two pass matching from the design document">
        <div className="grid-2">
          <div>
            <h3 style={{ marginBottom: 8 }}>Hard filters</h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li className="small">Origin hub and destination corridor must both be served</li>
              <li className="small">Vehicle type, body size and axle configuration must match</li>
              <li className="small">Maximum capacity must be at least the cargo weight</li>
              <li className="small">Cargo type must be handled, vendor active with KYC complete</li>
            </ul>
          </div>
          <div>
            <h3 style={{ marginBottom: 8 }}>Scoring weights</h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li className="small">Availability on the loading date, 30%</li>
              <li className="small">Reliability: rating and on-time percentage, 30%</li>
              <li className="small">Price competitiveness against market, 25%</li>
              <li className="small">Response speed on earlier requests, 15%</li>
            </ul>
          </div>
        </div>
        <p className="small muted mt-3 mb-0">
          <Icon name="alert" size={13} /> Data quality in the vendor master is the usual reason a corridor returns a
          thin shortlist. Excluded vendors are listed with their reasons on each requirement.
        </p>
      </Panel>
    </>
  );
}
