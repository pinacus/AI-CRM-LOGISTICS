/**
 * Shared types between the Express API and the React client.
 * Only type imports are used from the client so nothing is emitted at runtime.
 */

export type VehicleType = 'open_truck' | 'container' | 'trailer';
export type Axle = 'single' | 'multi';
export type CargoType = 'General' | 'FMCG' | 'Auto parts' | 'Pharma' | 'Textiles' | 'ODC' | 'Chemicals';
export type Channel = 'voice' | 'whatsapp';

export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  open_truck: 'Open truck',
  container: 'Container',
  trailer: 'Trailer',
};

export const CARGO_TYPES: CargoType[] = ['General', 'FMCG', 'Auto parts', 'Pharma', 'Textiles', 'ODC', 'Chemicals'];

export const WEIGHT_BANDS = ['0-3 T', '3-5 T', '5-9 T', '9-16 T', '16+ T'] as const;
export type WeightBand = (typeof WEIGHT_BANDS)[number];

export function weightBandFor(weightT: number): WeightBand {
  if (weightT <= 3) return '0-3 T';
  if (weightT <= 5) return '3-5 T';
  if (weightT < 9) return '5-9 T';
  if (weightT <= 16) return '9-16 T';
  return '16+ T';
}

/* ------------------------------------------------------------------ vendors */

export interface Vendor {
  id: number;
  name: string;
  phone: string;
  whatsapp: string;
  /** cities or estates the vendor loads from */
  origins: string[];
  /** destinations the vendor runs on */
  corridors: string[];
  vehicleTypes: VehicleType[];
  bodySizes: number[];
  axles: Axle[];
  /** largest vehicle the vendor can send */
  maxCapacityT: number;
  cargoTypes: CargoType[];
  fleetSize: number;
  availableVehicles: number;
  rating: number;
  onTimePct: number;
  /** negative means cheaper than market */
  avgRateVsMarketPct: number;
  avgResponseMins: number;
  preferredChannel: Channel | 'both';
  paymentTermsDays: number;
  kycDone: boolean;
  active: boolean;
}

/* ------------------------------------------------------------- requirements */

export type RequirementStatus =
  | 'intake'
  | 'shortlisted'
  | 'outreach'
  | 'quoted'
  | 'awaiting_customer'
  | 'locking'
  | 'confirmed'
  | 'closed';

export interface Requirement {
  id: string;
  customerName: string;
  origin: string;
  destination: string;
  cargo: CargoType;
  weightT: number;
  vehicleType: VehicleType;
  bodySizeFt: number;
  axle: Axle;
  loadingDate: string;
  loadingTime: string;
  notes: string;
  status: RequirementStatus;
  createdAt: string;
  rateCardRate: number | null;
  rateCardMatch: 'exact' | 'nearest' | 'none';
  rateCardNote: string;
  marginPct: number | null;
  l1QuoteId: string | null;
}

export interface RequirementInput {
  customerName: string;
  origin: string;
  destination: string;
  cargo: CargoType;
  weightT: number;
  vehicleType: VehicleType;
  bodySizeFt: number;
  axle: Axle;
  loadingDate: string;
  loadingTime: string;
  notes?: string;
}

/* ---------------------------------------------------------------- matching */

export interface MatchFactor {
  label: string;
  weightPct: number;
  score: number;
}

export interface VendorMatch {
  vendor: Vendor;
  rank: number | null;
  score: number;
  factors: MatchFactor[];
}

export interface MatchResult {
  requirementId: string;
  matched: VendorMatch[];
  excluded: { vendor: Vendor; reasons: string[] }[];
  limit: number;
}

/* --------------------------------------------------------------- outreach */

export type OutreachStatus = 'queued' | 'in_progress' | 'replied' | 'no_response';

export interface OutreachAttempt {
  id: string;
  requirementId: string;
  vendorId: number;
  vendorName: string;
  channel: Channel;
  status: OutreachStatus;
  /** outbound script or WhatsApp body that was sent */
  outbound: string;
  /** raw inbound reply (voice transcript or WhatsApp text) */
  reply: string | null;
  startedAt: string | null;
  repliedAt: string | null;
}

/* ------------------------------------------------------------ Sarvam calls */

export type SarvamCallStatus = 'queued' | 'connected' | 'no_answer' | 'busy' | 'failed';

