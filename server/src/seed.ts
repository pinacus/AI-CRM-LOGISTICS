import type {
  CargoType,
  Channel,
  LockInAttempt,
  MatchResult as MatchResultDto,
  OutreachAttempt,
  Quote,
  Requirement,
  Trip,
  TripStatus,
  VehicleType,
  Vendor,
} from '../../shared/types';
import { CARGO_TYPES, TRIP_STATUS_ORDER, VEHICLE_TYPE_LABEL } from '../../shared/types';
import { phoneKey, whatsappMessage } from './channels';
import { config } from './config';
import { matchVendors } from './domain/matching';
import { withNormalisation } from './domain/aggregation';
import { buildRateCard, DESTINATIONS, lookupRate, ORIGINS } from './domain/ratecard';
import { flagReason, parseQuoteReply } from './domain/parsing';
import type { Store } from './store';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unit(seed: string): number {
  return hash(seed) / 4294967296;
}

function pickN<T>(arr: readonly T[], n: number, seed: string): T[] {
  return arr
    .slice()
    .sort((a, b) => unit(seed + String(a)) - unit(seed + String(b)))
    .slice(0, n);
}

function round100(n: number): number {
  return Math.round(n / 100) * 100;
}

function phoneFor(seed: string): string {
  const h = hash(seed);
  const first = `9${h % 10}`;
  const rest = String(Math.floor(h / 10) % 100000000).padStart(8, "0");
  const num = first + rest;
  return `+91 ${num.slice(0, 5)} ${num.slice(5)}`;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nextId(
  store: Store,
  key: keyof Store["counters"],
  prefix: string,
): string {
  store.counters[key] += 1;
  return `${prefix}-${store.counters[key]}`;
}

/* --------------------------------------------------------------- vendors */

const VENDOR_NAMES = [
  // Demo fleet on the Ambattur to Bengaluru corridor, used by the scripted demo.
  "Sri Balaji Roadlines",
  "Anand Cargo Carriers",
  "Kaveri Transports",
  "Chettinad Carriers",
  "Metro Freight Movers",
  "Sri Venkatesa Goods Carriers",
  "Ambattur Prime Carriers",
  "Padi Lorry Service",
  "Tondiarpet Transports",
  "Ennore Roadlines",
  "Guindy Cargo Movers",
  "Basin Bridge Carriers",
  // Remaining master data.
  "Sri Krishna Roadlines",
  "Velan Transport Services",
  "Sakthi Motor Transport",
  "Sri Ranga Carriers",
  "Ganapathy Lorry Service",
  "MDR Roadlines",
  "Sri Murugan Transport",
  "KPR Freight Movers",
  "Sri Ayyappa Roadlines",
  "Sunrise Cargo Services",
  "New Southern Transports",
  "Sri Lakshmi Lorry Service",
  "Vimal Roadlines",
  "Golden Chariot Carriers",
  "Sri Padmavathi Transport",
  "Ranga Roadlines",
  "Marudham Logistics",
  "Sri Vinayaka Carriers",
  "Abirami Roadlines",
  "Senthil Transport",
  "Sri Ganga Cargo Carriers",
  "Meridian Roadlines",
  "Chola Motor Freight",
  "Sri Jeyam Transport",
  "Anna Nagar Carriers",
  "Kovalam Roadlines",
  "Sri Ananth Services",
  "Saravana Lorry Service",
  "Vetri Transport Services",
  "SFS Cargo Movers",
  "Sri Renganathan Carriers",
  "Nilgiri Freight Lines",
  "Sri Meenakshi Transports",
  "Solingar Roadlines",
  "Sri Dhana Lorry Service",
  "Vasantha Transport",
  "Thendral Cargo Carriers",
  "SRS Roadlines",
  "Sri Nagamma Lorry Service",
  "Kavitha Roadlines",
  "Aruna Cargo Carriers",
  "Bharath Transports",
  "Gayathri Lorry Service",
  "Sri Rama Roadlines",
  "Tansi Transports",
  "Yadava Motor Services",
  "Sri Varadharaja Transport",
  "Hosur Roadlines",
  "Sri Vasavi Transport",
  "Pasumai Agro Carriers",
  "Tara Transports",
  "Kodambakkam Carriers",
  "Sri Meenakshi Lorry Service",
  "Pallavan Transports",
  "Sri Raghavan Carriers",
  "Thanjavur Motor Freight",
  "Sri Kamakshi Transport",
  "Erode Roadlines",
];

const STAPLE_CARGO: CargoType[] = ["General", "FMCG", "Textiles", "Auto parts"];

function maxCapacityFor(bodySizes: number[]): number {
  if (bodySizes.includes(40)) return 25;
  if (bodySizes.includes(32)) return 16;
  if (bodySizes.includes(22)) return 12;
  if (bodySizes.includes(19)) return 9;
  return 7;
}

function buildVendors(): Vendor[] {
  const vendors = VENDOR_NAMES.map((name, i): Vendor => {
    const demoFleet = i < 12;
    const phone = phoneFor(name);

    if (demoFleet) {
      return {
        id: i + 1,
        name,
        phone,
        whatsapp: phone,
        origins: i % 3 === 0 ? ["Ambattur", "Poonamallee"] : ["Ambattur"],
        corridors: Array.from(
          new Set([
            "Bengaluru",
            "Coimbatore",
            "Hosur",
            ...DESTINATIONS.filter((d) => unit(`${name}|${d}`) < 0.45),
          ]),
        ),
        vehicleTypes: ["open_truck", "container"] as VehicleType[],
        bodySizes: [19, 22, 32],
        axles: ["single", "multi"],
        maxCapacityT: 16 + (i % 3) * 4,
        cargoTypes: ["General", "FMCG", "Auto parts", "Textiles"],
        fleetSize: 8 + i * 2,
        availableVehicles: 1 + ((i * 3) % 5),
        rating: Math.round((3.9 + (i % 7) * 0.12) * 10) / 10,
        onTimePct: 84 + ((i * 5) % 13),
        avgRateVsMarketPct: (i % 8) - 4,
        avgResponseMins: 4 + ((i * 4) % 19),
preferredChannel: i % 2 === 0 ? 'voice' : 'whatsapp',
        paymentTermsDays: i % 3 === 0 ? 45 : 30,
        kycDone: true,
        active: true,
      };
    }

    const bodyCount = unit(`${name}|bc`) < 0.5 ? 4 : 3;
    const bodySizes = pickN([14, 19, 22, 32, 40], bodyCount, `${name}|body`);
    const fleetSize = 4 + Math.floor(unit(`${name}|fleet`) * 37);
    const cargoTypes: CargoType[] = STAPLE_CARGO.slice();
if (unit(`${name}|pharma`) < 0.25) cargoTypes.push('Pharma');
    if (unit(`${name}|odc`) < 0.25) cargoTypes.push('ODC');
    if (unit(`${name}|chem`) < 0.25) cargoTypes.push('Chemicals');
    const channelRoll = unit(`${name}|chan`);

    return {
      id: i + 1,
      name,
      phone,
      whatsapp:
        unit(`${name}|wa`) < 0.85 ? phone : phoneFor(`${name}|wa`),
      origins: Array.from(
        new Set([
          ORIGINS[(i - 12) % ORIGINS.length] ?? "Ambattur",
          ...pickN(ORIGINS, 8, `${name}|org`),
        ]),
      ),
      corridors: DESTINATIONS.filter((d) => unit(`${name}|${d}`) < 0.85),
      vehicleTypes:
        unit(`${name}|mix`) < 0.6
          ? (["open_truck", "container"] as VehicleType[])
          : (pickN(
              ["open_truck", "container", "trailer"],
              2,
              `${name}|veh`,
            ) as VehicleType[]),
      bodySizes,
      axles:
        fleetSize > 15
          ? ["single", "multi"]
          : pickN(["single", "multi"], 1, `${name}|axle`),
      maxCapacityT: maxCapacityFor(bodySizes),
      cargoTypes,
      fleetSize,
      availableVehicles: Math.floor(
        unit(`${name}|avail`) * Math.min(7, fleetSize),
      ),
      rating: Math.round((3.2 + unit(`${name}|rate`) * 1.7) * 10) / 10,
      onTimePct: 76 + Math.floor(unit(`${name}|ontime`) * 22),
      avgRateVsMarketPct: Math.round(-6 + unit(`${name}|mkt`) * 13),
      avgResponseMins: 2 + Math.floor(unit(`${name}|resp`) * 44),
preferredChannel: channelRoll < 0.45 ? 'voice' : channelRoll < 0.9 ? 'whatsapp' : 'both',
      paymentTermsDays: [15, 30, 45][Math.floor(unit(`${name}|terms`) * 3)] ?? 30,
      kycDone: unit(`${name}|kyc`) > 0.12,
      active: unit(`${name}|active`) > 0.08,
    };
  });
  vendors.push(sarvamVendor(VENDOR_NAMES.length + 1));
  return vendors;
}

/* ------------------------------------------------ Sarvam AI call target */

/** Formats a 10 digit Indian mobile number for the vendor master. */
export function displayIndianPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '').slice(-10);
  return digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : phone;
}

