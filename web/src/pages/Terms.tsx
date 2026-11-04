import { Link } from 'react-router-dom';
import { Logo } from '../components/ui';

export default function Terms() {
  return (
    <>
      <div className="landing-top">
        <div className="inner">
          <Link to="/" className="brand">
            <Logo />
            FreightDesk
          </Link>
          <nav className="landing-nav">
            <Link to="/">Product overview</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/app" className="btn btn-primary btn-sm">
              Open the demo
            </Link>
          </nav>
        </div>
      </div>

      <div className="landing-wrap legal-copy">
        <h1>Terms and conditions</h1>
        <p className="muted">Applies to this build. Last updated 6 October 2026.</p>

        <h2>1. Nature of the build</h2>
        <p>
          FreightDesk is version 1.0 of a working build, provided for evaluation. It is not offered for sale, and
          it comes with no service level, support commitment or availability guarantee. Vendor records and rate
          card figures are sample data and must not be treated as market rates.
        </p>

        <h2>2. Acceptable use</h2>
        <p>
          Use it to evaluate the workflow: intake, matching, outreach, quoting, lock-in,
          trips and payments. Do not enter real customer or vendor personal data, and do not expose the server to the
          public internet in this state.
        </p>

        <h2>3. AI outputs need a human</h2>
        <p>
          The system suggests, a person decides. Parsed rates with low confidence or rates far from the rate card
          reference are flagged and are excluded from the L1 suggestion until a sales agent verifies them. The agent
          sets margin and the customer price. The AI never commits to a customer or a vendor on its own.
        </p>

        <h2>4. Simulated channels</h2>
        <p>
          Voice calls and WhatsApp messages are simulated unless provider credentials are configured. A production
          rollout needs an approved
          WhatsApp Business number, telephony consent and recording rules, and compliance with TRAI regulations on
          commercial communication and do not disturb requests, plus vendor consent captured at onboarding.
        </p>

        <h2>5. Accuracy of data</h2>
        <p>
          Vendor attributes, rate card rows and performance figures are generated sample data. Rates, distances and
          response rates shown anywhere in the interface are computed from that sample, not from a live market feed.
        </p>

        <h2>6. Liability</h2>
        <p>
          To the extent permitted by law, the authors of this build accept no liability for decisions
          taken on its output, for revenue lost while evaluating it, or for misuse of the sample data.
        </p>

        <h2>7. Changes</h2>
        <p>
          This build changes during evaluation. New terms will carry a revised date at the top of this page. Continued
          use after a revision means acceptance of the revised terms.
        </p>

        <h2>8. Governing law</h2>
        <p>
          These terms are governed by the laws of India, with courts in Chennai having jurisdiction, matching the
          operating region of the brokerage this product was written for.
        </p>

        <p className="mt-3">
          <Link to="/">Back to the product overview</Link>
        </p>
      </div>
    </>
  );
}
