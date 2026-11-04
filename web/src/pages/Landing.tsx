import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rupees, type DashboardMetrics } from '../api';
import { Icon, Logo } from '../components/ui';

const OBJECTIVES: { title: string; body: string }[] = [
  {
    title: 'Shortlist vendors automatically',
    body: 'Every requirement is filtered against about 15 attributes: origin, corridor, vehicle type, body size, axle, capacity, cargo and more, then ranked with a weighted score.',
  },
  {
    title: 'Collect quotes without manual calls',
    body: 'An AI voice call and a WhatsApp message go to the shortlisted transporters at the same time. The sales agent does not dial anyone.',
  },
  {
    title: 'Suggest the lowest rate',
    body: 'Replies are parsed into numbers, normalised so toll exclusive quotes compare fairly, and ranked L1 to L5 with the average and spread on one screen.',
  },
  {
    title: 'Lock the vendor in after confirmation',
    body: 'Once the customer confirms, the top three vendors are re-contacted at the final L1 price. First valid acceptance wins, the rest get a job filled message.',
  },
  {
    title: 'Track trip, invoice and payment together',
    body: 'Dispatch, transit, delivery with proof of delivery, billing, receipt and vendor payout live on one timeline instead of scattered sheets and chats.',
  },
  {
    title: 'Answer frequent routes instantly',
    body: 'About 300 pre-fed rate card rows cover the estates the business quotes daily, so Ambattur to Bengaluru can be answered without contacting a single vendor.',
  },
];

const FLOW: { step: string; detail: string }[] = [
  { step: 'Requirement intake', detail: 'Customer, route, cargo, weight, vehicle type and loading date are logged in the CRM.' },
  { step: 'Instant price check', detail: 'The rate card is searched. An exact hit returns a reference price immediately.' },
  { step: 'Vendor shortlisting', detail: 'Hard filters remove vendors who cannot do the job, a weighted score ranks the rest.' },
  { step: 'AI outreach', detail: 'Voice calls and WhatsApp messages go out to the top vendors in parallel.' },
  { step: 'Quote capture', detail: 'Replies are transcribed and parsed into a numeric rate with a confidence score.' },
  { step: 'L1 suggestion', detail: 'Average, lowest and spread are computed. Low confidence or extreme rates are flagged.' },
  { step: 'Customer quote', detail: 'The agent adds margin, shares the price, and marks the customer confirmed.' },
  { step: 'Vendor lock-in', detail: 'Top vendors are offered the final price, vehicle and driver details are captured.' },
  { step: 'Execution and payment', detail: 'Trip statuses, proof of delivery, invoice, receipt and payout update on one board.' },
];

const SCREENS: { to: string; title: string; body: string }[] = [
  { to: '/app', title: 'Dashboard', body: 'Open requirements, response rate, time to L1, receivables and payables, all computed from the data in the running process.' },
  { to: '/app/requirements/new', title: 'New requirement', body: 'The intake form, with the rate card answer appearing as soon as route and weight are filled in.' },
  { to: '/app/requirements', title: 'Requirements', body: 'Every logged requirement with its stage, shortlist size, quote count and trip status.' },
  { to: '/app/trips', title: 'Trip board', body: 'Kanban across vendor confirmed, dispatched, in transit, delivered, billed and paid.' },
  { to: '/app/payments', title: 'Payments', body: 'Receivables against customers, payouts against vendors, and margin booked per trip.' },
  { to: '/app/vendors', title: 'Vendors', body: 'The vendor master with all matching attributes, KYC state and preferred channel.' },
  { to: '/app/ratecard', title: 'Rate card', body: 'The pre-fed standard rates, searchable by route, with validity dates.' },
];

