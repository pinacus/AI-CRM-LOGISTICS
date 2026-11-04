import type { Quote, Requirement, SarvamCall, SarvamCallStatus } from '../../shared/types';
import { VEHICLE_TYPE_LABEL } from '../../shared/types';
import { phoneKey, type FetchLike } from './channels';
import { config, type SarvamConfig } from './config';
import { withNormalisation } from './domain/aggregation';
import { flagReason, parseQuoteReply } from './domain/parsing';
import { getRequirement, type Store } from './store';

/**
 * Sarvam AI integration.
 *
 * Two Sarvam surfaces are used:
 * 1. The Model API (chat completions) writes the short price enquiry script for
 *    the requirement.
 * 2. The Voice Agents Instant Outbound API places the AI call that asks the
 *    vendor for their rate. The call result arrives on POST /api/webhooks/sarvam
 *    and is parsed by the same quote parser every other channel uses.
 *
 * Only one number may ever be called. config.sarvam.vendorPhone is the single
 * allowed target and every send path checks it, so bad vendor data cannot turn
 * this integration into a dialler.
 */

const MODEL_BASE_URL = 'https://api.sarvam.ai';
const OUTBOUND_BASE_URL = 'https://apps.sarvam.ai/api/outbounds';
const ANALYTICS_BASE_URL = 'https://apps.sarvam.ai/api/analytics';

/** The workspace key that apps.sarvam.ai accepts as X-API-Key. */
export function sarvamVoiceKey(cfg: SarvamConfig = config.sarvam): string | null {
  return cfg.voiceApiKey ?? cfg.apiKey ?? null;
}

export function sarvamConfigured(cfg: SarvamConfig = config.sarvam): boolean {
  return Boolean(
    sarvamVoiceKey(cfg) && cfg.orgId && cfg.workspaceId && cfg.appId && cfg.connectionId && cfg.agentPhoneNumber,
  );
}

/** 10 digit Indian mobile numbers are normalised to E.164 for Sarvam. */
export function normaliseIndianPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

/** True only for the one vendor number this build is allowed to dial. */
export function isAllowedSarvamNumber(phone: string, cfg: SarvamConfig = config.sarvam): boolean {
  const key = phoneKey(phone);
  return key.length > 0 && key === phoneKey(cfg.vendorPhone);
}

