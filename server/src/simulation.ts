import type {
  Channel,
  LockInAttempt,
  Order,
  Quote,
  Requirement,
  Trip,
  Vendor,
} from "../../shared/types";
import { VEHICLE_TYPE_LABEL } from "../../shared/types";
import {
  modeFor,
  phoneKey,
  placeVoiceCall,
  sendWhatsApp,
  whatsappMessage,
  type InboundMessage,
  type SendResult,
} from "./channels";
import { config } from "./config";
import { withNormalisation } from "./domain/aggregation";
import { flagReason, parseQuoteReply } from "./domain/parsing";
import { attemptsFor, getRequirement, type Store } from "./store";

/**
 * Outreach and vendor lock-in are simulated in process: telephony and WhatsApp
 * need provider accounts that a POC build does not have. Timings are compressed
 * so a full outreach round finishes in about 8 seconds instead of 10 minutes.
 */

const timers = new Map<string, NodeJS.Timeout[]>();

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function schedule(reqId: string, ms: number, fn: () => void): void {
  const list = timers.get(reqId) ?? [];
  const handle = setTimeout(() => {
    try {
      fn();
    } finally {
      notify();
    }
  }, ms);
  list.push(handle);
  timers.set(reqId, list);
}

export function cancelTimers(reqId: string): void {
  for (const handle of timers.get(reqId) ?? []) clearTimeout(handle);
  timers.delete(reqId);
}

/**
 * The server registers a listener here so every timer-driven mutation is
 * snapshotted to SQLite as it happens, not only API-triggered writes.
 */
let mutationListener: (() => void) | null = null;

export function setMutationListener(fn: () => void): void {
  mutationListener = fn;
}

function notify(): void {
  try {
    mutationListener?.();
  } catch (err) {
    console.error("persist after timer failed:", err);
  }
}

function round100(n: number): number {
  return Math.round(n / 100) * 100;
}

function voiceScript(req: Requirement): string {
  return (
    `Greeting and company introduction, then the requirement: ${req.weightT} tonnes of ${req.cargo} from ` +
    `${req.origin} to ${req.destination}, ${VEHICLE_TYPE_LABEL[req.vehicleType]} ${req.bodySizeFt} ft, loading ` +
    `${req.loadingDate} ${req.loadingTime}. Asked for the best rate and read the number back for confirmation.`
  );
}

const VOICE_REPLIES = (rate: number, tollExtra: boolean): string[] => [
  `${rate} rupees sir, ${tollExtra ? 'toll extra' : 'toll included'}`,
  `Hello sir, ${rate} rupees for this trip, vehicle ready`,
  `Rate ${rate} rupees, ${tollExtra ? 'toll extra' : 'all inclusive'}, loading fine`,
  `Rate ${rate} rupees, detention charges extra`,
];

const WHATSAPP_REPLIES = (rate: number, tollExtra: boolean): string[] => [
  `Rs. ${rate.toLocaleString('en-IN')}, ${tollExtra ? 'toll extra' : 'all inclusive'}. Vehicle ready.`,
  `Rs. ${rate}, ${tollExtra ? 'toll extra' : 'toll included'}`,
  `Best rate ${rate} rupees, loading ok`,
  `Rate ${rate} rupees, ${tollExtra ? 'toll extra' : 'toll included'}, vehicle ready`,
  `Rs. ${rate} for this trip, vehicle ready to load`,
];

const NO_RATE_REPLIES = [
  'Please call me sir, I will share the rate shortly',
  'Vehicle is ready, I will confirm the rate this evening',
  'Let us talk tomorrow, the vehicle is ready',
];

/**
 * The Sarvam AI call target is dialled only from the "Sarvam AI price enquiry"
 * panel, so simulated outreach never produces a mock reply for it.
 */
function isSarvamVendor(vendor: Vendor): boolean {
  return (
    phoneKey(vendor.phone) === phoneKey(config.sarvam.vendorPhone) ||
    vendor.name.toLowerCase() === config.sarvam.vendorName.toLowerCase()
  );
}

export interface OutreachOutcome {
  attemptCount: number;
}

/**
 * Starts simulated AI outreach to the shortlisted vendors. Attempts are created
 * immediately (queued), then move through in_progress to replied or no_response
 * on timers, with replies parsed into quotes as they arrive.
 */
