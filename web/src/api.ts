import type {
  DashboardMetrics,
  Invoice,
  Order,
  OutreachAttempt,
  Quote,
  QuoteSummary,
  RateCardRow,
  RateLookupInput,
  RateLookupResult,
  Requirement,
  SarvamCall,
  Trip,
  TripStatus,
  Vendor,
  VendorMatch,
} from '../../shared/types';

export interface ExcludedEntry {
  vendor: { id: number; name: string; active: boolean; kycDone: boolean };
  reasons: string[];
}

export interface SarvamReadiness {
  configured: boolean;
  vendorName: string;
  vendorPhone: string;
  model: string;
}

export interface RequirementDetail {
  requirement: Requirement;
  match: {
    limit: number;
    matched: VendorMatch[];
    excludedCount: number;
    excluded: ExcludedEntry[];
  } | null;
  attempts: OutreachAttempt[];
  quotes: Quote[];
  summary: QuoteSummary;
  order: Order | null;
  trip: Trip | null;
  invoice: Invoice | null;
  outreachRunning: boolean;
  lockInProgress: boolean;
  sarvamCalls: SarvamCall[];
  sarvam: SarvamReadiness;
  started?: number;
}

export interface RequirementListItem extends Requirement {
  quoteCount: number;
  shortlistSize: number;
  attemptCount: number;
  orderId: string | null;
  tripStatus: TripStatus | null;
}

export interface TripListItem extends Trip {
  statusLabel: string;
}

export interface PaymentRow extends Invoice {
  daysToDue: number;
}

export interface PaymentsResponse {
  rows: PaymentRow[];
  summary: {
    receivableOutstanding: number;
    payableOutstanding: number;
    marginBooked: number;
  };
}

export interface ListResponse<T> {
  total: number;
  rows: T[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  });
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    // The session expired or was revoked; send the user back to the login page.
    window.location.assign('/login');
    throw new Error('Sign in required');
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      // response had no JSON body
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
};

/* ------------------------------------------------------------- formatting */

export function rupees(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `Rs. ${Math.round(value).toLocaleString('en-IN')}`;
}

export function plainNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return Math.round(value).toLocaleString('en-IN');
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

export function minutesSince(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

export const VEHICLE_LABELS: Record<string, string> = {
  open_truck: 'Open truck',
  container: 'Container',
  trailer: 'Trailer',
};

export const REQUIREMENT_STATUS_LABEL: Record<string, string> = {
  intake: 'Intake',
  shortlisted: 'Shortlisted',
  outreach: 'AI outreach running',
  quoted: 'Quotes received',
  awaiting_customer: 'Priced for customer',
  locking: 'Vendor lock-in',
  confirmed: 'Confirmed',
  closed: 'Closed',
};

export const REQUIREMENT_STATUS_TONE: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  intake: 'neutral',
  shortlisted: 'info',
  outreach: 'info',
  quoted: 'warning',
  awaiting_customer: 'warning',
  locking: 'info',
  confirmed: 'success',
  closed: 'neutral',
};

export type { DashboardMetrics, Order, Quote, QuoteSummary, RateCardRow, RateLookupInput, RateLookupResult, Requirement, SarvamCall, Trip, Vendor, VendorMatch };