export function sarvamVendor(id: number): Vendor {
  const vendor: Vendor = {
    id,
    name: config.sarvam.vendorName,
    phone: displayIndianPhone(config.sarvam.vendorPhone),
    whatsapp: displayIndianPhone(config.sarvam.vendorPhone),
    origins: ORIGINS.slice(),
    corridors: DESTINATIONS.slice(),
    vehicleTypes: ['open_truck', 'container', 'trailer'],
    bodySizes: [14, 19, 22, 32, 40],
    axles: ['single', 'multi'],
    maxCapacityT: 25,
    cargoTypes: CARGO_TYPES.slice(),
    fleetSize: 12,
    availableVehicles: 4,
    rating: 4.4,
    onTimePct: 90,
    avgRateVsMarketPct: -2,
    avgResponseMins: 5,
    preferredChannel: 'voice',
    paymentTermsDays: 30,
    kycDone: true,
    active: true,
  };
  return vendor;
}

/**
 * Finds the Sarvam call target. The name wins over the number: another vendor
 * may legitimately hold the same phone, and that must never redirect the call.
 */
export function findSarvamVendor(store: Store): Vendor | undefined {
  const name = config.sarvam.vendorName.toLowerCase();
  return store.vendors.find((v) => v.name.toLowerCase() === name);
}

