import type { Channel } from "../../shared/types";
import { config, type AppConfig } from "./config";
import {
  DEFAULT_WHATSAPP_TEMPLATE,
  parseInbound,
  phoneKey,
  sendWhatsApp,
  twilioWhatsAppPayload,
  whatsappMessage,
  type FetchLike,
  type SendResult,
} from "./whatsapp";

export type { FetchLike, InboundMessage, SendResult } from "./whatsapp";
export {
  DEFAULT_WHATSAPP_TEMPLATE,
  parseInbound,
  phoneKey,
  sendWhatsApp,
  twilioWhatsAppPayload,
  whatsappMessage,
};

/**
 * Outbound channels.
 *
 * With no credentials configured everything runs in simulation mode, which is
 * the default and needs no accounts. When credentials are present the same call
 * sites send real traffic: WhatsApp and voice through Twilio. Replies from live
 * channels arrive on the webhook endpoints and are
 * parsed by the same quote parser as simulated replies.
 *
 * The payload builders are pure functions of their config, so tests can verify
 * exactly what would be sent without any network access.
 */

export type ChannelMode = "simulation" | "live";

export function modeFor(
  channel: Channel,
  cfg: AppConfig = config,
): ChannelMode {
  if (channel === "whatsapp") {
    return cfg.twilioWhatsapp ? "live" : "simulation";
  }
  return cfg.twilio ? "live" : "simulation";
}

export function channelModes(
  cfg: AppConfig = config,
): Record<Channel, ChannelMode> {
  return { whatsapp: modeFor("whatsapp", cfg), voice: modeFor("voice", cfg) };
}

export function twilioCallPayload(
  to: string,
  sayText: string,
  cfg: NonNullable<AppConfig["twilio"]>,
): { url: string; init: RequestInit } {
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString(
    "base64",
  );
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Karuwan">${escapeXml(
    sayText,
  )}</Say><Pause length="1"/><Say>Reply with your best rate.</Say></Response>`;
  const body = new URLSearchParams({ To: to, From: cfg.from, Twiml: twiml });
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls.json`,
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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function placeVoiceCall(
  to: string,
  sayText: string,
  cfg: AppConfig = config,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  if (!cfg.twilio)
    return {
      ok: false,
      provider: "voice",
      detail: "Twilio credentials are not configured",
    };
  const { url, init } = twilioCallPayload(to, sayText, cfg.twilio);
  try {
    const res = await fetchImpl(url, init);
    const body = await res.text();
    if (!res.ok)
      return {
        ok: false,
        provider: "voice",
        detail: `Twilio ${res.status}: ${body.slice(0, 200)}`,
      };
    return { ok: true, provider: "voice", detail: "call queued with Twilio" };
  } catch (err) {
    return {
      ok: false,
      provider: "voice",
      detail: err instanceof Error ? err.message : "call failed",
    };
  }
}
