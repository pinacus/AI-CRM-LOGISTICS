import type { ReactNode } from 'react';
import { REQUIREMENT_STATUS_LABEL, REQUIREMENT_STATUS_TONE } from '../api';

/* --------------------------------------------------------------- icons */
/* Stroke icons only, no emoji anywhere in the interface. */

export type IconName =
  | 'grid'
  | 'clipboard'
  | 'truck'
  | 'rupee'
  | 'users'
  | 'table'
  | 'plus'
  | 'search'
  | 'check'
  | 'clock'
  | 'alert'
  | 'arrowRight'
  | 'message'
  | 'phone'
  | 'file'
  | 'route'
  | 'shield';

const PATHS: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 3h6v3H9z" />
      <path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  truck: (
    <>
      <path d="M3 16V7a1 1 0 0 1 1-1h10v10" />
      <path d="M14 9h4l3 3v4h-3" />
      <circle cx="7.5" cy="17.5" r="1.8" />
      <circle cx="17.5" cy="17.5" r="1.8" />
    </>
  ),
  rupee: (
    <>
      <path d="M7 4h10M7 8h10M7 12h5a4 4 0 0 0 0-8" />
      <path d="M7 12l8 8" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6M17 14.4a5.2 5.2 0 0 1 3.5 4.6" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9h18M9 9v11" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  check: <path d="M5 13l4 4L19 7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.8" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  message: <path d="M4 5h16v11H9l-5 4z" />,
  phone: <path d="M6 3h4l1.5 4-2 1.5a11 11 0 0 0 5 5L16 11.5 20 13v4a2 2 0 0 1-2 2A15 15 0 0 1 4 5a2 2 0 0 1 2-2z" />,
  file: (
    <>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
      <path d="M14 3v4h4" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <path d="M8.4 18H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.6" />
    </>
  ),
  shield: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="5" fill="#1d2733" />
      <path d="M5 21h9" stroke="#7fb3a2" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M18 21h9" stroke="#7fb3a2" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="21" r="3" fill="#ffffff" />
      <rect x="7" y="7" width="18" height="7" rx="1.5" fill="#ffffff" />
      <rect x="10" y="9.5" width="4" height="2" rx="0.6" fill="#1d2733" />
    </svg>
  );
}

/* ------------------------------------------------------------ primitives */

export type Tone = 'neutral' | 'plain' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const cls = tone === 'neutral' ? 'badge' : `badge ${tone}`;
  return <span className={cls}>{children}</span>;
}

export function RequirementStatusBadge({ status }: { status: string }) {
  const tone = REQUIREMENT_STATUS_TONE[status] ?? 'neutral';
  return <Badge tone={tone === 'neutral' ? 'neutral' : tone}>{REQUIREMENT_STATUS_LABEL[status] ?? status}</Badge>;
}

export function Panel({
  title,
  hint,
  actions,
  children,
  tight,
  id,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tight?: boolean;
  id?: string;
}) {
  return (
    <section className="panel" id={id}>
      {title ? (
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {hint ? <div className="hint">{hint}</div> : null}
          </div>
          {actions ? <div className="btn-row">{actions}</div> : null}
        </div>
      ) : null}
      <div className={tight ? 'panel-body tight' : 'panel-body'}>{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  note,
  small,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  small?: boolean;
}) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className={small ? 'value small' : 'value'}>{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

export function Field({
  label,
  children,
  help,
  error,
}: {
  label: string;
  children: ReactNode;
  help?: ReactNode;
  error?: boolean;
}) {
  return (
    <div className={error ? 'field error' : 'field'}>
      <label>{label}</label>
      {children}
      {help ? <span className="help">{help}</span> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const good = score >= 75;
  return (
    <div className="score-bar">
      <div className="track">
        <div className={good ? 'fill good' : 'fill'} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </div>
      <span className="val">{score.toFixed(1)}</span>
    </div>
  );
}