/**
 * Keeps the Sarvam AI call target in the vendor master: adds it when missing and
 * corrects the number when the record exists with a different one.
 */
export function ensureSarvamVendor(store: Store): { vendor: Vendor; added: boolean } {
  const phone = displayIndianPhone(config.sarvam.vendorPhone);
  const existing = findSarvamVendor(store);
  if (existing) {
    if (phoneKey(existing.phone) !== phoneKey(phone)) existing.phone = phone;
    if (phoneKey(existing.whatsapp) !== phoneKey(phone)) existing.whatsapp = phone;
    return { vendor: existing, added: false };
  }
  const nextId = store.vendors.reduce((max, v) => Math.max(max, v.id), 0) + 1;
  const vendor = sarvamVendor(nextId);
  store.vendors.push(vendor);
  return { vendor, added: true };
}

/* ------------------------------------------------------- requirement rows */

function mkRequirement(
  partial: Omit<
    Requirement,
    | "rateCardRate"
    | "rateCardMatch"
    | "rateCardNote"
    | "marginPct"
    | "l1QuoteId"
  >,
): Requirement {
  return {
    ...partial,
    rateCardRate: null,
    rateCardMatch: "none",
    rateCardNote: "",
    marginPct: null,
    l1QuoteId: null,
  };
}

export function applyRateCard(store: Store, req: Requirement): void {
  const result = lookupRate(store.rateCard, {
    origin: req.origin,
    destination: req.destination,
    vehicleType: req.vehicleType,
    bodySizeFt: req.bodySizeFt,
    axle: req.axle,
    weightT: req.weightT,
  });
  req.rateCardMatch = result.match;
  req.rateCardRate = result.rate;
  req.rateCardNote = result.note;
}

/* ---------------------------------------------------- seeded outreach */

interface SeededReply {
  vendorName: string;
  channel: Channel;
  rate: number;
  raw: string;
}