export function startOutreach(store: Store, reqId: string): OutreachOutcome {
  const req = getRequirement(store, reqId);
  if (!req) throw new Error("Requirement not found");
  if (attemptsFor(store, reqId).length > 0)
    throw new Error("Outreach has already started for this requirement");

  const match = store.matches[reqId];
  if (!match || match.matched.length === 0)
    throw new Error("No shortlisted vendors. Run matching first.");

  const rng = mulberry32(hash(reqId));
  const base = req.rateCardRate ?? 34000;
  const shortlist = match.matched;

  let dialled = 0;
  shortlist.forEach((m, index) => {
    const vendor = m.vendor;
    // Handled by the Sarvam AI call panel instead of a simulated attempt.
    if (isSarvamVendor(vendor)) return;
    dialled += 1;
    const preferred: Channel =
      vendor.preferredChannel === "both"
        ? rng() < 0.5
          ? "voice"
          : "whatsapp"
        : vendor.preferredChannel;
    const channel: Channel =
      index % 3 === 2
        ? preferred === "whatsapp"
          ? "voice"
          : "whatsapp"
        : preferred;
    const outbound =
      channel === "whatsapp"
        ? whatsappMessage(req, vendor.name, config.twilioWhatsapp?.template)
        : voiceScript(req);

    const attemptId = `OA-S${store.counters.attempt + 1}`;
    store.counters.attempt += 1;
    store.attempts.push({
      id: attemptId,
      requirementId: reqId,
      vendorId: vendor.id,
      vendorName: vendor.name,
      channel,
      status: "queued",
      outbound,
      reply: null,
      startedAt: null,
      repliedAt: null,
    });

    const dialAt = 300 + index * 300;
    schedule(reqId, dialAt, () => {
      const attempt = store.attempts.find((a) => a.id === attemptId);
      if (!attempt || attempt.status !== "queued") return;
      attempt.status = "in_progress";
      attempt.startedAt = new Date().toISOString();
    });

    // Live mode sends real traffic; the reply then arrives on the webhook, or
    // the attempt times out to no_response after the configured reply window.
    if (modeFor(channel) === "live") {
      schedule(reqId, dialAt + config.replyTimeoutMs, () => {
        const attempt = store.attempts.find((a) => a.id === attemptId);
        if (
          attempt &&
          (attempt.status === "queued" || attempt.status === "in_progress")
        ) {
          attempt.status = "no_response";
          attempt.repliedAt = new Date().toISOString();
          attempt.reply = attempt.reply ?? "No reply within the reply window.";
          settleIfComplete(store, reqId, attemptId);
        }
      });
      void deliverLive(store, reqId, attemptId, channel, vendor, outbound);
      return;
    }

    const responds = rng() < 0.72;
    const tollExtra = rng() < 0.3;
    const jitter = rng() * 0.14 - 0.055;
    const rate = round100(base * (1 + jitter));
    const noRate = responds && rng() < 0.12;

    const settleAt =
      dialAt + (channel === "voice" ? 2600 : 1700) + Math.floor(rng() * 900);
    schedule(reqId, settleAt, () => {
      const attempt = store.attempts.find((a) => a.id === attemptId);
      if (!attempt) return;
      // A webhook reply may have settled this attempt already; never overwrite it.
      if (attempt.status === "replied" || attempt.status === "no_response")
        return;
      const now = new Date().toISOString();

      if (!responds) {
        attempt.status = "no_response";
        attempt.repliedAt = now;
        settleIfComplete(store, reqId, attemptId);
        return;
      }

      const raw = noRate
        ? (NO_RATE_REPLIES[Math.floor(rng() * NO_RATE_REPLIES.length)] ??
          "Rate will be sent shortly")
        : channel === "voice"
          ? (VOICE_REPLIES(rate, tollExtra)[
              Math.floor(rng() * VOICE_REPLIES(rate, tollExtra).length)
            ] ?? `${rate} sir`)
          : (WHATSAPP_REPLIES(rate, tollExtra)[
              Math.floor(rng() * WHATSAPP_REPLIES(rate, tollExtra).length)
            ] ?? `Rs. ${rate}`);

      attempt.status = "replied";
      attempt.reply = raw;
      attempt.repliedAt = now;

      const parsed = parseQuoteReply(raw, req.rateCardRate);
      const quote: Quote = withNormalisation({
        id: `Q-${store.counters.quote + 1}`,
        requirementId: reqId,
        vendorId: vendor.id,
        vendorName: vendor.name,
        rate: parsed.rate,
        tollIncluded: parsed.tollIncluded,
        availableOnDate: parsed.availableOnDate,
        conditions: parsed.conditions,
        channel,
        rawText: raw,
        confidence: parsed.confidence,
        receivedAt: now,
        flagReason: null,
        verified: false,
        tollAllowance: 0,
        normalisedRate: 0,
      });
      store.counters.quote += 1;
      quote.flagReason = flagReason(
        quote.rate,
        quote.confidence,
        req.rateCardRate,
      );
      store.quotes.push(quote);
      settleIfComplete(store, reqId, attemptId);
    });
  });

  if (dialled === 0) {
    throw new Error(
      `${config.sarvam.vendorName} is the only shortlisted vendor and is dialled by the Sarvam outbound call. Shortlist another vendor to run simulated outreach.`,
    );
  }

  req.status = "outreach";

  const totalMs = 300 + dialled * 300 + 3500 + 1000;
  schedule(reqId, totalMs, () => {
    const current = getRequirement(store, reqId);
    if (current && current.status === "outreach") current.status = "quoted";
  });

  return { attemptCount: dialled };
}

