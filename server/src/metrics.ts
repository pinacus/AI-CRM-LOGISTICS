import type { DashboardMetrics, Requirement } from '../../shared/types';
import { quotesFor, attemptsFor, orderFor, type Store } from './store';

const OPEN_STATUSES: Requirement['status'][] = ['intake', 'shortlisted', 'outreach', 'quoted', 'awaiting_customer', 'locking'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Every number on the dashboard is computed from the data in this process.
 * There are no placeholder or marketing figures anywhere in this build.
 */
export function computeMetrics(store: Store): DashboardMetrics {
  const openRequirements = store.requirements.filter((r) => OPEN_STATUSES.includes(r.status)).length;

  const quotesReceived = store.quotes.length;

  // Requirement logged until the last quote for it arrived (the L1 suggestion point).
  const durations: number[] = [];
  for (const req of store.requirements) {
    const quotes = quotesFor(store, req.id);
    if (quotes.length === 0) continue;
    const lastQuote = quotes.reduce((max, q) => (q.receivedAt > max ? q.receivedAt : max), quotes[0]?.receivedAt ?? req.createdAt);
    const mins = (new Date(lastQuote).getTime() - new Date(req.createdAt).getTime()) / 60000;
    if (mins >= 0) durations.push(mins);
  }
  const avgMinutesToL1 = durations.length > 0 ? round1(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const instantPriceHits = store.requirements.filter((r) => r.rateCardMatch === 'exact').length;

  const tripsInTransit = store.trips.filter((t) => t.status === 'dispatched' || t.status === 'in_transit').length;

  const receivableOutstanding = store.invoices.filter((i) => i.status === 'unpaid').reduce((sum, i) => sum + i.amount, 0);
  const payableOutstanding = store.invoices
    .filter((i) => i.vendorPayoutStatus !== 'paid')
    .reduce((sum, i) => sum + i.vendorPayout, 0);
  const marginBooked = store.invoices.reduce((sum, i) => sum + i.margin, 0);

  const attempts = store.attempts;
  const responded = attempts.filter((a) => a.status === 'replied').length;
  const responseRatePct = attempts.length > 0 ? round1((responded / attempts.length) * 100) : null;

  return {
    openRequirements,
    quotesReceived,
    avgMinutesToL1,
    instantPriceHits,
    tripsInTransit,
    receivableOutstanding,
    payableOutstanding,
    marginBooked,
    responseRatePct,
    rateCardRows: store.rateCard.length,
    vendorCount: store.vendors.length,
  };
}

export function outreachInProgress(store: Store, reqId: string): boolean {
  const attempts = attemptsFor(store, reqId);
  return attempts.length > 0 && attempts.some((a) => a.status === 'queued' || a.status === 'in_progress');
}

export function lockInProgress(store: Store, reqId: string): boolean {
  const order = orderFor(store, reqId);
  return order !== undefined && order.status === 'locking';
}