export function sarvamOutboundPayload(
  to: string,
  cfg: SarvamConfig,
  metadata: Record<string, string> = {},
  variables: Record<string, string> = {},
  opening?: string,
): { url: string; init: RequestInit } {
  if (!sarvamConfigured(cfg)) throw new Error('Sarvam AI voice credentials are not configured');
  if (!isAllowedSarvamNumber(to, cfg)) {
    throw new Error(`Sarvam AI may only call ${cfg.vendorName} on ${cfg.vendorPhone}`);
  }

  const body = {
    app_config: {
      app_id: cfg.appId,
      app_version: cfg.appVersion,
      connection_config: {
        connection_id: cfg.connectionId,
        agent_phone_number: normaliseIndianPhone(cfg.agentPhoneNumber ?? ''),
      },
      ...(Object.keys(variables).length > 0 ? { agent_variables: variables } : {}),
      ...(opening ? { app_overrides: { initial_bot_message: opening } } : {}),
    },
    user_config: { user_phone_number: normaliseIndianPhone(to) },
    ...(cfg.webhookUrl ? { webhook_config: { url: cfg.webhookUrl, metadata } } : {}),
  };

  return {
    url: `${OUTBOUND_BASE_URL}/v1/orgs/${encodeURIComponent(cfg.orgId ?? '')}/workspaces/${encodeURIComponent(
      cfg.workspaceId ?? '',
    )}/outbounds`,
    init: {
      method: 'POST',
      headers: { 'X-API-Key': sarvamVoiceKey(cfg) ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  };
}

export interface SarvamCallPlacement {
  ok: boolean;
  provider: 'sarvam';
  detail: string;
  attemptId: string | null;
}

export async function placeSarvamCall(
  to: string,
  cfg: SarvamConfig = config.sarvam,
  metadata: Record<string, string> = {},
  fetchImpl: FetchLike = fetch,
  variables: Record<string, string> = {},
  opening?: string,
): Promise<SarvamCallPlacement> {
  try {
    const { url, init } = sarvamOutboundPayload(to, cfg, metadata, variables, opening);
    const res = await fetchImpl(url, init);
    const body = await res.text();
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? ' The workspace key is rejected: SARVAM_VOICE_API_KEY must be the workspace API key from the Sarvam Voice Agents dashboard, not the model API key.'
          : '';
      return {
        ok: false,
        provider: 'sarvam',
        detail: `Sarvam ${res.status}: ${body.slice(0, 200)}${hint}`,
        attemptId: null,
      };
    }
    let attemptId: string | null = null;
    try {
      const json = JSON.parse(body) as { attempt_id?: unknown };
      if (typeof json.attempt_id === 'string') attemptId = json.attempt_id;
    } catch {
      // the provider answered with something other than JSON; the webhook still resolves the call
    }
    return { ok: true, provider: 'sarvam', detail: 'call queued with Sarvam Voice Agents', attemptId };
  } catch (err) {
    return {
      ok: false,
      provider: 'sarvam',
      detail: err instanceof Error ? err.message : 'call failed',
      attemptId: null,
    };
  }
}

/**
 * Values the Sarvam agent speaks. Without these the agent narrates its template
 * placeholders ("from origin to destination") instead of the real lane.
 */
export function sarvamAgentVariables(req: Requirement): Record<string, string> {
  return {
    origin: req.origin,
    destination: req.destination,
    weight_tonnes: String(req.weightT),
    vehicle_type: VEHICLE_TYPE_LABEL[req.vehicleType] ?? req.vehicleType,
    body_size_ft: String(req.bodySizeFt),
    axle: req.axle,
    loading_date: req.loadingDate,
    loading_time: req.loadingTime,
    question: 'What is your best all-inclusive rate in rupees for this trip?',
  };
}

/** Deterministic enquiry script used when the Sarvam model is unreachable. */
export function enquiryScript(req: Requirement, vendorName: string): string {
  const vehicle = VEHICLE_TYPE_LABEL[req.vehicleType] ?? req.vehicleType;
  return (
    `Hello ${vendorName}, this is FreightDesk calling about a freight requirement. ` +
    `We need ${req.weightT} tonnes of ${req.cargo} from ${req.origin} to ${req.destination}, ` +
    `${vehicle} ${req.bodySizeFt} ft ${req.axle} axle, loading on ${req.loadingDate} at ${req.loadingTime}. ` +
    `Could you confirm your best rate in rupees for this trip, whether toll and GST are included, ` +
    `and whether a vehicle is available on the loading date?`
  );
}

export interface GeneratedScript {
  script: string;
  source: 'sarvam' | 'template';
  detail?: string;
}

/**
 * Asks the Sarvam chat model to write the spoken enquiry. Any failure falls back
 * to the deterministic script so the call can still be placed.
 */
export async function generateEnquiryScript(
  req: Requirement,
  vendorName: string,
  cfg: SarvamConfig = config.sarvam,
  fetchImpl: FetchLike = fetch,
): Promise<GeneratedScript> {
  const fallback = enquiryScript(req, vendorName);
  if (!cfg.apiKey) return { script: fallback, source: 'template', detail: 'Sarvam API key is not configured' };

  const prompt =
    `Write a spoken telephone script, at most 90 words, for an outbound price enquiry call from a freight ` +
    `brokerage to the transporter ${vendorName}. Ask for their best all-inclusive rate in rupees for ` +
    `${req.weightT} tonnes of ${req.cargo} from ${req.origin} to ${req.destination}, ` +
    `${VEHICLE_TYPE_LABEL[req.vehicleType]} ${req.bodySizeFt} ft ${req.axle} axle, loading ${req.loadingDate} ` +
    `at ${req.loadingTime}. Also ask whether toll and GST are included and whether a vehicle is free on the ` +
    `loading date. End by asking them to repeat the rate once for confirmation. English only, one short paragraph.`;

  try {
    const res = await fetchImpl(`${(cfg.modelBaseUrl || MODEL_BASE_URL).replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'api-subscription-key': cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          {
            role: 'system',
            content:
              'You write concise, polite telephone scripts for an Indian freight brokerage. Reply with the script text only, in English.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 260,
        reasoning_effort: null,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      return { script: fallback, source: 'template', detail: `Sarvam ${res.status}: ${body.slice(0, 160)}` };
    }
    const json = JSON.parse(body) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return { script: fallback, source: 'template', detail: 'Sarvam returned an empty script' };
    return { script: text.slice(0, 1500), source: 'sarvam' };
  } catch (err) {
    return {
      script: fallback,
      source: 'template',
      detail: err instanceof Error ? err.message : 'Sarvam model call failed',
    };
  }
}

/* ------------------------------------------------------------- call result */

export interface SarvamWebhookEvent {
  attemptId: string | null;
  status: SarvamCallStatus;
  durationSec: number | null;
  interactionId: string | null;
  failureReason: string | null;
  requirementId: string | null;
  transcript: string | null;
  userText: string | null;
}

const STATUSES: SarvamCallStatus[] = ['queued', 'connected', 'no_answer', 'busy', 'failed'];

/** Reads the call result Sarvam posts after an outbound attempt finishes. */
export function parseSarvamWebhook(body: unknown): SarvamWebhookEvent | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const rawStatus = String(obj.status ?? '');
  if (!STATUSES.includes(rawStatus as SarvamCallStatus)) return null;

  const webhook =
    obj.webhook_config && typeof obj.webhook_config === 'object'
      ? (obj.webhook_config as Record<string, unknown>)
      : {};
  const metadata =
    webhook.metadata && typeof webhook.metadata === 'object' ? (webhook.metadata as Record<string, unknown>) : {};

  const turns = Array.isArray(obj.interaction_transcript) ? obj.interaction_transcript : [];
  const lines: string[] = [];
  const userLines: string[] = [];
  for (const turn of turns) {
    if (!turn || typeof turn !== 'object') continue;
    const t = turn as Record<string, unknown>;
    const role = String(t.role ?? '');
    const text = typeof t.en_text === 'string' ? t.en_text.trim() : '';
    if (!text) continue;
    lines.push(`${role === 'user' ? 'Vendor' : 'Agent'}: ${text}`);
    if (role === 'user') userLines.push(text);
  }

  return {
    attemptId: typeof obj.attempt_id === 'string' ? obj.attempt_id : null,
    status: rawStatus as SarvamCallStatus,
    durationSec: typeof obj.duration === 'number' ? obj.duration : null,
    interactionId: typeof obj.interaction_id === 'string' ? obj.interaction_id : null,
    failureReason: typeof obj.failure_reason === 'string' ? obj.failure_reason : null,
    requirementId: typeof metadata.requirementId === 'string' ? metadata.requirementId : null,
    transcript: lines.length > 0 ? lines.join('\n') : null,
    userText: userLines.length > 0 ? userLines.join(' ') : null,
  };
}

export interface SarvamOutcome {
  ok: boolean;
  detail: string;
  callId?: string;
  quoteId?: string;
}

/**
 * Applies a Sarvam call result: updates the call record and turns the vendor's
 * spoken answer into a quote, subject to the usual confidence and rate-card
 * checks.
 */
export function applySarvamCallResult(store: Store, event: SarvamWebhookEvent): SarvamOutcome {
  const call =
    (event.attemptId ? store.calls.find((c) => c.attemptId === event.attemptId) : undefined) ??
    store.calls
      .slice()
      .reverse()
      .find((c) => c.status === 'queued' && (!event.requirementId || c.requirementId === event.requirementId));

  if (!call) return { ok: false, detail: 'No Sarvam call matches this webhook' };

  call.status = event.status;
  call.durationSec = event.durationSec;
  call.interactionId = event.interactionId;
  call.failureReason = event.failureReason;
  call.transcript = event.transcript;
  call.completedAt = event.status === 'queued' ? null : new Date().toISOString();

  if (event.status !== 'connected' || !event.userText) {
    return { ok: true, detail: `call ${call.id} is ${event.status}`, callId: call.id };
  }

  const requirement = getRequirement(store, call.requirementId);
  if (!requirement) return { ok: true, detail: `call ${call.id} has no requirement`, callId: call.id };
  if (call.quoteId) {
    // A re-delivered transcript repairs a quote whose rate could not be read the
    // first time (for example a spoken reply that needed the number-word parser).
    const existing = store.quotes.find((q) => q.id === call.quoteId);
    if (!existing || existing.rate !== null) {
      return { ok: true, detail: `call ${call.id} already produced ${call.quoteId}`, callId: call.id, quoteId: call.quoteId };
    }
    const again = parseQuoteReply(event.userText, requirement.rateCardRate);
    if (again.rate === null) {
      return { ok: true, detail: `call ${call.id} already produced ${call.quoteId}`, callId: call.id, quoteId: call.quoteId };
    }
    const repaired = withNormalisation({
      ...existing,
      rate: again.rate,
      tollIncluded: again.tollIncluded,
      availableOnDate: again.availableOnDate,
      conditions: again.conditions,
      confidence: again.confidence,
      rawText: event.userText,
    });
    repaired.flagReason = flagReason(repaired.rate, repaired.confidence, requirement.rateCardRate);
    Object.assign(existing, repaired);
    return { ok: true, detail: `re-parsed ${existing.id} from ${call.vendorName}`, callId: call.id, quoteId: existing.id };
  }

  const parsed = parseQuoteReply(event.userText, requirement.rateCardRate);
  store.counters.quote += 1;
  const quote: Quote = withNormalisation({
    id: `Q-${store.counters.quote}`,
    requirementId: requirement.id,
    vendorId: call.vendorId,
    vendorName: call.vendorName,
    rate: parsed.rate,
    tollIncluded: parsed.tollIncluded,
    availableOnDate: parsed.availableOnDate,
    conditions: parsed.conditions,
    channel: 'voice',
    rawText: event.userText,
    confidence: parsed.confidence,
    receivedAt: new Date().toISOString(),
    flagReason: null,
    verified: false,
    tollAllowance: 0,
    normalisedRate: 0,
  });
  quote.flagReason = flagReason(quote.rate, quote.confidence, requirement.rateCardRate);
  store.quotes.push(quote);
  call.quoteId = quote.id;

  const attempt = store.attempts.find((a) => a.requirementId === requirement.id && a.vendorId === call.vendorId);
  if (attempt) {
    attempt.status = 'replied';
    attempt.reply = event.userText;
    attempt.repliedAt = new Date().toISOString();
  }

  if (requirement.status === 'intake' || requirement.status === 'shortlisted' || requirement.status === 'outreach') {
    requirement.status = 'quoted';
  }
  return { ok: true, detail: `parsed ${quote.id} from ${call.vendorName}`, callId: call.id, quoteId: quote.id };
}

/* -------------------------------------------------------------- pull result */

/** ISO 8601 stamp with an explicit IST offset, which the analytics API requires. */
function istStamp(ms: number): string {
  const shifted = new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 19);
  return `${shifted}+05:30`;
}

function analyticsScope(cfg: SarvamConfig): { base: string; key: string } | null {
  const key = sarvamVoiceKey(cfg);
  if (!key || !cfg.orgId || !cfg.workspaceId || !cfg.appId) return null;
  return {
    base: `${ANALYTICS_BASE_URL}/v1/${encodeURIComponent(cfg.orgId)}/${encodeURIComponent(cfg.workspaceId)}/${encodeURIComponent(cfg.appId)}`,
    key,
  };
}

interface AnalyticsAttempt {
  attempt_id?: unknown;
  interaction_id?: unknown;
  connectivity_status?: unknown;
  failure_reason?: unknown;
  duration_in_seconds?: unknown;
}

interface AnalyticsInteraction {
  interaction_id?: unknown;
  translate_transcript?: { role?: unknown; text?: unknown }[];
}

async function analyticsGet(
  url: string,
  key: string,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown> | null> {
  const res = await fetchImpl(url, { headers: { 'X-API-Key': key } });
  if (!res.ok) return null;
  const text = await res.text();
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    return json;
  } catch {
    return null;
  }
}

/**
 * Reads an attempt from the Sarvam analytics API. The instant-outbound call only
 * ever returns an attempt id, so this is how a result can be collected when no
 * public webhook URL is available.
 */
export async function fetchSarvamAttemptResult(
  attemptId: string,
  cfg: SarvamConfig = config.sarvam,
  fetchImpl: FetchLike = fetch,
): Promise<{ status: SarvamCallStatus; durationSec: number | null; interactionId: string | null; failureReason: string | null; turns: { role: string; en_text: string }[] } | null> {
  const scope = analyticsScope(cfg);
  if (!scope || !attemptId) return null;

  const now = Date.now();
  const params = new URLSearchParams({
    start_datetime: istStamp(now - 3 * 24 * 60 * 60 * 1000),
    end_datetime: istStamp(now + 24 * 60 * 60 * 1000),
    limit: '50',
    filter_conditions: JSON.stringify([{ field: 'attempt_id', operator: 'equals', value: attemptId }]),
  });
  const attempts = await analyticsGet(`${scope.base}/attempts?${params.toString()}`, scope.key, fetchImpl);
  const items = Array.isArray(attempts?.items) ? (attempts?.items as AnalyticsAttempt[]) : [];
  const attempt = items.find((item) => item.attempt_id === attemptId);
  if (!attempt) return null;

  const rawStatus = String(attempt.connectivity_status ?? '');
  const status: SarvamCallStatus = STATUSES.includes(rawStatus as SarvamCallStatus)
    ? (rawStatus as SarvamCallStatus)
    : 'queued';
  const interactionId = typeof attempt.interaction_id === 'string' ? attempt.interaction_id : null;
  const failure = typeof attempt.failure_reason === 'string' && attempt.failure_reason !== 'NO_FAILURE_REASON' ? attempt.failure_reason : null;
  const durationSec = typeof attempt.duration_in_seconds === 'number' ? attempt.duration_in_seconds : null;

  let turns: { role: string; en_text: string }[] = [];
  if (status === 'connected' && interactionId) {
    const iParams = new URLSearchParams({
      start_datetime: istStamp(now - 3 * 24 * 60 * 60 * 1000),
      end_datetime: istStamp(now + 24 * 60 * 60 * 1000),
      include_transcript: 'true',
      limit: '20',
    });
    const list = await analyticsGet(`${scope.base}/interactions?${iParams.toString()}`, scope.key, fetchImpl);
    const rows = Array.isArray(list?.items) ? (list?.items as AnalyticsInteraction[]) : [];
    const interaction = rows.find((row) => row.interaction_id === interactionId);
    turns = (interaction?.translate_transcript ?? [])
      .map((turn) => ({ role: String(turn.role ?? ''), en_text: String(turn.text ?? '').trim() }))
      .filter((turn) => turn.en_text.length > 0);
  }

  return { status, durationSec, interactionId, failureReason: failure, turns };
}

/** Polls Sarvam for one queued call and applies the result like a webhook would. */
export async function syncSarvamCall(
  store: Store,
  callId: string,
  cfg: SarvamConfig = config.sarvam,
  fetchImpl: FetchLike = fetch,
): Promise<SarvamOutcome> {
  const call = store.calls.find((c) => c.id === callId);
  if (!call) return { ok: false, detail: `Call ${callId} not found` };
  if (!call.attemptId) return { ok: false, detail: `Call ${callId} was never accepted by Sarvam`, callId: call.id };

  const result = await fetchSarvamAttemptResult(call.attemptId, cfg, fetchImpl);
  if (!result) return { ok: true, detail: `Sarvam has no result for ${call.attemptId} yet`, callId: call.id };
  if (result.status === 'queued') {
    return { ok: true, detail: `Sarvam is still working on ${call.attemptId}`, callId: call.id };
  }

  const event = parseSarvamWebhook({
    attempt_id: call.attemptId,
    status: result.status,
    duration: result.durationSec,
    interaction_id: result.interactionId,
    failure_reason: result.failureReason,
    interaction_transcript: result.turns,
  });
  if (!event) return { ok: false, detail: 'Sarvam returned an unreadable result', callId: call.id };
  return applySarvamCallResult(store, event);
}

export interface SarvamStatus {
  configured: boolean;
  vendorName: string;
  vendorPhone: string;
  model: string;
}

export function sarvamStatus(cfg: SarvamConfig = config.sarvam): SarvamStatus {
  return {
    configured: sarvamConfigured(cfg),
    vendorName: cfg.vendorName,
    vendorPhone: cfg.vendorPhone,
    model: cfg.model,
  };
}