function addAttempt(
  store: Store,
  req: Requirement,
  vendor: Vendor,
  channel: Channel,
  status: OutreachAttempt["status"],
  outbound: string,
  at: {
    startedAt: string | null;
    repliedAt: string | null;
    reply: string | null;
  },
): OutreachAttempt {
  store.counters.attempt += 1;
  const attempt: OutreachAttempt = {
    id: `OA-${store.counters.attempt}`,
    requirementId: req.id,
    vendorId: vendor.id,
    vendorName: vendor.name,
    channel,
    status,
    outbound,
    reply: at.reply,
    startedAt: at.startedAt,
    repliedAt: at.repliedAt,
  };
  store.attempts.push(attempt);
  return attempt;
}

function addQuote(
  store: Store,
  req: Requirement,
  vendor: Vendor,
  channel: Channel,
  raw: string,
  receivedAt: string,
): Quote {
  // Seeded replies go through the same parser as live replies, so the demo data
  // and the live path produce identical structures.
  const parsed = parseQuoteReply(raw, req.rateCardRate);
  const base: Quote = {
    id: nextId(store, "quote", "Q"),
    requirementId: req.id,
    vendorId: vendor.id,
    vendorName: vendor.name,
    rate: parsed.rate,
    tollIncluded: parsed.tollIncluded,
    availableOnDate: parsed.availableOnDate,
    conditions: parsed.conditions,
    channel,
    rawText: raw,
    confidence: parsed.confidence,
    receivedAt,
    flagReason: null,
    verified: false,
    tollAllowance: 0,
    normalisedRate: 0,
  };
  const quote = withNormalisation(base);
  quote.flagReason = flagReason(quote.rate, quote.confidence, req.rateCardRate);
  store.quotes.push(quote);
  return quote;
}

function voiceScript(req: Requirement): string {
  return (
    `Greeting, then: requirement is ${req.weightT} tonnes of ${req.cargo} from ${req.origin} to ${req.destination}, ` +
    `${VEHICLE_TYPE_LABEL[req.vehicleType]} ${req.bodySizeFt} ft, loading ${req.loadingDate} at ${req.loadingTime}. ` +
    `Asked: what is your best rate for this trip, and repeat the number back for confirmation.`
  );
}

/** Seeded version of the outreach run: replies already in, no timers involved. */
function seedOutreach(
  store: Store,
  req: Requirement,
  opts: { replyCount: number; replies: SeededReply[]; startedOffsetMs: number },
): void {
  const match = store.matches[req.id];
  if (!match) return;

  const shortlist = match.matched.slice(0, Math.max(opts.replyCount + 3, 8));
  const replyByName = new Map(opts.replies.map((r) => [r.vendorName, r]));
  let replied = 0;

  shortlist.forEach((m, index) => {
    const vendor = m.vendor;
    const preferred: Channel =
      vendor.preferredChannel === "both" ? "whatsapp" : vendor.preferredChannel;
    const channel: Channel =
      index % 3 === 2
        ? preferred === "whatsapp"
          ? "voice"
          : "whatsapp"
        : preferred;
    const outbound =
      channel === "whatsapp"
        ? whatsappMessage(req, vendor.name)
        : voiceScript(req);
    const startedAt = new Date(
      Date.now() + opts.startedOffsetMs + index * 45_000,
    ).toISOString();
    const reply = replyByName.get(vendor.name);

    if (reply && replied < opts.replyCount) {
      replied += 1;
      const repliedAt = new Date(
        Date.now() + opts.startedOffsetMs + index * 45_000 + 70_000,
      ).toISOString();
      addAttempt(store, req, vendor, reply.channel, "replied", outbound, {
        startedAt,
        repliedAt,
        reply: reply.raw,
      });
      addQuote(store, req, vendor, reply.channel, reply.raw, repliedAt);
    } else {
      addAttempt(store, req, vendor, channel, "no_response", outbound, {
        startedAt,
        repliedAt: null,
        reply: null,
      });
    }
  });
}

/* -------------------------------------------------- trips, orders, invoices */