/** One AI price enquiry call placed through the Sarvam Voice Agents API. */
export interface SarvamCall {
  id: string;
  /** Sarvam attempt id, echoed back on the call webhook */
  attemptId: string | null;
  requirementId: string;
  vendorId: number;
  vendorName: string;
  phone: string;
  /** script the Sarvam agent follows on the call */
  script: string;
  status: SarvamCallStatus;
  interactionId: string | null;
  durationSec: number | null;
  failureReason: string | null;
  transcript: string | null;
  quoteId: string | null;
  createdAt: string;
  completedAt: string | null;
}

/* ------------------------------------------------------------------ quotes */

export interface Quote {
  id: string;
  requirementId: string;
  vendorId: number;
  vendorName: string;
  rate: number | null;
  tollIncluded: boolean;
  availableOnDate: boolean | null;
  conditions: string[];
  channel: Channel;
  rawText: string;
  confidence: number;
  receivedAt: string;
  /** flagged when confidence is low or the rate is far from the rate card */
  flagReason: string | null;
  verified: boolean;
  /** toll allowance applied so quotes are comparable, 0 when toll is included */
  tollAllowance: number;
  normalisedRate: number;
}

export interface QuoteSummary {
  requirementId: string;
  quotes: Quote[];
  considered: number;
  average: number | null;
  l1: Quote | null;
  l2: Quote | null;
  spread: number | null;
  customerPrice: number | null;
  marginPct: number | null;
}

/* ------------------------------------------------------- orders and trips */

export type LockInStatus = 'offered' | 'accepted' | 'job_filled' | 'no_response';

export interface LockInAttempt {
  vendorId: number;
  vendorName: string;
  channel: Channel;
  status: LockInStatus;
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  at: string | null;
  message: string;
}

export type OrderStatus = 'locking' | 'confirmed' | 'stalled';

export interface Order {
  id: string;
  requirementId: string;
  vendorId: number | null;
  vendorName: string | null;
  l1Price: number;
  customerPrice: number;
  marginPct: number;
  status: OrderStatus;
  attempts: LockInAttempt[];
  createdAt: string;
}

export type TripStatus =
  | 'vendor_confirmed'
  | 'vehicle_assigned'
  | 'dispatched'
  | 'in_transit'
  | 'delivered'
  | 'billed'
  | 'paid';

export const TRIP_STATUS_ORDER: TripStatus[] = [
  'vendor_confirmed',
  'vehicle_assigned',
  'dispatched',
  'in_transit',
  'delivered',
  'billed',
  'paid',
];

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  vendor_confirmed: 'Vendor confirmed',
  vehicle_assigned: 'Vehicle assigned',
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  delivered: 'Delivered',
  billed: 'Billed',
  paid: 'Paid',
};

export interface TripEvent {
  status: TripStatus;
  at: string;
  note: string;
}

export interface Trip {
  id: string;
  orderId: string;
  requirementId: string;
  customerName: string;
  route: string;
  vehicleNo: string;
  driver: string;
  driverPhone: string;
  status: TripStatus;
  podFile: string | null;
  events: TripEvent[];
}

/* ------------------------------------------------------- billing, payments */

export type PaymentStatus = 'unpaid' | 'paid';
export type PayoutStatus = 'pending' | 'approved' | 'paid';

export interface Invoice {
  id: string;
  orderId: string;
  requirementId: string;
  customerName: string;
  route: string;
  amount: number;
  vendorPayout: number;
  margin: number;
  issuedAt: string;
  dueDate: string;
  status: PaymentStatus;
  paidOn: string | null;
  vendorPayoutStatus: PayoutStatus;
  tripStatus: TripStatus;
}

/* --------------------------------------------------------------- rate card */

export interface RateCardRow {
  id: string;
  origin: string;
  destination: string;
  vehicleType: VehicleType;
  bodySizeFt: number;
  axle: Axle;
  weightBand: WeightBand;
  rate: number;
  validFrom: string;
  validTo: string;
  /** true for the curated rows supplied by the business team */
  curated: boolean;
}

export interface RateLookupInput {
  origin: string;
  destination: string;
  vehicleType: VehicleType;
  bodySizeFt: number;
  axle: Axle;
  weightT: number;
}

export interface RateLookupResult {
  match: 'exact' | 'nearest' | 'none';
  rate: number | null;
  row: RateCardRow | null;
  note: string;
}

/* ----------------------------------------------------------------- metrics */

export interface DashboardMetrics {
  openRequirements: number;
  quotesReceived: number;
  avgMinutesToL1: number | null;
  instantPriceHits: number;
  tripsInTransit: number;
  receivableOutstanding: number;
  payableOutstanding: number;
  marginBooked: number;
  responseRatePct: number | null;
  rateCardRows: number;
  vendorCount: number;
}
