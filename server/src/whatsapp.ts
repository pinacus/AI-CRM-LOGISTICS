import type { Requirement } from "../../shared/types";
import { VEHICLE_TYPE_LABEL } from "../../shared/types";
import { config, type AppConfig } from "./config";

/** Default outbound message. Values are filled from each requirement and vendor. */
export const DEFAULT_WHATSAPP_TEMPLATE =
  "Hello {vendor_name}, we need a {vehicle_type} ({body_size}) for {weight} tonnes\n" +
  "from {origin} to {destination}. Loading: {date}, {time}.\n" +
  "Please reply with your best rate (Rs.) for this trip.";

export const WHATSAPP_TEMPLATE_FIELDS = [
  "vendor_name",
  "vehicle_type",
  "body_size",
  "weight",
  "origin",
  "destination",
  "date",
  "time",
] as const;

export interface SendResult {
  ok: boolean;
  provider: string;
  detail: string;
}

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function whatsappMessage(
  req: Requirement,
  vendorName: string,
  template = config.twilioWhatsapp?.template ?? DEFAULT_WHATSAPP_TEMPLATE,
): string {
  const values: Record<string, string> = {
    vendor_name: vendorName,
    vehicle_type: VEHICLE_TYPE_LABEL[req.vehicleType],
    body_size: `${req.bodySizeFt} ft`,
    weight: String(req.weightT),
    origin: req.origin,
    destination: req.destination,
    date: req.loadingDate,
    time: req.loadingTime,
  };

  return template.replace(
    /\{(vendor_name|vehicle_type|body_size|weight|origin|destination|date|time)\}/g,
    (_, key: string) => values[key] ?? "",
  );
}

export function twilioWhatsAppPayload(
  to: string,
  text: string,
  cfg: NonNullable<AppConfig["twilioWhatsapp"]>,
): { url: string; init: RequestInit } {
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString(
    "base64",
  );
  const address = (phone: string): string => {
    const digits = phone.replace(/^whatsapp:/i, "").replace(/[^0-9]/g, "");
    return `whatsapp:+${digits}`;
  };
  const body = new URLSearchParams({
    To: address(to),
    From: address(cfg.from),
    Body: text,
  });
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  };
}

export async function sendWhatsApp(
  to: string,
  text: string,
  cfg: AppConfig = config,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  if (!cfg.twilioWhatsapp) {
    return {
      ok: false,
      provider: "whatsapp",
      detail: "WhatsApp credentials are not configured",
    };
  }

  const { url, init } = twilioWhatsAppPayload(to, text, cfg.twilioWhatsapp);
  try {
    const res = await fetchImpl(url, init);
    const body = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        provider: "whatsapp",
        detail: `Twilio ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return {
      ok: true,
      provider: "whatsapp",
      detail: "queued with Twilio WhatsApp",
    };
  } catch (err) {
    return {
      ok: false,
      provider: "whatsapp",
      detail: err instanceof Error ? err.message : "send failed",
    };
  }
}

export interface InboundMessage {
  phone: string;
  text: string;
}

/** Normalises an Indian phone number to its last 10 digits for matching. */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Extracts WhatsApp, Twilio, and simple webhook payloads into one shape. */
export function parseInbound(body: unknown): InboundMessage | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  if (typeof obj.From === "string" && typeof obj.Body === "string") {
    return { phone: obj.From, text: obj.Body };
  }
  if (typeof obj.from === "string" && typeof obj.text === "string") {
    return { phone: obj.from, text: obj.text };
  }

  const entry = Array.isArray(obj.entry) ? obj.entry[0] : undefined;
  const entryChanges =
    entry && typeof entry === "object"
      ? (entry as Record<string, unknown>).changes
      : undefined;
  const change = Array.isArray(entryChanges) ? entryChanges[0] : undefined;
  const value =
    change && typeof change === "object"
      ? (change as Record<string, unknown>).value
      : undefined;
  const messages =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).messages
      : undefined;
  const first = Array.isArray(messages) ? messages[0] : undefined;
  if (first && typeof first === "object") {
    const msg = first as Record<string, unknown>;
    const text =
      msg.text && typeof msg.text === "object"
        ? (msg.text as Record<string, unknown>).body
        : undefined;
    if (typeof msg.from === "string" && typeof text === "string") {
      return { phone: msg.from, text };
    }
  }
  return null;
}
