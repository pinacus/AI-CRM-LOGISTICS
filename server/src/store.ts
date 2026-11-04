import type {
  Invoice,
  MatchResult,
  Order,
  OutreachAttempt,
  Quote,
  RateCardRow,
  Requirement,
  SarvamCall,
  Trip,
  Vendor,
} from '../../shared/types';

export interface Customer {
  id: string;
  name: string;
  contact: string;
  gstNo: string;
  creditTermsDays: number;
}

export interface Store {
  customers: Customer[];
  vendors: Vendor[];
  rateCard: RateCardRow[];
  requirements: Requirement[];
  matches: Record<string, MatchResult>;
  attempts: OutreachAttempt[];
  quotes: Quote[];
  calls: SarvamCall[];
  orders: Order[];
  trips: Trip[];
  invoices: Invoice[];
  counters: {
    requirement: number;
    attempt: number;
    quote: number;
    sarvamCall: number;
    order: number;
    trip: number;
    invoice: number;
  };
}

export function newStore(): Store {
  return {
    customers: [],
    vendors: [],
    rateCard: [],
    requirements: [],
    matches: {},
    attempts: [],
    quotes: [],
    calls: [],
    orders: [],
    trips: [],
    invoices: [],
    counters: { requirement: 1006, attempt: 0, quote: 0, sarvamCall: 0, order: 0, trip: 0, invoice: 0 },
  };
}

export function getRequirement(store: Store, id: string): Requirement | undefined {
  return store.requirements.find((r) => r.id === id);
}

export function getMatch(store: Store, reqId: string): MatchResult | undefined {
  return store.matches[reqId];
}

export function attemptsFor(store: Store, reqId: string): OutreachAttempt[] {
  return store.attempts.filter((a) => a.requirementId === reqId);
}

export function quotesFor(store: Store, reqId: string): Quote[] {
  return store.quotes.filter((q) => q.requirementId === reqId);
}

export function orderFor(store: Store, reqId: string): Order | undefined {
  return store.orders.find((o) => o.requirementId === reqId);
}

export function tripForOrder(store: Store, orderId: string): Trip | undefined {
  return store.trips.find((t) => t.orderId === orderId);
}

export function invoiceForOrder(store: Store, orderId: string): Invoice | undefined {
  return store.invoices.find((i) => i.orderId === orderId);
}

export function customerByName(store: Store, name: string): Customer | undefined {
  return store.customers.find((c) => c.name === name);
}