function seedOrderAndTrip(
  store: Store,
  req: Requirement,
  opts: {
    upTo: TripStatus;
    vehicleNo: string;
    driver: string;
    driverPhone: string;
    firstEventOffsetMs: number;
    stepMs: number;
    invoiceIssuedOffsetMs?: number;
    paid?: boolean;
    payoutPaid?: boolean;
  },
): void {
  const match = store.matches[req.id];
  const usable = match?.matched ?? [];
  if (usable.length === 0) return;

  const winner = usable[0];
  if (!winner) return;
  // Must agree with the lowest seeded quote, which is base * 0.94.
  const l1Price = round100((req.rateCardRate ?? 34000) * 0.94);
  const marginPct = 8;
  const customerPrice = Math.round(l1Price * (1 + marginPct / 100));

  store.counters.order += 1;
  const orderId = `ORD-${store.counters.order}`;
  const attempts: LockInAttempt[] = usable.slice(0, 3).map((m, i) =>
    i === 0
      ? {
          vendorId: m.vendor.id,
          vendorName: m.vendor.name,
          channel: "voice" as Channel,
          status: "accepted",
          vehicleNo: opts.vehicleNo,
          driverName: opts.driver,
          driverPhone: opts.driverPhone,
          at: new Date(Date.now() + opts.firstEventOffsetMs).toISOString(),
          message: `Confirmed at Rs. ${l1Price.toLocaleString("en-IN")}. Vehicle and driver details shared.`,
        }
      : {
          vendorId: m.vendor.id,
          vendorName: m.vendor.name,
          channel: i === 1 ? ("whatsapp" as Channel) : ("voice" as Channel),
          status: "job_filled",
          vehicleNo: null,
          driverName: null,
          driverPhone: null,
          at: new Date(
            Date.now() + opts.firstEventOffsetMs + 60_000 * i,
          ).toISOString(),
          message: "Job already filled, thank you.",
        },
  );

  store.orders.push({
    id: orderId,
    requirementId: req.id,
    vendorId: winner.vendor.id,
    vendorName: winner.vendor.name,
    l1Price,
    customerPrice,
    marginPct,
    status: "confirmed",
    attempts,
    createdAt: new Date(Date.now() + opts.firstEventOffsetMs).toISOString(),
  });

  const upToIndex = TRIP_STATUS_ORDER.indexOf(opts.upTo);
  const customer = store.customers.find((c) => c.name === req.customerName);
  const terms = customer?.creditTermsDays ?? 30;

  store.counters.trip += 1;
  const tripId = `TRIP-${store.counters.trip}`;
  const trip: Trip = {
    id: tripId,
    orderId,
    requirementId: req.id,
    customerName: req.customerName,
    route: `${req.origin} to ${req.destination}`,
    vehicleNo: opts.vehicleNo,
    driver: opts.driver,
    driverPhone: opts.driverPhone,
    status: "vendor_confirmed",
    podFile: null,
    events: [],
  };

  let invoiceIssuedAt: string | null = null;
  for (let i = 0; i <= upToIndex; i++) {
    const status = TRIP_STATUS_ORDER[i];
    if (!status) continue;
    const at = new Date(
      Date.now() + opts.firstEventOffsetMs + i * opts.stepMs,
    ).toISOString();
    trip.status = status;
    if (status === "delivered") trip.podFile = `POD_${tripId}.pdf`;
    if (status === "billed") invoiceIssuedAt = at;
    trip.events.push({ status, at, note: tripNote(status, opts) });
  }
  store.trips.push(trip);

  if (invoiceIssuedAt) {
    const issued = new Date(invoiceIssuedAt);
    const due = new Date(issued.getTime() + terms * DAY);
    const paid = opts.paid === true;
    const paidOn = paid
      ? new Date(issued.getTime() + Math.min(terms, 6) * DAY).toISOString()
      : null;
    store.invoices.push({
      id: nextId(store, "invoice", "INV"),
      orderId,
      requirementId: req.id,
      customerName: req.customerName,
      route: `${req.origin} to ${req.destination}`,
      amount: customerPrice,
      vendorPayout: l1Price,
      margin: customerPrice - l1Price,
      issuedAt: issued.toISOString(),
      dueDate: due.toISOString(),
      status: paid ? "paid" : "unpaid",
      paidOn,
      vendorPayoutStatus: opts.payoutPaid === true ? "paid" : "pending",
      tripStatus: trip.status,
    });
  }
}

