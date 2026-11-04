import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  formatDateTime,
  REQUIREMENT_STATUS_LABEL,
  rupees,
  type RequirementListItem,
} from "../api";
import {
  EmptyState,
  Icon,
  Panel,
  RequirementStatusBadge,
} from "../components/ui";

const FILTERS = ["all", "open", "confirmed", "closed"] as const;
type Filter = (typeof FILTERS)[number];

const OPEN = new Set([
  "intake",
  "shortlisted",
  "outreach",
  "quoted",
  "awaiting_customer",
  "locking",
]);

export default function Requirements() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RequirementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<RequirementListItem[]>("/api/requirements")
      .then(setRows)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "open" && !OPEN.has(r.status)) return false;
      if (
        filter === "confirmed" &&
        !(r.status === "confirmed" || r.status === "closed")
      )
        return false;
      if (filter === "closed" && r.status !== "closed") return false;
      if (q.length === 0) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.origin.toLowerCase().includes(q) ||
        r.destination.toLowerCase().includes(q) ||
        REQUIREMENT_STATUS_LABEL[r.status]?.toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Requirements</h1>
          <div className="sub">
            Customer freight requirements logged in the CRM, with the stage each
            one has reached.
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

      <Panel
        title="All requirements"
        hint={`${visible.length} of ${rows.length} shown`}
        actions={
          <>
            <input
              className="search"
              placeholder="Search id, customer, route or status"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search requirements"
            />
            <div className="btn-row">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={
                    filter === f ? "btn btn-sm btn-primary" : "btn btn-sm"
                  }
                  onClick={() => setFilter(f)}
                >
                  {f === "all"
                    ? "All"
                    : f === "open"
                      ? "Open"
                      : f === "confirmed"
                        ? "Confirmed"
                        : "Closed"}
                </button>
              ))}
            </div>
          </>
        }
        tight
      >
        {loading ? (
          <div className="empty">Loading requirements...</div>
        ) : visible.length === 0 ? (
          <EmptyState title="No requirements match">
            Clear the search, or log a new requirement.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Route</th>
                  <th>Load</th>
                  <th>Status</th>
                  <th className="num">Shortlist</th>
                  <th className="num">Quotes</th>
                  <th>Trip</th>
                  <th>Logged</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.id}
                    className="row-click"
                    onClick={() => navigate(`/app/requirements/${r.id}`)}
                  >
                    <td className="td-strong">
                      {r.id}
                      <span className="td-sub">{r.customerName}</span>
                    </td>
                    <td>
                      {r.origin} to {r.destination}
                      <span className="td-sub">
                        Loading {r.loadingDate} {r.loadingTime}
                      </span>
                    </td>
                    <td className="nowrap">
                      {r.weightT} T
                      <span className="td-sub">
                        {r.bodySizeFt} ft, {r.axle} axle
                      </span>
                    </td>
                    <td>
                      <RequirementStatusBadge status={r.status} />
                    </td>
                    <td className="num">{r.shortlistSize || "-"}</td>
                    <td className="num">
                      {r.quoteCount}
                      {r.rateCardMatch === "exact" ? (
                        <span className="td-sub">rate card hit</span>
                      ) : null}
                    </td>
                    <td className="nowrap">{r.tripStatus ?? "-"}</td>
                    <td className="nowrap">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