/**
 * Moves the requirement to quoted as soon as every attempt has resolved, so the
 * screen never sits on "AI outreach running" with quotes already on it. The
 * timer above stays as a safety net for any attempt left behind.
 */
function settleIfComplete(
  store: Store,
  reqId: string,
  _attemptId: string,
): void {
  const current = getRequirement(store, reqId);
  if (!current || current.status !== "outreach") return;
  const attempts = attemptsFor(store, reqId);
  if (attempts.length === 0) return;
  const allResolved = attempts.every(
    (a) => a.status === "replied" || a.status === "no_response",
  );
  if (allResolved) current.status = "quoted";
}

/** Sends the outbound message through the real provider when one is configured. */
async function deliverLive(
  store: Store,
  reqId: string,
  attemptId: string,
  channel: Channel,
  vendor: Vendor,
  outbound: string,
): Promise<void> {
  const result: SendResult =
    channel === "whatsapp"
      ? await sendWhatsApp(vendor.whatsapp, outbound)
      : await placeVoiceCall(vendor.phone, outbound);
  const attempt = store.attempts.find((a) => a.id === attemptId);
  if (
    attempt &&
    !result.ok &&
    (attempt.status === "queued" || attempt.status === "in_progress")
  ) {
    attempt.status = "no_response";
    attempt.repliedAt = new Date().toISOString();
    attempt.reply = `Not delivered: ${result.detail}`;
    settleIfComplete(store, reqId, attemptId);
  }
  notify();
}

export interface InboundOutcome {
  ok: boolean;
  detail: string;
  requirementId?: string;
  quoteId?: string;
}

/**
 * Applies a reply that arrived on a webhook: matches it to the oldest open
 * newest open outreach attempt for that vendor number, parses it with the same
 * quote parser the simulator uses, and settles the requirement when every
 * attempt is done. Newest-first avoids routing a reply to stale outreach when
 * the same vendor is contacted for more than one requirement.
 */
export function applyInboundReply(
  store: Store,
  message: InboundMessage,
): InboundOutcome {
  const key = phoneKey(message.phone);
  if (!key)
    return { ok: false, detail: "No usable phone number in the payload" };

  const open = store.attempts.filter(
    (a) => a.status === "queued" || a.status === "in_progress",
  );
  const attempt = [...open].reverse().find((a) => {
    const vendor = store.vendors.find((v) => v.id === a.vendorId);
    if (!vendor) return false;
    return phoneKey(vendor.phone) === key || phoneKey(vendor.whatsapp) === key;
  });
  if (!attempt)
    return {
      ok: false,
      detail: `No open outreach attempt for ${message.phone}`,
    };

  const req = getRequirement(store, attempt.requirementId);
  const now = new Date().toISOString();
  attempt.status = "replied";
  attempt.reply = message.text;
  attempt.repliedAt = now;

  let quoteId: string | undefined;
  if (req) {
    const parsed = parseQuoteReply(message.text, req.rateCardRate);
    const quote: Quote = withNormalisation({
      id: `Q-${store.counters.quote + 1}`,
      requirementId: req.id,
      vendorId: attempt.vendorId,
      vendorName: attempt.vendorName,
      rate: parsed.rate,
      tollIncluded: parsed.tollIncluded,
      availableOnDate: parsed.availableOnDate,
      conditions: parsed.conditions,
      channel: attempt.channel,
      rawText: message.text,
      confidence: parsed.confidence,
      receivedAt: now,
      flagReason: null,
      verified: false,
      tollAllowance: 0,
      normalisedRate: 0,
    });
    store.counters.quote += 1;
    quote.flagReason = flagReason(
      quote.rate,
      quote.confidence,
      req.rateCardRate,
    );
    store.quotes.push(quote);
    quoteId = quote.id;
  }

  settleIfComplete(store, attempt.requirementId, attempt.id);
  notify();
  return {
    ok: true,
    detail: quoteId
      ? `parsed ${quoteId} from ${attempt.vendorName}`
      : `reply recorded from ${attempt.vendorName}`,
    requirementId: attempt.requirementId,
    quoteId,
  };
}