export default function Landing() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    api
      .get<DashboardMetrics>('/api/metrics')
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, []);

  return (
    <>
      <div className="landing-top">
        <div className="inner">
          <Link to="/" className="brand">
            <Logo />
            FreightDesk
          </Link>
          <nav className="landing-nav">
            <a href="#workflow">Workflow</a>
            <a href="#screens">Screens</a>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/app" className="btn btn-primary btn-sm">
              Open the demo
            </Link>
          </nav>
        </div>
      </div>

      <div className="landing-wrap">
        <div className="hero">
          <h1>From customer requirement to confirmed vendor, without the sales agent making a single call.</h1>
          <p className="lead">
            FreightDesk is a working MVP for freight brokerage in South India. It matches transporters
            against your vendor master, sends an AI voice call and a WhatsApp message asking for their rate,
            parses the replies, suggests the lowest rate to your sales agent, then carries the job through trip,
            invoice and payment in the same record.
          </p>
          <div className="btn-row">
            <Link to="/app" className="btn btn-primary">
              Open the demo dashboard
              <Icon name="arrowRight" size={15} />
            </Link>
            <Link to="/app/requirements/new" className="btn">
              Log a requirement
            </Link>
          </div>
        </div>

        <div className="facts">
          <span>
            <b>{metrics ? metrics.vendorCount : '...'}</b> vendors in the master
          </span>
          <span>
            <b>{metrics ? metrics.rateCardRows : '...'}</b> rate card rows
          </span>
          <span>
            <b>{metrics ? metrics.quotesReceived : '...'}</b> quotes parsed
          </span>
          <span>
            <b>{metrics && metrics.avgMinutesToL1 !== null ? metrics.avgMinutesToL1 : '...'}</b> minutes average from
            requirement to L1
          </span>
          <span>
            <b>{metrics && metrics.responseRatePct !== null ? metrics.responseRatePct : '...'}</b>% vendor response
            rate to AI outreach
          </span>
        </div>

        <section className="landing-section mt-3" id="objectives">
          <h2>What the product does</h2>
          <p className="section-note">
            Six objectives from the product scope, each one visible as a screen in this build.
          </p>
          <div className="obj-grid">
            {OBJECTIVES.map((o, i) => (
              <div className="obj" key={o.title}>
                <span className="n">O{i + 1}</span>
                <h3>{o.title}</h3>
                <p>{o.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section" id="workflow">
          <h2>The workflow this build runs end to end</h2>
          <p className="section-note">
            The same eleven step flow, collapsed to what a working day in operations actually clicks through.
          </p>
          <ol className="flow-list">
            {FLOW.map((f) => (
              <li key={f.step}>
                <strong>{f.step}:</strong>&nbsp;<span>{f.detail}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section" id="screens">
          <h2>Screens in this build</h2>
          <p className="section-note">Every link below opens real data served by the API running next to this page.</p>
          <div className="screen-links">
            {SCREENS.map((s) => (
              <Link className="screen-link" to={s.to} key={s.to}>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="landing-section" id="simulated">
          <h2>What is simulated, stated plainly</h2>
          <div className="callout warning">
            <strong>Telephony and WhatsApp run in simulation mode until credentials are added.</strong> No real
            transporter is called or messaged until a Twilio account and an approved WhatsApp Business number are
            configured. The attempt states, timers and message bodies are the same code either way: adding
            credentials switches sends to the live providers, and replies arrive on the webhook.
          </div>
          <div className="callout info">
            <strong>The quote parser is real, not scripted.</strong> Replies such as &quot;38500, toll extra&quot;,
            &quot;rate 41k&quot; and &quot;Rs. 39,500&quot; go through a rules parser that returns a rate, conditions and a
            confidence score. Replies under 0.80 confidence, or more than 30% away from the rate card reference, are
            flagged for a sales agent before they can reach L1.
          </div>
          <div className="callout">
            <strong>All figures on the dashboard are computed from the running data.</strong> Vendor counts, response
            rate, minutes to L1, receivables and margin are summed from the records in the database. Nothing is a marketing
            number.
          </div>
        </section>
      </div>

      <footer className="landing-footer">
        <div className="inner">
          <span>FreightDesk MVP v1.0. Data stored locally in SQLite.</span>
          <span>
            <Link to="/privacy">Privacy policy</Link>
            <Link to="/terms">Terms and conditions</Link>
            <Link to="/app">Open the console</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
