import { Router, type Request, type Response } from "express";
import type {
  Invoice,
  Order,
  Requirement,
  SarvamCall,
  Trip,
  TripStatus,
} from "../../shared/types";
import {
  CARGO_TYPES,
  TRIP_STATUS_LABEL,
  TRIP_STATUS_ORDER,
} from "../../shared/types";
import { listAudit, recordAudit } from "./audit";
import {
  ROLES,
  clearCookie,
  createSession,
  hashPassword,
  loginFailure,
  loginLocked,
  loginSuccess,
  pruneSessions,
  requireAuth,
  requireRole,
  revokeAllSessions,
  revokeSession,
  sessionCookie,
  verifyPassword,
  type Role,
} from "./auth";
import { channelModes, parseInbound } from "./channels";
import { config } from "./config";
import { persist, tableCounts, type Db } from "./db";
import { summariseQuotes } from "./domain/aggregation";
import { matchVendors } from "./domain/matching";
import { lookupRate } from "./domain/ratecard";
import { computeMetrics, lockInProgress, outreachInProgress } from "./metrics";
import {
  applySarvamCallResult,
  enquiryScript,
  generateEnquiryScript,
  parseSarvamWebhook,
  placeSarvamCall,
  sarvamAgentVariables,
  sarvamStatus,
  syncSarvamCall,
} from "./sarvam";
import { applyRateCard, ensureSarvamVendor } from "./seed";
import { applyInboundReply, startLockIn, startOutreach } from "./simulation";
import {
  attemptsFor,
  customerByName,
  getMatch,
  getRequirement,
  invoiceForOrder,
  orderFor,
  quotesFor,
  tripForOrder,
  type Store,
} from "./store";

type Handler = (req: Request, res: Response) => void;

function wrap(handler: Handler): Handler {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res.status(400).json({ error: message });
    }
  };
}

function notFound(res: Response, what: string): void {
  res.status(404).json({ error: `${what} not found` });
}

const VEHICLE_TYPES = ["open_truck", "container", "trailer"] as const;
const AXLES = ["single", "multi"] as const;
const BODY_SIZES = [14, 19, 22, 32, 40];

function requirementDetail(
  store: Store,
  id: string,
): Record<string, unknown> | null {
  const req = getRequirement(store, id);
  if (!req) return null;

  const match = getMatch(store, id);
  const quotes = quotesFor(store, id)
    .slice()
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const summary = summariseQuotes(id, quotes, req.marginPct);
  const order = orderFor(store, id) ?? null;
  const trip = order ? (tripForOrder(store, order.id) ?? null) : null;
  const invoice = order ? (invoiceForOrder(store, order.id) ?? null) : null;

  return {
    requirement: req,
    match: match
      ? {
          limit: match.limit,
          matched: match.matched,
          excludedCount: match.excluded.length,
          excluded: match.excluded.map((e) => ({
            vendor: {
              id: e.vendor.id,
              name: e.vendor.name,
              active: e.vendor.active,
              kycDone: e.vendor.kycDone,
            },
            reasons: e.reasons,
          })),
        }
      : null,
    attempts: attemptsFor(store, id),
    quotes,
    summary,
    order,
    trip,
    invoice,
    outreachRunning: outreachInProgress(store, id),
    lockInProgress: lockInProgress(store, id),
    sarvamCalls: store.calls
      .filter((c) => c.requirementId === id)
      .slice()
      .reverse(),
    sarvam: sarvamStatus(),
  };
}

function listRow(store: Store, req: Requirement): Record<string, unknown> {
  const quotes = quotesFor(store, req.id);
  const match = getMatch(store, req.id);
  const order = orderFor(store, req.id);
  const trip = order ? tripForOrder(store, order.id) : undefined;
  return {
    ...req,
    quoteCount: quotes.length,
    shortlistSize: match?.matched.length ?? 0,
    attemptCount: attemptsFor(store, req.id).length,
    orderId: order?.id ?? null,
    tripStatus: trip?.status ?? null,
  };
}

export interface ServerContext {
  store: Store;
  db: Db;
}