const DRIVERS = [
  "M. Kumar",
  "S. Rajesh",
  "P. Selvam",
  "A. Dinesh",
  "K. Anand",
  "R. Vignesh",
  "T. Murugan",
];

/**
 * Vendor lock-in: the top shortlisted vendors are offered the final L1 price.
 * First valid acceptance wins; the rest get a job filled message.
 */
export function startLockIn(store: Store, orderId: string): Order {
  const order = store.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  const req = getRequirement(store, order.requirementId);
  if (!req) throw new Error("Requirement not found");
  const match = store.matches[req.id];
  const shortlist = match?.matched.slice(0, 3) ?? [];

  if (shortlist.length === 0)
    throw new Error("No shortlisted vendors to lock in");

  order.status = "locking";
  order.attempts = shortlist.map((m, index): LockInAttempt => {
    const channel: Channel = index === 1 ? "whatsapp" : "voice";
    return {
      vendorId: m.vendor.id,
      vendorName: m.vendor.name,
      channel,
      status: "offered",
      vehicleNo: null,
      driverName: null,
      driverPhone: null,
      at: null,
      message: `The job is confirmed at Rs. ${order.l1Price.toLocaleString("en-IN")}. Can you take it? Please share vehicle number and driver details.`,
    };
  });

  const reqId = req.id;
  const offerAt = new Date().toISOString();
  order.attempts.forEach((a) => {
    a.at = offerAt;
  });

  const plateSuffix = String((hash(reqId) % 9000) + 1000);
  const vehicleNo = `TN ${10 + (hash(reqId) % 80)} ${String.fromCharCode(65 + (hash(reqId) % 26))}${String.fromCharCode(65 + (hash(reqId + "b") % 26))} ${plateSuffix}`;
  const driver = DRIVERS[hash(reqId) % DRIVERS.length] ?? "M. Kumar";
  const driverPhone = `+91 9${String(hash(reqId + "p") % 10)}${String(hash(reqId + "q") % 100000000).padStart(8, "0")}`;

  schedule(reqId, 3500, () => {
    const winner = order.attempts[0];
    if (!winner || order.status !== "locking") return;
    winner.status = "accepted";
    winner.vehicleNo = vehicleNo;
    winner.driverName = driver;
    winner.driverPhone = driverPhone;
    winner.at = new Date().toISOString();
    winner.message = `Accepted at Rs. ${order.l1Price.toLocaleString("en-IN")}. Vehicle ${vehicleNo}, driver ${driver}.`;
    order.status = "confirmed";
    order.vendorId = winner.vendorId;
    order.vendorName = winner.vendorName;

    store.counters.trip += 1;
    const trip: Trip = {
      id: `TRIP-${store.counters.trip}`,
      orderId: order.id,
      requirementId: req.id,
      customerName: req.customerName,
      route: `${req.origin} to ${req.destination}`,
      vehicleNo,
      driver,
      driverPhone,
      status: "vendor_confirmed",
      podFile: null,
      events: [
        {
          status: "vendor_confirmed",
          at: new Date().toISOString(),
          note: "Vendor accepted the job at the locked price.",
        },
      ],
    };
    store.trips.push(trip);
    req.status = "confirmed";
  });

  order.attempts.slice(1).forEach((attempt, index) => {
    schedule(reqId, 5500 + index * 1500, () => {
      if (attempt.status !== "offered") return;
      attempt.status = "job_filled";
      attempt.at = new Date().toISOString();
      attempt.message = "Job already filled with another vendor, thank you.";
    });
  });

  schedule(reqId, 20000, () => {
    if (order.status === "locking") order.status = "stalled";
  });

  return order;
}

export function vendorByMatch(
  store: Store,
  reqId: string,
  index: number,
): Vendor | undefined {
  return store.matches[reqId]?.matched[index]?.vendor;
}
