import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  formatDateTime,
  formatTime,
  rupees,
  VEHICLE_LABELS,
  type RequirementDetail,
} from '../api';
import { Badge, EmptyState, Icon, Panel, RequirementStatusBadge, ScoreBar } from '../components/ui';

const CHANNEL_ICON = { voice: 'phone', message: 'message' } as const;

const SARVAM_STATUS_LABEL: Record<string, string> = {
  queued: 'Calling',
  connected: 'Connected',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
};

const NEXT_TRIP_LABEL: Record<string, string> = {
  vendor_confirmed: 'Capture vehicle assignment',
  vehicle_assigned: 'Mark dispatched',
  dispatched: 'Mark in transit',
  in_transit: 'Mark delivered',
  delivered: 'Raise invoice',
  billed: 'Record payment against invoice',
};

const STEP_LABELS = [
  'Intake',
  'Rate card',
  'Shortlist',
  'AI outreach',
  'Quotes',
  'Customer quote',
  'Lock in',
  'Trip',
  'Payment',
];

function currentStep(status: string): number {
  switch (status) {
    case 'intake':
      return 0;
    case 'shortlisted':
      return 2;
    case 'outreach':
      return 3;
    case 'quoted':
      return 4;
    case 'awaiting_customer':
      return 5;
    case 'locking':
      return 6;
    case 'confirmed':
      return 7;
    case 'closed':
      return 8;
    default:
      return 0;
  }
}