export function createApiRouter(ctx: ServerContext): Router {
  const { store, db } = ctx;
  const router = Router();

  const audit = (
    req: Request,
    action: string,
    entity?: string,
    entityId?: string,
    detail?: string,
  ): void => {
    recordAudit(db, {
      user: req.user ?? null,
      action,
      entity,
      entityId,
      detail,
    });
  };

  // Snapshot the working set to SQLite after every write response.
  router.use((req, res, next) => {
    if (req.method !== "GET") {
      res.on("finish", () => {
        try {
          persist(db, store);
        } catch (err) {
          console.error("persist failed:", err);
        }
      });
    }
    next();
  });

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "freightdesk-api",
      vendors: store.vendors.length,
      rateCardRows: store.rateCard.length,
    });
  });

  /* --------------------------------------------------------- auth (public) */

  router.post("/auth/login", (req, res) => {
    const email = String(req.body?.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password ?? "");
    const limitKey = `${req.ip ?? "unknown"}|${email}`;
    const lockedFor = loginLocked(limitKey);
    if (lockedFor > 0) {
      res.status(429).json({
        error: `Too many failed attempts. Try again in ${Math.ceil(lockedFor / 60000)} minute(s).`,
      });
      return;
    }
    const row = db
      .prepare(
        `SELECT id, name, email, password_hash, role, active FROM users WHERE email = ?`,
      )
      .get(email) as
      | {
          id: number;
          name: string;
          email: string;
          password_hash: string;
          role: Role;
          active: number;
        }
      | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) {
      loginFailure(limitKey);
      recordAudit(db, {
        user: null,
        action: "auth.login_failed",
        detail: email,
      });
      res.status(401).json({ error: "Email or password is incorrect" });
      return;
    }
    if (row.active !== 1) {
      res.status(401).json({
        error:
          "This account is deactivated. Ask an administrator to re-enable it.",
      });
      return;
    }
    loginSuccess(limitKey);
    pruneSessions(db);
    const { token } = createSession(db, row.id, req.ip);
    res.setHeader("Set-Cookie", sessionCookie(token));
    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
    };
    recordAudit(db, { user, action: "auth.login" });
    res.json({ user });
  });

  router.get("/auth/me", (req, res) => {
    res.json({ user: req.user ?? null });
  });

  router.post("/auth/logout", (req, res) => {
    if (req.sessionToken) revokeSession(db, req.sessionToken);
    res.setHeader("Set-Cookie", clearCookie());
    if (req.user) recordAudit(db, { user: req.user, action: "auth.logout" });
    res.json({ ok: true });
  });

  /* -------------------------------------------------- inbound channel hooks */

  const webhookTokenOk = (req: Request): boolean => {
    const provided =
      req.get("x-webhook-token") || String(req.query.token ?? "");
    return provided.length > 0 && provided === config.webhookToken;
  };

  router.get("/webhooks/whatsapp", (req, res) => {
    const mode = String(req.query["hub.mode"] ?? "");
    const token = String(req.query["hub.verify_token"] ?? "");
    const challenge = String(req.query["hub.challenge"] ?? "");
    if (mode === "subscribe" && token === config.webhookToken) {
      res.type("text/plain").send(challenge);
      return;
    }
    res.status(403).send("Verification failed");
  });

  const handleInbound = (req: Request, res: Response): void => {
    if (!webhookTokenOk(req)) {
      res.status(403).json({ error: "Invalid webhook token" });
      return;
    }
    const message = parseInbound(req.body);
    if (!message) {
      res.status(400).json({ error: "Unrecognised payload shape" });
      return;
    }
    const outcome = applyInboundReply(store, message);
    if (!outcome.ok) {
      res.status(404).json({ error: outcome.detail });
      return;
    }
    recordAudit(db, {
      user: null,
      action: "webhook.reply_received",
      entity: "requirement",
      entityId: outcome.requirementId,
      detail: outcome.detail,
    });
    res.json({
      ok: true,
      requirementId: outcome.requirementId,
      quoteId: outcome.quoteId ?? null,
    });
  };

  router.post("/webhooks/whatsapp", handleInbound);
  router.post("/webhooks/inbound", handleInbound);

  // Sarvam posts the result of every instant outbound call here. The webhook URL
  // configured in SARVAM_WEBHOOK_URL must carry ?token=<WEBHOOK_TOKEN>.
  router.post("/webhooks/sarvam", (req, res) => {
    if (!webhookTokenOk(req)) {
      res.status(403).json({ error: "Invalid webhook token" });
      return;
    }
    const event = parseSarvamWebhook(req.body);
    if (!event) {
      res.status(400).json({ error: "Unrecognised Sarvam payload" });
      return;
    }
    const outcome = applySarvamCallResult(store, event);
    if (!outcome.ok) {
      res.status(404).json({ error: outcome.detail });
      return;
    }
    recordAudit(db, {
      user: null,
      action: "webhook.sarvam_call",
      entity: "requirement",
      entityId: event.requirementId ?? undefined,
      detail: outcome.detail,
    });
    res.json({
      ok: true,
      callId: outcome.callId ?? null,
      quoteId: outcome.quoteId ?? null,
    });
  });

  /* Everything else requires a signed-in user. */
  router.use(requireAuth);

  router.get("/metrics", (_req, res) => {
    res.json(computeMetrics(store));
  });

  router.get("/customers", (_req, res) => {
    res.json(store.customers);
  });

  router.get("/hubs", (_req, res) => {
    const origins = Array.from(
      new Set(store.rateCard.map((r) => r.origin)),
    ).sort();
    const destinations = Array.from(
      new Set(store.rateCard.map((r) => r.destination)),
    ).sort();
    res.json({ origins, destinations });
  });

  router.get("/vendors", (req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    const rows = store.vendors.filter(
      (v) =>
        q.length === 0 ||
        v.name.toLowerCase().includes(q) ||
        v.origins.some((o) => o.toLowerCase().includes(q)) ||
        v.corridors.some((c) => c.toLowerCase().includes(q)),
    );
    res.json({ total: rows.length, rows });
  });

  router.get("/ratecard", (req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
    const rows = store.rateCard.filter(
      (r) =>
        q.length === 0 ||
        r.origin.toLowerCase().includes(q) ||
        r.destination.toLowerCase().includes(q) ||
        r.vehicleType.includes(q),
    );
    res.json({ total: rows.length, rows: rows.slice(0, limit) });
  });

  router.post(
    "/ratecard/lookup",
    wrap((req, res) => {
      const body = req.body as Record<string, unknown>;
      const origin = String(body.origin ?? "");
      const destination = String(body.destination ?? "");
      const weightT = Number(body.weightT ?? 0);
      const vehicleType = String(body.vehicleType ?? "");
      const axle = String(body.axle ?? "");
      const bodySizeFt = Number(body.bodySizeFt ?? 0);
      if (!origin || !destination || weightT <= 0)
        throw new Error(
          "origin, destination and a positive weight are required",
        );
      if (
        !VEHICLE_TYPES.includes(vehicleType as (typeof VEHICLE_TYPES)[number])
      )
        throw new Error("Unknown vehicle type");
      if (!AXLES.includes(axle as (typeof AXLES)[number]))
        throw new Error("Unknown axle configuration");
      res.json(
        lookupRate(store.rateCard, {
          origin,
          destination,
          vehicleType: vehicleType as (typeof VEHICLE_TYPES)[number],
          bodySizeFt,
          axle: axle as (typeof AXLES)[number],
          weightT,
        }),
      );
    }),
  );

  router.get("/requirements", (_req, res) => {
    const rows = store.requirements
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => listRow(store, r));
    res.json(rows);
  });

  router.get("/requirements/:id", (req, res) => {
    const detail = requirementDetail(store, String(req.params.id));
    if (!detail) return notFound(res, "Requirement");
    res.json(detail);
  });

  router.post(
    "/requirements",
    wrap((req, res) => {
      const body = req.body as Record<string, unknown>;
      const customerName = String(body.customerName ?? "").trim();
      const origin = String(body.origin ?? "").trim();
      const destination = String(body.destination ?? "").trim();
      const cargo = String(body.cargo ?? "");
      const vehicleType = String(body.vehicleType ?? "");
      const axle = String(body.axle ?? "");
      const weightT = Number(body.weightT ?? 0);
      const bodySizeFt = Number(body.bodySizeFt ?? 0);
      const loadingDate = String(body.loadingDate ?? "");
      const loadingTime = String(body.loadingTime ?? "08:00");
      const notes = String(body.notes ?? "").trim();

      if (!customerName || !origin || !destination)
        throw new Error("Customer, origin and destination are required");
      if (!store.customers.some((c) => c.name === customerName))
        throw new Error("Unknown customer");
      if (!(CARGO_TYPES as string[]).includes(cargo))
        throw new Error("Unknown cargo type");
      if (
        !VEHICLE_TYPES.includes(vehicleType as (typeof VEHICLE_TYPES)[number])
      )
        throw new Error("Unknown vehicle type");
      if (!AXLES.includes(axle as (typeof AXLES)[number]))
        throw new Error("Unknown axle configuration");
      if (!BODY_SIZES.includes(bodySizeFt))
        throw new Error("Body size must be one of 14, 19, 22, 32 or 40 ft");
      if (!(weightT > 0 && weightT <= 40))
        throw new Error("Weight must be between 0 and 40 tonnes");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(loadingDate))
        throw new Error("Loading date must be YYYY-MM-DD");

      store.counters.requirement += 1;
      const requirement: Requirement = {
        id: `REQ-${store.counters.requirement}`,
        customerName,
        origin,
        destination,
        cargo: cargo as Requirement["cargo"],
        weightT,
        vehicleType: vehicleType as Requirement["vehicleType"],
        bodySizeFt,
        axle: axle as Requirement["axle"],
        loadingDate,
        loadingTime,
        notes,
        status: "intake",
        createdAt: new Date().toISOString(),
        rateCardRate: null,
        rateCardMatch: "none",
        rateCardNote: "",
        marginPct: null,
        l1QuoteId: null,
      };
      applyRateCard(store, requirement);
      store.requirements.push(requirement);
      audit(
        req,
        "requirement.create",
        "requirement",
        requirement.id,
        `${origin} to ${destination}`,
      );
      res.status(201).json(requirementDetail(store, requirement.id));
    }),
  );

  router.post(
    "/requirements/:id/match",
    wrap((req, res) => {
      const id = String(req.params.id);
      const requirement = getRequirement(store, id);
      if (!requirement) return notFound(res, "Requirement");
      if (
        requirement.status !== "intake" &&
        requirement.status !== "shortlisted"
      ) {
        throw new Error(
          `Matching cannot run in status "${requirement.status}"`,
        );
      }
      const limit = Math.min(
        20,
        Math.max(1, Number(req.body?.limit ?? 8) || 8),
      );
      store.matches[id] = matchVendors(requirement, store.vendors, limit);
      requirement.status = "shortlisted";
      audit(
        req,
        "requirement.match",
        "requirement",
        id,
        `shortlist limit ${limit}`,
      );
      res.json(requirementDetail(store, id));
    }),
  );

  async function executeSarvamCall(reqId: string, actingReq?: Request) {
    const requirement = getRequirement(store, reqId);
    if (!requirement) return null;
    const status = sarvamStatus();
    if (!status.configured) return null;

    const { vendor, added } = ensureSarvamVendor(store);
    const generated = await generateEnquiryScript(requirement, vendor.name);
    store.counters.sarvamCall += 1;
    const call: SarvamCall = {
      id: `SC-${store.counters.sarvamCall}`,
      attemptId: null,
      requirementId: reqId,
      vendorId: vendor.id,
      vendorName: vendor.name,
      phone: vendor.phone,
      script: generated.script,
      status: "queued",
      interactionId: null,
      durationSec: null,
      failureReason: null,
      transcript: null,
      quoteId: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    store.calls.push(call);

    const placed = await placeSarvamCall(
      vendor.phone,
      config.sarvam,
      {
        requirementId: reqId,
        callId: call.id,
        vendor: vendor.name,
      },
      fetch,
      sarvamAgentVariables(requirement),
      // The agent's own prompt opens with generic words, so override the first
      // spoken line with the real lane, weight, cargo and loading slot.
      enquiryScript(requirement, vendor.name),
    );

    if (!placed.ok) {
      call.status = "failed";
      call.failureReason = placed.detail;
      call.completedAt = new Date().toISOString();
      if (actingReq)
        audit(
          actingReq,
          "sarvam.call_failed",
          "requirement",
          reqId,
          placed.detail,
        );
      return {
        ok: false,
        call,
        detail: placed.detail,
        vendor,
        added,
        generated,
      };
    }

    call.attemptId = placed.attemptId;
    if (actingReq) {
      audit(
        actingReq,
        "sarvam.call",
        "requirement",
        reqId,
        `${vendor.name} ${vendor.phone}, attempt ${placed.attemptId ?? "pending"}`,
      );
    }
    return { ok: true, call, vendor, added, generated };
  }

  router.post("/requirements/:id/outreach", async (req, res) => {
    try {
      const id = String(req.params.id);
      const requirement = getRequirement(store, id);
      if (!requirement) return notFound(res, "Requirement");
      const outcome = startOutreach(store, id);
      audit(
        req,
        "outreach.start",
        "requirement",
        id,
        `${outcome.attemptCount} vendors contacted`,
      );

      // Trigger real Sarvam AI call to David Transportation immediately on Start AI Outreach!
      let sarvam: Awaited<ReturnType<typeof executeSarvamCall>> = null;
      if (sarvamStatus().configured) {
        sarvam = await executeSarvamCall(id, req);
      }

      if (sarvam && !sarvam.ok) {
        res.status(502).json({
          error: sarvam.detail,
          sarvam: { ok: false, callId: sarvam.call.id },
          ...requirementDetail(store, id),
          started: outcome.attemptCount,
        });
        return;
      }

      res.json({
        ...requirementDetail(store, id),
        started: outcome.attemptCount,
        sarvam: sarvam
          ? {
              ok: true,
              callId: sarvam.call.id,
              attemptId: sarvam.call.attemptId,
            }
          : null,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Could not start outreach",
      });
    }
  });

  /**
   * Places the Sarvam AI price enquiry call. Only the configured vendor can be
   * dialled, so this endpoint cannot be pointed at another number.
   */
  router.post("/requirements/:id/sarvam-call", (req, res) => {
    const id = String(req.params.id);
    const requirement = getRequirement(store, id);
    if (!requirement) return notFound(res, "Requirement");

    const status = sarvamStatus();
    if (!status.configured) {
      res.status(400).json({
        error:
          "Sarvam AI is not configured. Set SARVAM_API_KEY, SARVAM_VOICE_API_KEY, SARVAM_ORG_ID, SARVAM_WORKSPACE_ID, SARVAM_APP_ID, SARVAM_CONNECTION_ID and SARVAM_AGENT_PHONE_NUMBER in the Render environment.",
      });
      return;
    }

    void (async () => {
      try {
        const result = await executeSarvamCall(id, req);
        if (!result) {
          res.status(400).json({ error: "Could not place Sarvam call" });
          return;
        }
        if (!result.ok) {
          res.status(502).json({ error: result.detail, call: result.call });
          return;
        }
        res.json({
          ok: true,
          call: result.call,
          vendor: {
            id: result.vendor.id,
            name: result.vendor.name,
            phone: result.vendor.phone,
          },
          vendorAdded: result.added,
          scriptSource: result.generated.source,
        });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : "Could not place the Sarvam call",
        });
      }
    })();
  });

  /**
   * Pulls the result of a placed Sarvam call from the analytics API. Used when no
   * public webhook URL is configured, so a finished call still becomes a quote.
   */
  router.post("/sarvam-calls/:id/sync", (req, res) => {
    const callId = String(req.params.id);
    void (async () => {
      try {
        const outcome = await syncSarvamCall(store, callId);
        if (!outcome.ok) {
          res
            .status(502)
            .json({ error: outcome.detail, callId: outcome.callId });
          return;
        }
        res.json(outcome);
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : "Could not sync the Sarvam call",
        });
      }
    })();
  });

  router.get("/requirements/:id/quotes", (req, res) => {
    const id = String(req.params.id);
    const requirement = getRequirement(store, id);
    if (!requirement) return notFound(res, "Requirement");
    res.json(summariseQuotes(id, quotesFor(store, id), requirement.marginPct));
  });

  router.post(
    "/quotes/:id/verify",
    wrap((req, res) => {
      const quote = store.quotes.find((q) => q.id === String(req.params.id));
      if (!quote) return notFound(res, "Quote");
      quote.verified = true;
      audit(
        req,
        "quote.verify",
        "quote",
        quote.id,
        `requirement ${quote.requirementId}`,
      );
      const requirement = getRequirement(store, quote.requirementId);
      res.json(
        summariseQuotes(
          quote.requirementId,
          quotesFor(store, quote.requirementId),
          requirement?.marginPct ?? null,
        ),
      );
    }),
  );

  router.post(
    "/requirements/:id/pricing",
    wrap((req, res) => {
      const id = String(req.params.id);
      const requirement = getRequirement(store, id);
      if (!requirement) return notFound(res, "Requirement");
      if (
        requirement.status !== "quoted" &&
        requirement.status !== "awaiting_customer"
      ) {
        throw new Error(`Pricing cannot run in status "${requirement.status}"`);
      }
      const marginPct = Number(req.body?.marginPct ?? 8);
      if (!(marginPct >= 0 && marginPct <= 50))
        throw new Error("Margin must be between 0 and 50 percent");
      const summary = summariseQuotes(id, quotesFor(store, id), marginPct);
      if (!summary.l1) throw new Error("No usable quote to price from yet");
      requirement.marginPct = marginPct;
      requirement.l1QuoteId = summary.l1.id;
      requirement.status = "awaiting_customer";
      audit(
        req,
        "requirement.price",
        "requirement",
        id,
        `margin ${marginPct}%, L1 ${summary.l1.id}`,
      );
      res.json(requirementDetail(store, id));
    }),
  );

  router.post(
    "/requirements/:id/confirm",
    wrap((req, res) => {
      const id = String(req.params.id);
      const requirement = getRequirement(store, id);
      if (!requirement) return notFound(res, "Requirement");
      if (requirement.status !== "awaiting_customer")
        throw new Error("The customer quote must be priced first");
      if (orderFor(store, id))
        throw new Error("An order already exists for this requirement");

      const summary = summariseQuotes(
        id,
        quotesFor(store, id),
        requirement.marginPct,
      );
      if (!summary.l1 || summary.customerPrice === null)
        throw new Error("No L1 quote to confirm against");

      store.counters.order += 1;
      const order: Order = {
        id: `ORD-${store.counters.order}`,
        requirementId: id,
        vendorId: summary.l1.vendorId,
        vendorName: summary.l1.vendorName,
        l1Price: summary.l1.normalisedRate,
        customerPrice: summary.customerPrice,
        marginPct: requirement.marginPct ?? 0,
        status: "locking",
        attempts: [],
        createdAt: new Date().toISOString(),
      };
      store.orders.push(order);
      requirement.status = "locking";
      startLockIn(store, order.id);
      audit(
        req,
        "order.create",
        "order",
        order.id,
        `requirement ${id} at Rs. ${order.customerPrice}`,
      );
      res.json(requirementDetail(store, id));
    }),
  );

  router.get("/orders/:id", (req, res) => {
    const order = store.orders.find((o) => o.id === String(req.params.id));
    if (!order) return notFound(res, "Order");
    res.json({
      order,
      trip: tripForOrder(store, order.id) ?? null,
      invoice: invoiceForOrder(store, order.id) ?? null,
    });
  });

  router.get("/trips", (_req, res) => {
    const rows = store.trips
      .slice()
      .sort((a, b) => {
        const aLast = a.events[a.events.length - 1]?.at ?? "";
        const bLast = b.events[b.events.length - 1]?.at ?? "";
        return bLast.localeCompare(aLast);
      })
      .map((t) => ({ ...t, statusLabel: TRIP_STATUS_LABEL[t.status] }));
    res.json(rows);
  });

  router.post(
    "/trips/:id/advance",
    wrap((req, res) => {
      const trip = store.trips.find((t) => t.id === String(req.params.id));
      if (!trip) return notFound(res, "Trip");
      const currentIndex = TRIP_STATUS_ORDER.indexOf(trip.status);
      const next = TRIP_STATUS_ORDER[currentIndex + 1];
      if (!next) throw new Error("Trip is already paid");
      if (next === "delivered" && !trip.podFile)
        throw new Error("Upload the proof of delivery before marking delivery");

      const note =
        String(req.body?.note ?? "").trim() || defaultAdvanceNote(next, trip);
      trip.status = next;
      trip.events.push({ status: next, at: new Date().toISOString(), note });
      audit(req, "trip.advance", "trip", trip.id, next);

      if (next === "billed") ensureInvoice(store, trip);
      if (next === "paid") {
        const invoice = store.invoices.find((i) => i.orderId === trip.orderId);
        if (invoice && invoice.status !== "paid") {
          invoice.status = "paid";
          invoice.paidOn = new Date().toISOString();
          invoice.tripStatus = "paid";
          audit(
            req,
            "payment.record",
            "invoice",
            invoice.id,
            `Rs. ${invoice.amount} from the trip board`,
          );
        }
      }

      res.json({
        trip,
        invoice: store.invoices.find((i) => i.orderId === trip.orderId) ?? null,
      });
    }),
  );

  router.post(
    "/trips/:id/pod",
    wrap((req, res) => {
      const trip = store.trips.find((t) => t.id === String(req.params.id));
      if (!trip) return notFound(res, "Trip");
      const file = String(req.body?.file ?? "").trim() || `POD_${trip.id}.pdf`;
      trip.podFile = file;
      audit(req, "trip.pod", "trip", trip.id, file);
      res.json(trip);
    }),
  );

  router.get("/payments", (_req, res) => {
    const rows = store.invoices
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((i) => ({
        ...i,
        daysToDue: Math.ceil(
          (new Date(i.dueDate).getTime() - Date.now()) / 86400000,
        ),
      }));
    const summary = {
      receivableOutstanding: rows
        .filter((r) => r.status === "unpaid")
        .reduce((s, r) => s + r.amount, 0),
      payableOutstanding: rows
        .filter((r) => r.vendorPayoutStatus !== "paid")
        .reduce((s, r) => s + r.vendorPayout, 0),
      marginBooked: rows.reduce((s, r) => s + r.margin, 0),
    };
    res.json({ rows, summary });
  });

  router.post(
    "/payments/:id/pay",
    wrap((req, res) => {
      const invoice = store.invoices.find(
        (i) => i.id === String(req.params.id),
      );
      if (!invoice) return notFound(res, "Invoice");
      if (invoice.status === "paid") throw new Error("Invoice is already paid");
      invoice.status = "paid";
      invoice.paidOn = new Date().toISOString();
      invoice.tripStatus = "paid";
      const trip = store.trips.find((t) => t.orderId === invoice.orderId);
      if (trip && trip.status !== "paid") {
        trip.status = "paid";
        trip.events.push({
          status: "paid",
          at: invoice.paidOn,
          note: "Payment recorded against the invoice.",
        });
      }
      audit(
        req,
        "payment.record",
        "invoice",
        invoice.id,
        `Rs. ${invoice.amount}`,
      );
      res.json(invoice);
    }),
  );

  router.post(
    "/payments/:id/payout",
    wrap((req, res) => {
      const invoice = store.invoices.find(
        (i) => i.id === String(req.params.id),
      );
      if (!invoice) return notFound(res, "Invoice");
      const status = String(req.body?.status ?? "");
      if (status !== "approved" && status !== "paid")
        throw new Error("Status must be approved or paid");
      invoice.vendorPayoutStatus = status;
      audit(
        req,
        "payout.update",
        "invoice",
        invoice.id,
        `vendor payout ${status}`,
      );
      res.json(invoice);
    }),
  );

  /* --------------------------------------------------------------- admin */

  router.get("/admin/users", requireRole("admin"), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, name, email, role, active, created_at FROM users ORDER BY id`,
      )
      .all() as {
      id: number;
      name: string;
      email: string;
      role: Role;
      active: number;
      created_at: string;
    }[];
    res.json(
      rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active === 1,
        createdAt: u.created_at,
      })),
    );
  });

  router.post(
    "/admin/users",
    requireRole("admin"),
    wrap((req, res) => {
      const name = String(req.body?.name ?? "").trim();
      const email = String(req.body?.email ?? "")
        .trim()
        .toLowerCase();
      const password = String(req.body?.password ?? "");
      const role = String(req.body?.role ?? "") as Role;
      if (name.length < 2)
        throw new Error("Name must be at least 2 characters");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        throw new Error("A valid email is required");
      if (password.length < 6)
        throw new Error("Password must be at least 6 characters");
      if (!ROLES.includes(role)) throw new Error("Unknown role");
      const exists = db
        .prepare(`SELECT 1 FROM users WHERE email = ?`)
        .get(email);
      if (exists) throw new Error("That email is already registered");
      db.prepare(
        `INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
      ).run(
        name,
        email,
        hashPassword(password),
        role,
        new Date().toISOString(),
      );
      const created = db
        .prepare(`SELECT id FROM users WHERE email = ?`)
        .get(email) as { id: number };
      audit(
        req,
        "user.create",
        "user",
        String(created.id),
        `${name} (${role})`,
      );
      res.status(201).json({ id: created.id, name, email, role, active: true });
    }),
  );

  router.post(
    "/admin/users/:id/reset",
    requireRole("admin"),
    wrap((req, res) => {
      const id = Number(req.params.id);
      const password = String(req.body?.password ?? "");
      if (password.length < 6)
        throw new Error("Password must be at least 6 characters");
      const row = db
        .prepare(`SELECT id, name FROM users WHERE id = ?`)
        .get(id) as { id: number; name: string } | undefined;
      if (!row) return notFound(res, "User");
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
        hashPassword(password),
        id,
      );
      revokeAllSessions(db, id);
      audit(req, "user.reset_password", "user", String(id), row.name);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/admin/users/:id/active",
    requireRole("admin"),
    wrap((req, res) => {
      const id = Number(req.params.id);
      const active = req.body?.active === true;
      if (!active && req.user && req.user.id === id)
        throw new Error("You cannot deactivate your own account");
      const row = db
        .prepare(`SELECT id, name FROM users WHERE id = ?`)
        .get(id) as { id: number; name: string } | undefined;
      if (!row) return notFound(res, "User");
      db.prepare(`UPDATE users SET active = ? WHERE id = ?`).run(
        active ? 1 : 0,
        id,
      );
      if (!active) revokeAllSessions(db, id);
      audit(
        req,
        active ? "user.activate" : "user.deactivate",
        "user",
        String(id),
        row.name,
      );
      res.json({ ok: true, active });
    }),
  );

  router.get("/admin/audit", requireRole("admin"), (req, res) => {
    const limit = Number(req.query.limit ?? 200) || 200;
    res.json(listAudit(db, limit));
  });

  router.get("/system", (_req, res) => {
    const modes = channelModes();
    res.json({
      version: "1.0.0",
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      dbPath: config.dbPath,
      sessionTtlDays: config.sessionTtlDays,
      channels: modes,
      sarvam: sarvamStatus(),
      webhookTokenSet: config.webhookToken.length > 0,
      counts: tableCounts(db),
    });
  });

  return router;
}

