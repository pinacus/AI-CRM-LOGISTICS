import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  rupees,
  VEHICLE_LABELS,
  type RateLookupResult,
  type RequirementDetail,
} from '../api';
import { Field, Icon, Panel } from '../components/ui';
import type { Axle, CargoType, VehicleType } from '../../../shared/types';

const CARGO_OPTIONS: CargoType[] = ['General', 'FMCG', 'Auto parts', 'Pharma', 'Textiles', 'ODC', 'Chemicals'];
const BODY_SIZES = [14, 19, 22, 32, 40];
const AXLE_OPTIONS: { value: Axle; label: string }[] = [
  { value: 'single', label: 'Single axle' },
  { value: 'multi', label: 'Multi axle' },
];

interface Customer {
  id: string;
  name: string;
  contact: string;
  creditTermsDays: number;
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function NewRequirement() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [lookup, setLookup] = useState<RateLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [origin, setOrigin] = useState('Ambattur');
  const [destination, setDestination] = useState('Bengaluru');
  const [cargo, setCargo] = useState<CargoType>('General');
  const [vehicleType, setVehicleType] = useState<VehicleType>('open_truck');
  const [bodySizeFt, setBodySizeFt] = useState(32);
  const [axle, setAxle] = useState<Axle>('multi');
  const [weightT, setWeightT] = useState(9);
  const [loadingDate, setLoadingDate] = useState(tomorrow());
  const [loadingTime, setLoadingTime] = useState('08:00');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api
      .get<Customer[]>('/api/customers')
      .then((rows) => {
        setCustomers(rows);
        if (rows[0]) setCustomerName(rows[0].name);
      })
      .catch((err: Error) => setError(err.message));

    api
      .get<{ origins: string[]; destinations: string[] }>('/api/hubs')
      .then((hubs) => {
        setOrigins(hubs.origins);
        setDestinations(hubs.destinations);
      })
      .catch(() => undefined);
  }, []);

  // The rate card answer appears as soon as the route, vehicle and weight are set.
  useEffect(() => {
    if (!origin || !destination || !(weightT > 0)) {
      setLookup(null);
      return;
    }
    const handle = window.setTimeout(() => {
      api
        .post<RateLookupResult>('/api/ratecard/lookup', { origin, destination, vehicleType, bodySizeFt, axle, weightT })
        .then(setLookup)
        .catch(() => setLookup(null));
    }, 220);
    return () => window.clearTimeout(handle);
  }, [origin, destination, vehicleType, bodySizeFt, axle, weightT]);

  const canSubmit = useMemo(
    () => customerName.length > 0 && origin.length > 0 && destination.length > 0 && weightT > 0 && !saving,
    [customerName, origin, destination, weightT, saving],
  );

  async function submit(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const detail = await api.post<RequirementDetail>('/api/requirements', {
        customerName,
        origin,
        destination,
        cargo,
        weightT,
        vehicleType,
        bodySizeFt,
        axle,
        loadingDate,
        loadingTime,
        notes,
      });
      navigate(`/app/requirements/${detail.requirement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the requirement');
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            <Link to="/app/requirements">Requirements</Link> / new
          </div>
          <h1>New requirement</h1>
          <div className="sub">
            Non marketing enquiries only. The rate card is searched as you type, so frequent routes get a price
            without contacting a vendor.
          </div>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="grid-2">
        <Panel title="Requirement details" hint="What the customer needs">
          <div className="form-grid">
            <Field label="Customer">
              <select value={customerName} onChange={(e) => setCustomerName(e.target.value)}>
                {customers.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="help">
                {customers.find((c) => c.name === customerName)?.creditTermsDays ?? 30} day credit terms
              </span>
            </Field>

            <Field label="Origin estate or city">
              <input list="origin-hubs" value={origin} onChange={(e) => setOrigin(e.target.value)} />
              <datalist id="origin-hubs">
                {origins.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </Field>

            <Field label="Destination">
              <input list="destination-hubs" value={destination} onChange={(e) => setDestination(e.target.value)} />
              <datalist id="destination-hubs">
                {destinations.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>

            <Field label="Cargo type">
              <select value={cargo} onChange={(e) => setCargo(e.target.value as CargoType)}>
                {CARGO_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Weight (tonnes)">
              <input
                type="number"
                min={1}
                max={40}
                step={0.5}
                value={weightT}
                onChange={(e) => setWeightT(Number(e.target.value))}
              />
            </Field>

            <Field label="Vehicle type">
              <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value as VehicleType)}>
                {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Body size (ft)">
              <select value={bodySizeFt} onChange={(e) => setBodySizeFt(Number(e.target.value))}>
                {BODY_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} ft
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Axle configuration">
              <select value={axle} onChange={(e) => setAxle(e.target.value as Axle)}>
                {AXLE_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Loading date">
              <input type="date" value={loadingDate} onChange={(e) => setLoadingDate(e.target.value)} />
            </Field>

            <Field label="Loading time">
              <input type="time" value={loadingTime} onChange={(e) => setLoadingTime(e.target.value)} />
            </Field>

            <Field label="Notes for the agent" help="Gate number, e-way bill, overloading restrictions">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>

          <div className="btn-row mt-3">
            <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
              {saving ? <span className="spinner" /> : <Icon name="check" size={15} />}
              Save requirement
            </button>
            <Link to="/app/requirements" className="btn">
              Cancel
            </Link>
          </div>
        </Panel>

        <div>
          <Panel title="Instant price check" hint="Rate card lookup against 300 pre-fed rows">
            {!lookup ? (
              <p className="muted mb-0">Fill the route and weight to see whether the rate card can answer this trip.</p>
            ) : lookup.match === 'exact' ? (
              <>
                <div className="callout success mb-0">
                  <strong>Exact rate card match: {rupees(lookup.rate)}</strong>
                  <div className="small mt-2">
                    {lookup.row?.vehicleType.replace('_', ' ')}, {lookup.row?.bodySizeFt} ft, {lookup.row?.axle} axle,
                    band {lookup.row?.weightBand}, valid to {lookup.row?.validTo}.
                  </div>
                </div>
                <p className="small muted mt-2 mb-0">
                  The agent can quote this to the customer immediately. A live vendor check is optional.
                </p>
              </>
            ) : lookup.match === 'nearest' ? (
              <div className="callout warning mb-0">
                <strong>Nearest route reference: {rupees(lookup.rate)}</strong>
                <div className="small mt-2">{lookup.note}</div>
              </div>
            ) : (
              <div className="callout mb-0">
                <strong>No rate card entry for this route</strong>
                <div className="small mt-2">{lookup.note}. Live vendor quoting will be required after intake.</div>
              </div>
            )}
          </Panel>

          <Panel title="What happens after saving" hint="The flow this build follows">
            <ol className="flow-list">
              <li>
                <strong>Vendor matching:</strong>&nbsp;<span>hard filters, then the weighted score, top 8 shortlisted.</span>
              </li>
              <li>
                <strong>AI outreach:</strong>&nbsp;<span>voice call and WhatsApp message go out to the shortlist in parallel.</span>
              </li>
              <li>
                <strong>L1 suggestion:</strong>&nbsp;<span>replies are parsed, ranked, flagged if they look wrong.</span>
              </li>
              <li>
                <strong>Lock in and execute:</strong>&nbsp;<span>customer confirms, vendor accepts, trip starts.</span>
              </li>
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