function tripNote(status: TripStatus, opts: { vehicleNo: string }): string {
  switch (status) {
    case "vendor_confirmed":
      return "Vendor accepted the job at the locked price.";
    case "vehicle_assigned":
      return `Vehicle ${opts.vehicleNo} and driver details captured.`;
    case "dispatched":
      return "Vehicle reached pickup point and loading completed.";
    case "in_transit":
      return "Driver confirmed departure, check-in updates by WhatsApp.";
    case "delivered":
      return "Delivery completed and proof of delivery uploaded.";
    case "billed":
      return "Invoice raised against the customer credit terms.";
    case "paid":
      return "Payment received from the customer.";
    default:
      return "";
  }
}

/* ------------------------------------------------------------------ seed */

export function seedStore(store: Store): void {
  const now = new Date();
  const tomorrow = dateOnly(new Date(now.getTime() + DAY));

  store.rateCard = buildRateCard(now);

  store.customers = [
    {
      id: "C-01",
      name: "Sundaram Auto Components Pvt Ltd",
      contact: "R. Prakash, 98400 11223",
      gstNo: "33AABCS1234F1Z5",
      creditTermsDays: 30,
    },
    {
      id: "C-02",
      name: "Kavya Textiles Ltd",
      contact: "S. Meena, 98840 55661",
      gstNo: "33AACCK9876P1Z2",
      creditTermsDays: 15,
    },
    {
      id: "C-03",
      name: "Meridian Plastics",
      contact: "A. Joseph, 97910 44321",
      gstNo: "33AAGCM4567H1Z9",
      creditTermsDays: 15,
    },
    {
      id: "C-04",
      name: "Anand FMCG Distributors",
      contact: "V. Anand, 99400 77882",
      gstNo: "33AAKCA2211L1Z7",
      creditTermsDays: 30,
    },
    {
      id: "C-05",
      name: "Sunrise Pharma Distributors",
      contact: "K. Divya, 98841 30921",
      gstNo: "33AABFS6789M1Z1",
      creditTermsDays: 45,
    },
    {
      id: "C-06",
      name: "Sri Amman Engineering Works",
      contact: "M. Balamurugan, 94440 12121",
      gstNo: "33AAJCS5544G1Z3",
      creditTermsDays: 15,
    },
  ];

  store.vendors = buildVendors();

  /* REQ-1001: quotes received, waiting for the agent to price the customer. */
  const req1 = mkRequirement({
    id: "REQ-1001",
    customerName: "Sundaram Auto Components Pvt Ltd",
    origin: "Ambattur",
    destination: "Bengaluru",
    cargo: "General",
    weightT: 9,
    vehicleType: "open_truck",
    bodySizeFt: 32,
    axle: "multi",
    loadingDate: tomorrow,
    loadingTime: "08:00",
    notes: "Pickup at Gate 2, loading starts 07:30.",
    status: "quoted",
    createdAt: new Date(now.getTime() - 25 * MIN).toISOString(),
  });
  applyRateCard(store, req1);
  store.requirements.push(req1);
  store.matches[req1.id] = matchWithPreference(req1, store.vendors, [
    "Metro Freight Movers",
    "Anand Cargo Carriers",
    "Kaveri Transports",
    "Sri Balaji Roadlines",
    "Chettinad Carriers",
  ]);
  seedOutreach(store, req1, {
    replyCount: 5,
    startedOffsetMs: -20 * MIN,
    replies: [
{ vendorName: 'Metro Freight Movers', channel: 'voice', rate: 37800, raw: '37,800 sir, toll included, vehicle ready tomorrow 8 am' },
      { vendorName: 'Anand Cargo Carriers', channel: 'whatsapp', rate: 38500, raw: 'Rs. 38,500 all inclusive, vehicle ready tomorrow' },
      { vendorName: 'Kaveri Transports', channel: 'whatsapp', rate: 39500, raw: '39500 rupees, toll included, loading ok' },
      { vendorName: 'Sri Balaji Roadlines', channel: 'voice', rate: 41000, raw: '41000 sir, all inclusive, vehicle ready' },
      { vendorName: 'Chettinad Carriers', channel: 'whatsapp', rate: 42000, raw: 'Rs. 42,000, toll included' },
    ],
  });

  /* REQ-1002: confirmed order, trip currently in transit. */
  const req2 = mkRequirement({
    id: "REQ-1002",
    customerName: "Kavya Textiles Ltd",
    origin: "Sriperumbudur",
    destination: "Bengaluru",
    cargo: "Textiles",
    weightT: 12,
    vehicleType: "container",
    bodySizeFt: 32,
    axle: "multi",
    loadingDate: dateOnly(now),
    loadingTime: "06:00",
    notes: "Baled fabric, 12 pallets.",
    status: "confirmed",
    createdAt: new Date(now.getTime() - 3 * HOUR).toISOString(),
  });
  applyRateCard(store, req2);
  store.requirements.push(req2);
  store.matches[req2.id] = matchVendors(req2, store.vendors);
  seedGenericQuotes(store, req2, 5, -3 * HOUR + 3 * MIN);
  seedOrderAndTrip(store, req2, {
    upTo: "in_transit",
    vehicleNo: "TN 09 BZ 4521",
    driver: "M. Kumar",
    driverPhone: "+91 98410 23456",
    firstEventOffsetMs: -2 * HOUR,
    stepMs: 25 * MIN,
  });

  /* REQ-1003: shortlisted, outreach not started yet. */
  const req3 = mkRequirement({
    id: "REQ-1003",
    customerName: "Anand FMCG Distributors",
    origin: "Ambattur",
    destination: "Coimbatore",
    cargo: "FMCG",
    weightT: 5,
    vehicleType: "open_truck",
    bodySizeFt: 22,
    axle: "single",
    loadingDate: tomorrow,
    loadingTime: "07:30",
    notes: "Palletised boxes, no overloading.",
    status: "shortlisted",
    createdAt: new Date(now.getTime() - 40 * MIN).toISOString(),
  });
  applyRateCard(store, req3);
  store.requirements.push(req3);
  store.matches[req3.id] = matchVendors(req3, store.vendors);

  /* REQ-1004: delivered and billed, payment due soon, vendor payout pending. */
  const req4 = mkRequirement({
    id: "REQ-1004",
    customerName: "Meridian Plastics",
    origin: "Poonamallee",
    destination: "Hosur",
    cargo: "General",
    weightT: 8,
    vehicleType: "open_truck",
    bodySizeFt: 32,
    axle: "multi",
    loadingDate: dateOnly(new Date(now.getTime() - 14 * DAY)),
    loadingTime: "09:00",
    notes: "Granules in 50 kg bags.",
    status: "confirmed",
    createdAt: new Date(now.getTime() - 15 * DAY).toISOString(),
  });
  applyRateCard(store, req4);
  store.requirements.push(req4);
  store.matches[req4.id] = matchVendors(req4, store.vendors);
  seedGenericQuotes(store, req4, 4, -15 * DAY + 3 * MIN);
  seedOrderAndTrip(store, req4, {
    upTo: "billed",
    vehicleNo: "TN 10 CJ 8877",
    driver: "S. Rajesh",
    driverPhone: "+91 90031 44120",
    firstEventOffsetMs: -14 * DAY,
    stepMs: 12 * HOUR,
    invoiceIssuedOffsetMs: -12 * DAY,
  });

  /* REQ-1005: fully closed, payment received and vendor paid. */
  const req5 = mkRequirement({
    id: "REQ-1005",
    customerName: "Sri Amman Engineering Works",
    origin: "Ambattur",
    destination: "Hosur",
    cargo: "Auto parts",
    weightT: 9,
    vehicleType: "open_truck",
    bodySizeFt: 32,
    axle: "multi",
    loadingDate: dateOnly(new Date(now.getTime() - 8 * DAY)),
    loadingTime: "05:30",
    notes: "Machined components, covered body preferred.",
    status: "closed",
    createdAt: new Date(now.getTime() - 9 * DAY).toISOString(),
  });
  applyRateCard(store, req5);
  store.requirements.push(req5);
  store.matches[req5.id] = matchVendors(req5, store.vendors);
  seedGenericQuotes(store, req5, 4, -9 * DAY + 3 * MIN);
  seedOrderAndTrip(store, req5, {
    upTo: "paid",
    vehicleNo: "TN 09 AB 1123",
    driver: "P. Selvam",
    driverPhone: "+91 98842 71190",
    firstEventOffsetMs: -8 * DAY,
    stepMs: 6 * HOUR,
    paid: true,
    payoutPaid: true,
  });

  /* REQ-1006: freshly logged, nothing run yet. Good place to start the demo. */
  const req6 = mkRequirement({
    id: "REQ-1006",
    customerName: "Sunrise Pharma Distributors",
    origin: "Gummidipoondi",
    destination: "Vijayawada",
    cargo: "FMCG",
    weightT: 9,
    vehicleType: "open_truck",
    bodySizeFt: 32,
    axle: "multi",
    loadingDate: tomorrow,
    loadingTime: "09:00",
    notes: "Invoice and e-way bill shared on WhatsApp.",
    status: "intake",
    createdAt: new Date(now.getTime() - 5 * MIN).toISOString(),
  });
  applyRateCard(store, req6);
  store.requirements.push(req6);
}