function defaultAdvanceNote(status: TripStatus, trip: Trip): string {
  switch (status) {
    case "vehicle_assigned":
      return `Vehicle ${trip.vehicleNo} and driver details captured.`;
    case "dispatched":
      return "Vehicle reached the pickup point and loading completed.";
    case "in_transit":
      return "Departure confirmed by the driver.";
    case "delivered":
      return "Delivery completed and proof of delivery uploaded.";
    case "billed":
      return "Invoice raised against the customer credit terms.";
    case "paid":
      return "Payment received from the customer.";
    default:
      return `Status changed to ${TRIP_STATUS_LABEL[status]}`;
  }
}

/** Invoices are raised when a trip reaches the billed status. */
function ensureInvoice(store: Store, trip: Trip): Invoice | undefined {
  const existing = store.invoices.find((i) => i.orderId === trip.orderId);
  if (existing) return existing;
  const order = store.orders.find((o) => o.id === trip.orderId);
  const requirement = order
    ? getRequirement(store, order.requirementId)
    : undefined;
  if (!order || !requirement) return undefined;

  const terms =
    customerByName(store, requirement.customerName)?.creditTermsDays ?? 30;
  const issuedAt = new Date();
  const invoice: Invoice = {
    id: `INV-${store.counters.invoice + 1}`,
    orderId: order.id,
    requirementId: requirement.id,
    customerName: requirement.customerName,
    route: `${requirement.origin} to ${requirement.destination}`,
    amount: order.customerPrice,
    vendorPayout: order.l1Price,
    margin: order.customerPrice - order.l1Price,
    issuedAt: issuedAt.toISOString(),
    dueDate: new Date(issuedAt.getTime() + terms * 86400000).toISOString(),
    status: "unpaid",
    paidOn: null,
    vendorPayoutStatus: "pending",
    tripStatus: trip.status,
  };
  store.counters.invoice += 1;
  store.invoices.push(invoice);
  return invoice;
}
