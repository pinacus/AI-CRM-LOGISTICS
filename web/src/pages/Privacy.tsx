import { Link } from 'react-router-dom';
import { Logo } from '../components/ui';

export default function Privacy() {
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
            <Link to="/terms">Terms</Link>
            <Link to="/app" className="btn btn-primary btn-sm">
              Open the demo
            </Link>
          </nav>
        </div>
      </div>

      <div className="landing-wrap legal-copy">
        <h1>Privacy policy</h1>
        <p className="muted">Applies to this build. Last updated 6 October 2026.</p>

        <h2>What this build is</h2>
        <p>
          FreightDesk is a working build for requirement to payment automation in freight brokerage. It runs
          locally: accounts, requirements, quotes, trips and payments are stored in a SQLite database file on the
          machine hosting it. Nothing in this build is connected to a production CRM, a telephony provider or a
          WhatsApp Business account.
        </p>

        <h2>Data it holds</h2>
        <ul>
          <li>
            Sample customer records: company name, contact person, GST number and credit terms. These are invented
            for the demo.
          </li>
          <li>
            Sample vendor records: company name, phone and WhatsApp numbers in the format of Indian mobile numbers,
            operating hubs and corridors, fleet details and past performance figures. All invented for the demo.
          </li>
          <li>
            Requirement, quote, trip and invoice records created while you click through the demo.
          </li>
        </ul>
        <p>
          No real person's personal data is processed. If you type your own details into a field, they stay in the
          local database file on this machine.
        </p>

        <h2>Voice calls and messages</h2>
        <p>
          By default the AI voice agent and the WhatsApp messages are simulated inside the API process: no
          call is placed and no message is delivered until provider credentials are configured. Simulated message
          bodies and reply texts are generated locally and no transcript leaves the machine. With credentials
          configured, outbound messages go to the provider and replies come back through the webhook endpoint.
        </p>

        <h2>Storage, retention and deletion</h2>
        <p>
          Data lives in a SQLite file (data/freightdesk.db) next to the server code. Restarting the API keeps
          everything: records load back from the file. There is no cloud copy and no automatic backup, so copy the
          file if the data matters. Delete the file to reset to the seeded sample data.
        </p>

        <h2>Cookies, analytics and third parties</h2>
        <p>
          The build sets one cookie: the HttpOnly session cookie that keeps you signed in, which expires after the
          configured session lifetime. It loads no analytics, no fonts and no scripts from third parties. The only
          network calls the browser makes are to the API serving this page.
        </p>

        <h2>Your rights</h2>
        <p>
          Records live in the local database. An administrator can deactivate an account, reset a password or remove
          the database file on request, and the audit trail shows who did what. A future release will add a defined
          retention window for transcripts and call recordings.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy or the build go to the project team through the channel this build
          was shared with. Material changes will be recorded with a new date at the top of this page.
        </p>

        <p className="mt-3">
          <Link to="/">Back to the product overview</Link>
        </p>
      </div>
    </>
  );
}