export default function RequirementDetail() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<RequirementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [marginPct, setMarginPct] = useState(8);
  const [showExcluded, setShowExcluded] = useState(false);

  const load = useCallback(() => {
    api
      .get<RequirementDetail>(`/api/requirements/${id}`)
      .then((d) => {
        setDetail(d);
        if (d.requirement.marginPct !== null) setMarginPct(d.requirement.marginPct);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    setDetail(null);
    load();
  }, [load]);

  // Poll while a simulation is in flight so attempt states update on screen.
  // The status covers the gap where attempts have settled but the requirement
  // has not moved to quoted yet.
  const shouldPoll = Boolean(
    detail &&
      (detail.outreachRunning ||
        detail.lockInProgress ||
        detail.requirement.status === 'outreach' ||
        detail.requirement.status === 'locking'),
  );
  useEffect(() => {
    if (!shouldPoll) return undefined;
    const handle = window.setInterval(load, 1500);
    return () => window.clearInterval(handle);
  }, [shouldPoll, load]);

  async function action(name: string, run: () => Promise<unknown>): Promise<void> {
    setBusy(name);
    setError(null);
    try {
      await run();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const requirement = detail?.requirement;
  const stepIndex = requirement ? currentStep(requirement.status) : 0;
  const summary = detail?.summary;
  const l1 = summary?.l1 ?? null;
  const previewCustomerPrice = l1 ? Math.round(l1.normalisedRate * (1 + marginPct / 100)) : null;

  const factorLabels = useMemo(() => {
    const first = detail?.match?.matched[0];
    return first ? first.factors : [];
  }, [detail?.match]);

  if (!requirement || !detail) {
    return (
      <>
        <div className="crumbs">
          <Link to="/app/requirements">Requirements</Link> / {id}
        </div>
        {error ? <div className="error-banner">{error}</div> : <p className="muted">Loading requirement...</p>}
      </>
    );
  }

  const { match, attempts, quotes, order, trip, invoice, sarvam, sarvamCalls } = detail;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            <Link to="/app/requirements">Requirements</Link> / {requirement.id}
          </div>
          <h1>
            {requirement.id} <RequirementStatusBadge status={requirement.status} />
          </h1>
          <div className="sub">
            {requirement.customerName}: {requirement.origin} to {requirement.destination}, {requirement.weightT}{' '}
            tonnes of {requirement.cargo.toLowerCase()},{' '}
            {(VEHICLE_LABELS[requirement.vehicleType] ?? requirement.vehicleType).toLowerCase()}{' '}
            {requirement.bodySizeFt} ft {requirement.axle} axle. Loading {requirement.loadingDate} at{' '}
            {requirement.loadingTime}.
          </div>
        </div>
        <div className="btn-row">
          <span className="small muted">Logged {formatDateTime(requirement.createdAt)}</span>
        </div>
      </div>

      <div className="section-steps">
        {STEP_LABELS.map((label, i) => (
          <span
            key={label}
            className={i < stepIndex ? 'step done' : i === stepIndex ? 'step current' : 'step'}
          >
            <span className="n">{i + 1}</span>
            {label}
          </span>
        ))}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <Panel title="Requirement and rate card" hint="Intake fields as logged, plus the instant price check">
        <div className="grid-2">
          <div className="kv">
            <div>
              <div className="k">Customer</div>
              <div className="v strong">{requirement.customerName}</div>
            </div>
            <div>
              <div className="k">Corridor</div>
              <div className="v">
                {requirement.origin} to {requirement.destination}
              </div>
            </div>
            <div>
              <div className="k">Load</div>
              <div className="v">
                {requirement.weightT} T of {requirement.cargo}
              </div>
            </div>
            <div>
              <div className="k">Vehicle</div>
              <div className="v">
                {VEHICLE_LABELS[requirement.vehicleType]}, {requirement.bodySizeFt} ft, {requirement.axle} axle
              </div>
            </div>
            <div>
              <div className="k">Loading slot</div>
              <div className="v">
                {requirement.loadingDate} {requirement.loadingTime}
              </div>
            </div>
            <div>
              <div className="k">Notes</div>
              <div className="v">{requirement.notes || 'None'}</div>
            </div>
          </div>

          <div>
            {requirement.rateCardMatch === 'exact' ? (
              <div className="callout success">
                <strong>Instant price from the rate card: {rupees(requirement.rateCardRate)}</strong>
                <div className="small mt-2">{requirement.rateCardNote}</div>
              </div>
            ) : requirement.rateCardMatch === 'nearest' ? (
              <div className="callout warning">
                <strong>Nearest rate card reference: {rupees(requirement.rateCardRate)}</strong>
                <div className="small mt-2">{requirement.rateCardNote}</div>
              </div>
            ) : (
              <div className="callout">
                <strong>No rate card row for this route</strong>
                <div className="small mt-2">{requirement.rateCardNote}</div>
              </div>
            )}
            <p className="small muted mb-0">
              Rate card rows carry a validity window, and live vendor quotes feed suggested updates after the trip.
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title="Vendor shortlist"
        hint={
          match
            ? `Top ${match.matched.length} of ${match.matched.length + match.excludedCount} vendors considered. Hard filters first, then a weighted score.`
            : 'Vendors have not been matched yet'
        }
        actions={
          <>
            {requirement.status === 'intake' ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => void action('match', () => api.post(`/api/requirements/${id}/match`))}
              >
                {busy === 'match' ? <span className="spinner" /> : <Icon name="search" size={15} />}
                Find vendors
              </button>
            ) : null}
            {requirement.status === 'shortlisted' ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => void action('outreach', () => api.post(`/api/requirements/${id}/outreach`))}
              >
                {busy === 'outreach' ? <span className="spinner" /> : <Icon name="phone" size={15} />}
                Start AI outreach
              </button>
            ) : null}
            {detail.outreachRunning ? (
              <span className="small muted">
                <span className="spinner" /> Outreach running, replies arrive over the next few seconds
              </span>
            ) : null}
          </>
        }
        tight
      >
        {!match ? (
          <EmptyState title="No shortlist yet">
            Click Find vendors to run the hard filters and the scoring model against the vendor master.
          </EmptyState>
        ) : match.matched.length === 0 ? (
          <EmptyState title="No vendor passes every filter">
            Widen the requirement, or clean up vendor master data for this corridor.
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="num">Rank</th>
                    <th>Vendor</th>
                    <th>Match score</th>
                    <th>Strongest factors</th>
                    <th>Channel</th>
                    <th>Fleet</th>
                    <th>KYC</th>
                  </tr>
                </thead>
                <tbody>
                  {match.matched.map((m) => (
                    <tr key={m.vendor.id}>
                      <td className="num td-strong">{m.rank}</td>
                      <td className="td-strong">
                        {m.vendor.name}
                        <span className="td-sub">
                          {m.vendor.origins.slice(0, 3).join(', ')}
                          {m.vendor.origins.length > 3 ? ' and more' : ''}
                        </span>
                      </td>
                      <td>
                        <ScoreBar score={m.score} />
                      </td>
                      <td className="small">
                        {m.factors
                          .slice(0, 2)
                          .map((f) => f.label)
                          .join(' | ')}
                      </td>
                      <td>
                        <Badge tone={m.vendor.preferredChannel === 'voice' ? 'info' : 'plain'}>
                          {m.vendor.preferredChannel === 'voice' ? 'Voice' : 'WhatsApp'}
                        </Badge>
                      </td>
                      <td className="nowrap">
                        {m.vendor.fleetSize} vehicles
                        <span className="td-sub">{m.vendor.availableVehicles} free now</span>
                      </td>
                      <td>{m.vendor.kycDone ? <Badge tone="success">Done</Badge> : <Badge tone="warning">Pending</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="attempt" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="spread">
                <span className="small muted">
                  {factorLabels.length > 0
                    ? `Scoring weights: ${factorLabels.map((f) => `${f.label.split(' (')[0]} ${f.weightPct}%`).join(', ')}`
                    : 'Scoring weights: availability 30%, reliability 30%, price 25%, response 15%'}
                </span>
                <button type="button" className="btn btn-sm" onClick={() => setShowExcluded((v) => !v)}>
                  {showExcluded ? 'Hide' : 'Show'} {match.excludedCount} vendors that did not qualify
                </button>
              </div>

              {showExcluded ? (
                <div className="table-wrap mt-2">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>Why excluded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {match.excluded.slice(0, 40).map((e) => (
                        <tr key={e.vendor.id}>
                          <td className="td-strong">{e.vendor.name}</td>
                          <td className="small muted">{e.reasons.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Outreach monitor"
        hint={
          attempts.length > 0
            ? 'Voice calls and WhatsApp messages sent by the AI agent, with raw replies as they arrive'
            : 'No outreach started for this requirement'
        }
        tight
      >
        {attempts.length === 0 ? (
          <EmptyState title="Nothing sent yet">
            Start AI outreach once the shortlist looks right.
          </EmptyState>
        ) : (
          attempts.map((a) => (
            <div className="attempt" key={a.id}>
              <div className="attempt-head">
                <span style={{ color: 'var(--muted)' }}>
                  <Icon name={a.channel === 'voice' ? 'phone' : 'message'} size={15} />
                </span>
                <span className="who">{a.vendorName}</span>
                <Badge tone="plain">{a.channel === 'voice' ? 'AI voice call' : 'WhatsApp'}</Badge>
                <Badge
                  tone={
                    a.status === 'replied'
                      ? 'success'
                      : a.status === 'no_response'
                        ? 'warning'
                        : a.status === 'in_progress'
                          ? 'info'
                          : 'neutral'
                  }
                >
                  {a.status === 'in_progress'
                    ? 'Calling'
                    : a.status === 'queued'
                      ? 'Queued'
                      : a.status === 'replied'
                        ? 'Replied'
                        : 'No response'}
                </Badge>
                <span className="time">
                  {a.startedAt ? `started ${formatTime(a.startedAt)}` : ''}
                  {a.repliedAt ? `, resolved ${formatTime(a.repliedAt)}` : ''}
                </span>
              </div>

              <div className="transcript">
                <div className="bubble out">
                  <span className="who">{a.channel === 'voice' ? 'Agent said' : 'Message sent'}</span>
                  {a.outbound}
                </div>
                {a.reply ? (
                  <div className="bubble">
                    <span className="who">Vendor reply, raw text</span>
                    {a.reply}
                  </div>
                ) : a.status === 'no_response' ? (
                  <div className="bubble">
                    <span className="who">Vendor reply</span>
                    <span className="muted">No reply inside the timeout. One reminder is logged, then the vendor is marked no response.</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Panel>

      <Panel
        title="Sarvam AI price enquiry"
        hint={`Instant outbound call from Sarvam Voice Agents, restricted to ${sarvam.vendorName} on ${sarvam.vendorPhone}`}
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <a
              href={`https://wa.me/91${sarvam.vendorPhone.replace(/[^0-9]/g, '').slice(-10)}?text=${encodeURIComponent(
                `Hello ${sarvam.vendorName}, we need a ${requirement.vehicleType.replace('_', ' ')} (${requirement.bodySizeFt} ft) for ${requirement.weightT} tonnes from ${requirement.origin} to ${requirement.destination}. Loading: ${requirement.loadingDate}, ${requirement.loadingTime}. Please reply with your best rate (Rs.) for this trip.`
              )}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              title={`Open WhatsApp chat with ${sarvam.vendorName}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Icon name="message" size={15} />
              WhatsApp {sarvam.vendorName}
            </a>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null || !sarvam.configured}
              onClick={() => void action('sarvam', () => api.post(`/api/requirements/${id}/sarvam-call`))}
            >
              {busy === 'sarvam' ? <span className="spinner" /> : <Icon name="phone" size={15} />}
              Call vendor for the rate
            </button>
          </div>
        }
        tight
      >
        {!sarvam.configured ? (
          <div className="attempt">
            <div className="error-banner">
              Sarvam AI is not configured, so no call can be placed. Add the Sarvam credentials to{' '}
              <code>.env</code> and restart the API.
            </div>
            <p className="small muted">
              Required: <code>SARVAM_API_KEY</code>, <code>SARVAM_ORG_ID</code>, <code>SARVAM_WORKSPACE_ID</code>,{' '}
              <code>SARVAM_APP_ID</code>, <code>SARVAM_CONNECTION_ID</code> and{' '}
              <code>SARVAM_AGENT_PHONE_NUMBER</code>. The model used for the script is <code>{sarvam.model}</code>.
            </p>
          </div>
        ) : sarvamCalls.length === 0 ? (
          <EmptyState title="No Sarvam call yet">
            The AI agent will call {sarvam.vendorName} on {sarvam.vendorPhone} and ask for the trip price, tolls and
            vehicle availability. The spoken answer is parsed into a quote here.
          </EmptyState>
        ) : (
          sarvamCalls.map((c) => (
            <div className="attempt" key={c.id}>
              <div className="attempt-head">
                <span style={{ color: 'var(--muted)' }}>
                  <Icon name="phone" size={15} />
                </span>
                <span className="who">{c.vendorName}</span>
                <Badge
                  tone={
                    c.status === 'connected'
                      ? 'success'
                      : c.status === 'queued'
                        ? 'info'
                        : c.status === 'failed' || c.status === 'busy' || c.status === 'no_answer'
                          ? 'warning'
                          : 'neutral'
                  }
                >
                  {SARVAM_STATUS_LABEL[c.status] ?? c.status}
                </Badge>
                <span className="time">
                  called {formatTime(c.createdAt)}
                  {c.durationSec !== null ? `, ${Math.round(c.durationSec)}s` : ''}
                  {c.quoteId ? `, quote ${c.quoteId}` : ''}
                </span>
              </div>

              <div className="transcript">
                <div className="bubble out">
                  <span className="who">Enquiry script</span>
                  {c.script}
                </div>
                {c.transcript ? (
                  <div className="bubble">
                    <span className="who">Call transcript</span>
                    <span style={{ whiteSpace: 'pre-line' }}>{c.transcript}</span>
                  </div>
                ) : c.failureReason ? (
                  <div className="bubble">
                    <span className="who">Call failed</span>
                    {c.failureReason}
                  </div>
                ) : (
                  <div className="bubble">
                    <span className="who">Call result</span>
                    <span className="muted">
                      Waiting for Sarvam to post the transcript to <code>/api/webhooks/sarvam</code>.
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </Panel>

      <Panel
        title="Quote comparison"
        hint={
          summary && summary.considered > 0
            ? `${summary.considered} usable quotes, ranked lowest first. Flagged quotes stay out of L1 until an agent verifies them.`
            : 'Parsed quotes will appear here as vendors reply'
        }
        actions={requirement.status === 'quoted' && summary?.l1 ? <Badge tone="success">L1 suggested</Badge> : null}
        tight
      >
        {quotes.length === 0 ? (
          <EmptyState title="No quotes yet">Quotes are parsed from replies and ranked automatically.</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="num">Rank</th>
                    <th>Vendor</th>
                    <th>Channel</th>
                    <th className="num">Quoted</th>
                    <th className="num">Normalised</th>
                    <th className="num">Confidence</th>
                    <th>Raw reply</th>
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const usable = quotes
                      .filter((q) => q.rate !== null && (q.flagReason === null || q.verified))
                      .sort((a, b) => a.normalisedRate - b.normalisedRate);
                    const rankOf = new Map(usable.map((q, i) => [q.id, i + 1]));
                    const flaggedFirst = [...quotes].sort((a, b) => {
                      const ar = rankOf.get(a.id) ?? 999;
                      const br = rankOf.get(b.id) ?? 999;
                      return ar - br;
                    });
                    return flaggedFirst.map((q) => {
                      const rank = rankOf.get(q.id);
                      return (
                        <tr key={q.id} className={rank === 1 ? 'rank-1' : undefined}>
                          <td className="num td-strong">{rank ?? 'excl'}</td>
                          <td className="td-strong">{q.vendorName}</td>
                          <td>
                            <Badge tone="plain">{q.channel === 'voice' ? 'Voice' : 'WhatsApp'}</Badge>
                          </td>
                          <td className="num">{rupees(q.rate)}</td>
                          <td className="num">
                            {rupees(q.normalisedRate)}
                            {q.tollAllowance > 0 ? <span className="td-sub">+{rupees(q.tollAllowance)} toll</span> : null}
                          </td>
                          <td className="num">{q.confidence.toFixed(2)}</td>
                          <td className="small" style={{ maxWidth: 320 }}>
                            {q.rawText}
                            {q.conditions.length > 0 ? <span className="td-sub">{q.conditions.join(', ')}</span> : null}
                          </td>
                          <td>
                            {q.flagReason && !q.verified ? (
                              <span className="btn-row">
                                <Badge tone="danger">Flagged</Badge>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={busy !== null}
                                  title={q.flagReason}
                                  onClick={() => void action(`verify-${q.id}`, () => api.post(`/api/quotes/${q.id}/verify`))}
                                >
                                  Verify
                                </button>
                              </span>
                            ) : q.verified ? (
                              <Badge tone="warning">Verified by agent</Badge>
                            ) : (
                              <Badge tone="success">Clean</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>

            <div className="attempt" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="grid-3">
                <div className="kv">
                  <div>
                    <div className="k">L1, lowest usable</div>
                    <div className="v strong">{rupees(summary?.l1?.normalisedRate ?? null)}</div>
                  </div>
                  <div>
                    <div className="k">L2</div>
                    <div className="v">{rupees(summary?.l2?.normalisedRate ?? null)}</div>
                  </div>
                </div>
                <div className="kv">
                  <div>
                    <div className="k">Average of top quotes</div>
                    <div className="v strong">{rupees(summary?.average ?? null)}</div>
                  </div>
                  <div>
                    <div className="k">Spread, max minus min</div>
                    <div className="v">{rupees(summary?.spread ?? null)}</div>
                  </div>
                </div>
                <div className="kv">
                  <div>
                    <div className="k">Suggested vendor</div>
                    <div className="v strong">{summary?.l1?.vendorName ?? 'Waiting for quotes'}</div>
                  </div>
                  <div>
                    <div className="k">Best channel seen</div>
                    <div className="v">{summary?.l1?.channel === 'voice' ? 'Voice' : 'WhatsApp'}</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Panel>

      {requirement.status === 'quoted' || requirement.status === 'awaiting_customer' ? (
        <Panel
          title="Customer pricing"
          hint="The agent adds margin on L1 and sends the price to the customer. AI never commits a price on its own."
        >
          <div className="inline-form">
            <div className="field" style={{ maxWidth: 160 }}>
              <label>Margin %</label>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={marginPct}
                onChange={(e) => setMarginPct(Number(e.target.value))}
              />
            </div>
            <div className="kv" style={{ minWidth: 260 }}>
              <div>
                <div className="k">Vendor rate, L1</div>
                <div className="v">{rupees(l1?.normalisedRate ?? null)}</div>
              </div>
              <div>
                <div className="k">Customer price</div>
                <div className="v strong">{rupees(previewCustomerPrice)}</div>
              </div>
            </div>
            {requirement.status === 'quoted' ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null || !l1}
                onClick={() => void action('pricing', () => api.post(`/api/requirements/${id}/pricing`, { marginPct }))}
              >
                {busy === 'pricing' ? <span className="spinner" /> : <Icon name="check" size={15} />}
                Save customer price
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-success"
                disabled={busy !== null}
                onClick={() => void action('confirm', () => api.post(`/api/requirements/${id}/confirm`))}
              >
                {busy === 'confirm' ? <span className="spinner" /> : <Icon name="truck" size={15} />}
                Customer confirmed, lock the vendor in
              </button>
            )}
          </div>
          {requirement.status === 'awaiting_customer' ? (
            <p className="small muted mt-2 mb-0">
              Customer price {rupees(summary?.customerPrice ?? null)} is ready to share. Clicking the button above
              re-contact the top three vendors at the L1 price.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {order ? (
        <Panel
          title="Confirmation tracker"
          hint={`Order ${order.id}, offered at ${rupees(order.l1Price)}. First valid acceptance wins.`}
          tight
        >
          {detail.lockInProgress ? (
            <div className="attempt">
              <span className="small muted">
                <span className="spinner" /> Offer sent to the top vendors, waiting for acceptance
              </span>
            </div>
          ) : null}
          {order.attempts.map((a) => (
            <div className="attempt" key={a.vendorId}>
              <div className="attempt-head">
                <span style={{ color: 'var(--muted)' }}>
                  <Icon name={a.channel === 'voice' ? 'phone' : 'message'} size={15} />
                </span>
                <span className="who">{a.vendorName}</span>
                <Badge
                  tone={
                    a.status === 'accepted'
                      ? 'success'
                      : a.status === 'job_filled'
                        ? 'neutral'
                        : a.status === 'no_response'
                          ? 'warning'
                          : 'info'
                  }
                >
                  {a.status === 'accepted'
                    ? 'Accepted'
                    : a.status === 'job_filled'
                      ? 'Job filled'
                      : a.status === 'no_response'
                        ? 'No response'
                        : 'Offered'}
                </Badge>
                <span className="time">{a.at ? formatTime(a.at) : ''}</span>
              </div>
              <div className="transcript">
                <div className="bubble out">
                  <span className="who">Message to vendor</span>
                  {a.message}
                </div>
                {a.status === 'accepted' && a.vehicleNo ? (
                  <div className="bubble">
                    <span className="who">Vehicle captured</span>
                    {a.vehicleNo}, driver {a.driverName}, {a.driverPhone}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </Panel>
      ) : null}

      {trip ? (
        <Panel
          title="Trip and payment"
          hint={`Trip ${trip.id} on ${trip.route}`}
          actions={
            <>
              {trip.status !== 'paid' ? (
                <>
                  {trip.status === 'vendor_confirmed' || trip.status === 'vehicle_assigned' || trip.status === 'dispatched' || trip.status === 'in_transit' ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() => void action('pod', () => api.post(`/api/trips/${trip.id}/pod`, { file: `POD_${trip.id}.pdf` }))}
                    >
                      <Icon name="file" size={15} />
                      {trip.podFile ? 'Proof of delivery attached' : 'Attach proof of delivery'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy !== null}
                    onClick={() => void action('advance', () => api.post(`/api/trips/${trip.id}/advance`))}
                  >
                    {busy === 'advance' ? <span className="spinner" /> : <Icon name="arrowRight" size={15} />}
                    {NEXT_TRIP_LABEL[trip.status] ?? 'Advance trip'}
                  </button>
                </>
              ) : invoice ? (
                <>
                  {invoice.vendorPayoutStatus !== 'paid' ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() =>
                        void action('payout', () =>
                          api.post(`/api/payments/${invoice.id}/payout`, {
                            status: invoice.vendorPayoutStatus === 'pending' ? 'approved' : 'paid',
                          }),
                        )
                      }
                    >
                      {invoice.vendorPayoutStatus === 'pending' ? 'Approve vendor payout' : 'Mark vendor paid'}
                    </button>
                  ) : (
                    <Badge tone="success">Vendor paid</Badge>
                  )}
                </>
              ) : null}
            </>
          }
        >
          <div className="grid-2">
            <div>
              <div className="kv mb-0">
                <div>
                  <div className="k">Vehicle</div>
                  <div className="v strong">{trip.vehicleNo}</div>
                </div>
                <div>
                  <div className="k">Driver</div>
                  <div className="v">
                    {trip.driver}
                    <span className="td-sub">{trip.driverPhone}</span>
                  </div>
                </div>
                <div>
                  <div className="k">Proof of delivery</div>
                  <div className="v">{trip.podFile ?? 'Not uploaded'}</div>
                </div>
                <div>
                  <div className="k">Customer price</div>
                  <div className="v strong">{rupees(order?.customerPrice ?? null)}</div>
                </div>
                <div>
                  <div className="k">Vendor payout</div>
                  <div className="v">{rupees(order?.l1Price ?? null)}</div>
                </div>
                <div>
                  <div className="k">Margin</div>
                  <div className="v">{rupees(order ? order.customerPrice - order.l1Price : null)}</div>
                </div>
              </div>

              {invoice ? (
                <div className={invoice.status === 'paid' ? 'callout success mt-3' : 'callout warning mt-3'}>
                  <strong>
                    Invoice {invoice.id}: {rupees(invoice.amount)}
                  </strong>
                  <div className="small mt-2">
                    Issued {formatDateTime(invoice.issuedAt)}, due {formatDateTime(invoice.dueDate)}.{' '}
                    {invoice.status === 'paid'
                      ? `Received ${invoice.paidOn ? formatDateTime(invoice.paidOn) : ''}.`
                      : 'Not received yet.'}{' '}
                    Vendor payout {invoice.vendorPayoutStatus}.
                  </div>
                  {invoice.status === 'unpaid' ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-success mt-2"
                      disabled={busy !== null}
                      onClick={() => void action('pay', () => api.post(`/api/payments/${invoice.id}/pay`))}
                    >
                      Record payment received
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="small muted mt-3 mb-0">The invoice is raised when the trip reaches the billed status.</p>
              )}
            </div>

            <ol className="timeline">
              {trip.events.map((e) => (
                <li key={e.status} className="done">
                  <div className="t-title">{e.status.replace(/_/g, ' ')}</div>
                  <div className="t-note">{e.note}</div>
                  <div className="t-time">{formatDateTime(e.at)}</div>
                </li>
              ))}
              {trip.status !== 'paid' ? (
                <li>
                  <div className="t-title muted">Next: {(NEXT_TRIP_LABEL[trip.status] ?? 'paid').toLowerCase()}</div>
                  <div className="t-time">Not yet</div>
                </li>
              ) : null}
            </ol>
          </div>
        </Panel>
      ) : null}

      {requirement.status === 'intake' && !match ? (
        <div className="callout info">
          <strong>This requirement has not been matched yet.</strong> Use Find vendors above to run the filters and
          scoring model, then start AI outreach.
        </div>
      ) : null}
    </>
  );
}