/**
 * Shortlist as the matching engine ranks it, except that a preferred set of
 * vendors is guaranteed a place, which the demo scenario in the POC relies on.
 */
function matchWithPreference(
  req: Requirement,
  vendors: Vendor[],
  preferred: string[],
): MatchResultDto {
  const full = matchVendors(req, vendors, Number.MAX_SAFE_INTEGER);
  const preferredSet = new Set(preferred);
  const picks = full.matched.filter((m) => preferredSet.has(m.vendor.name));
  const rest = full.matched.filter((m) => !preferredSet.has(m.vendor.name));
  const shortlist = [...picks, ...rest].slice(0, 8);
  shortlist.forEach((m, i) => {
    m.rank = i + 1;
  });
  const overflow = [...picks, ...rest].slice(8);
  const excluded = [
    ...full.excluded,
    ...overflow.map((m) => ({
      vendor: m.vendor,
      reasons: [`Passed every filter but is outside the top 8`],
    })),
  ];
  return { requirementId: req.id, matched: shortlist, excluded, limit: 8 };
}

/** Quotes for seeded requirements that are past the outreach stage. */
function seedGenericQuotes(
  store: Store,
  req: Requirement,
  count: number,
  startOffsetMs: number,
): void {
  const match = store.matches[req.id];
  if (!match) return;
  const base = req.rateCardRate ?? 34000;
  const shortlist = match.matched.slice(0, count + 3);
  const responders = shortlist.slice(0, count);

  shortlist.forEach((m, index) => {
    const vendor = m.vendor;
    const channel: Channel =
      vendor.preferredChannel === "voice" ? "voice" : "whatsapp";
    const outbound =
      channel === "whatsapp"
        ? whatsappMessage(req, vendor.name)
        : voiceScript(req);
    const startedAt = new Date(
      Date.now() + startOffsetMs + index * 40_000,
    ).toISOString();
    const responderIndex = responders.indexOf(m);

    if (responderIndex >= 0) {
      const repliedAt = new Date(
        Date.now() + startOffsetMs + responderIndex * 90_000 + 100_000,
      ).toISOString();
      const rate = round100(base * (0.94 + responderIndex * 0.022));
      const raw =
        channel === "whatsapp"
          ? `Rs. ${rate.toLocaleString("en-IN")}, toll included, vehicle ready`
          : `${rate} rupees sir, all inclusive, vehicle ready for loading`;
      addAttempt(store, req, vendor, channel, "replied", outbound, {
        startedAt,
        repliedAt,
        reply: raw,
      });
      addQuote(store, req, vendor, channel, raw, repliedAt);
    } else {
      addAttempt(store, req, vendor, channel, "no_response", outbound, {
        startedAt,
        repliedAt: null,
        reply: null,
      });
    }
  });
}
