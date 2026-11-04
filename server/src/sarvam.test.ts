import assert from 'node:assert/strict';
import test from 'node:test';
import type { Requirement, SarvamCall } from '../../shared/types';
import type { FetchLike } from './channels';
import type { SarvamConfig } from './config';
import {
  applySarvamCallResult,
  enquiryScript,
  generateEnquiryScript,
  isAllowedSarvamNumber,
  normaliseIndianPhone,
  parseSarvamWebhook,
  placeSarvamCall,
  sarvamOutboundPayload,
} from './sarvam';
import { newStore } from './store';

function cfg(overrides: Partial<SarvamConfig> = {}): SarvamConfig {
  return {
    apiKey: 'sarvam-key',
    modelBaseUrl: 'https://api.sarvam.ai',
    model: 'sarvam-105b',
    orgId: 'org-1',
    workspaceId: 'ws-1',
    appId: 'app-1',
    appVersion: 1,
    connectionId: 'conn-1',
    agentPhoneNumber: '+918000000000',
    webhookUrl: 'https://example.test/api/webhooks/sarvam?token=tok',
    vendorName: 'David Transportation',
    vendorPhone: '6385106931',
    ...overrides,
  };
}

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'REQ-T1',
    customerName: 'Test Customer',
    origin: 'Ambattur',
    destination: 'Bengaluru',
    cargo: 'General',
    weightT: 9,
    vehicleType: 'open_truck',
    bodySizeFt: 32,
    axle: 'multi',
    loadingDate: '2026-11-05',
    loadingTime: '08:00',
    notes: '',
    status: 'shortlisted',
    createdAt: new Date().toISOString(),
    rateCardRate: 41000,
    rateCardMatch: 'exact',
    rateCardNote: '',
    marginPct: null,
    l1QuoteId: null,
    ...overrides,
  };
}

function call(overrides: Partial<SarvamCall> = {}): SarvamCall {
  return {
    id: 'SC-1',
    attemptId: 'att-1',
    requirementId: 'REQ-T1',
    vendorId: 69,
    vendorName: 'David Transportation',
    phone: '+91 63851 06931',
    script: 'script',
    status: 'queued',
    interactionId: null,
    durationSec: null,
    failureReason: null,
    transcript: null,
    quoteId: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

test('normalises Indian numbers and allows only the configured vendor', () => {
  assert.equal(normaliseIndianPhone('6385106931'), '+916385106931');
  assert.equal(normaliseIndianPhone('+91 63851 06931'), '+916385106931');
  assert.equal(isAllowedSarvamNumber('6385106931', cfg()), true);
  assert.equal(isAllowedSarvamNumber('+91 63851 06931', cfg()), true);
  assert.equal(isAllowedSarvamNumber('+91 98400 11223', cfg()), false);
});

test('outbound payload targets the Sarvam outbounds API with the allowed number', () => {
  const { url, init } = sarvamOutboundPayload('6385106931', cfg(), { requirementId: 'REQ-T1' });
  assert.equal(url, 'https://apps.sarvam.ai/api/outbounds/v1/orgs/org-1/workspaces/ws-1/outbounds');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['X-API-Key'], 'sarvam-key');
  const body = JSON.parse(String(init.body)) as {
    app_config: { app_id: string; connection_config: { agent_phone_number: string } };
    user_config: { user_phone_number: string };
    webhook_config: { metadata: { requirementId: string } };
  };
  assert.equal(body.app_config.app_id, 'app-1');
  assert.equal(body.app_config.connection_config.agent_phone_number, '+918000000000');
  assert.equal(body.user_config.user_phone_number, '+916385106931');
  assert.equal(body.webhook_config.metadata.requirementId, 'REQ-T1');
});

test('outbound payload refuses any other number', () => {
  assert.throws(() => sarvamOutboundPayload('+91 98400 11223', cfg()), /may only call David Transportation/);
  assert.throws(() => sarvamOutboundPayload('6385106931', cfg({ apiKey: null })), /not configured/);
});

test('placeSarvamCall returns the attempt id and surfaces provider errors', async () => {
  const okFetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{"attempt_id":"att-9"}' });
  const ok = await placeSarvamCall('6385106931', cfg(), {}, okFetch);
  assert.equal(ok.ok, true);
  assert.equal(ok.attemptId, 'att-9');

  const failFetch: FetchLike = async () => ({ ok: false, status: 422, text: async () => 'bad request' });
  const fail = await placeSarvamCall('6385106931', cfg(), {}, failFetch);
  assert.equal(fail.ok, false);
  assert.ok(fail.detail.includes('422'));
});

test('enquiry script asks for the rate, tolls and availability', () => {
  const script = enquiryScript(requirement(), 'David Transportation');
  assert.ok(script.includes('David Transportation'));
  assert.ok(script.includes('Ambattur'));
  assert.ok(script.includes('Bengaluru'));
  assert.ok(script.toLowerCase().includes('best rate'));
  assert.ok(script.toLowerCase().includes('toll'));
});

test('generateEnquiryScript uses the Sarvam model and falls back on failure', async () => {
  const okFetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    text: async () => '{"choices":[{"message":{"content":"Hello, please share your rate."}}]}',
  });
  const generated = await generateEnquiryScript(requirement(), 'David Transportation', cfg(), okFetch);
  assert.equal(generated.source, 'sarvam');
  assert.equal(generated.script, 'Hello, please share your rate.');

  const boom: FetchLike = async () => {
    throw new Error('network down');
  };
  const fallback = await generateEnquiryScript(requirement(), 'David Transportation', cfg(), boom);
  assert.equal(fallback.source, 'template');
  assert.ok(fallback.script.includes('best rate'));
});

test('parses the Sarvam call webhook into a transcript and vendor answer', () => {
  const event = parseSarvamWebhook({
    attempt_id: 'att-1',
    status: 'connected',
    duration: 22.5,
    interaction_id: 'int-1',
    failure_reason: null,
    webhook_config: { url: 'https://example.test', metadata: { requirementId: 'REQ-T1' } },
    interaction_transcript: [
      { role: 'agent', en_text: 'What is your best rate?' },
      { role: 'user', en_text: 'Rs. 41,000 toll included, vehicle ready' },
    ],
  });
  assert.ok(event);
  assert.equal(event?.status, 'connected');
  assert.equal(event?.durationSec, 22.5);
  assert.equal(event?.requirementId, 'REQ-T1');
  assert.equal(event?.userText, 'Rs. 41,000 toll included, vehicle ready');
  assert.ok(event?.transcript?.includes('Agent: What is your best rate?'));
  assert.equal(parseSarvamWebhook({ status: 'unknown' }), null);
  assert.equal(parseSarvamWebhook(null), null);
});

test('a connected Sarvam call becomes a quote through the standard parser', () => {
  const store = newStore();
  store.requirements.push(requirement());
  store.vendors.push({
    id: 69,
    name: 'David Transportation',
    phone: '+91 63851 06931',
    whatsapp: '+91 63851 06931',
    origins: ['Ambattur'],
    corridors: ['Bengaluru'],
    vehicleTypes: ['open_truck'],
    bodySizes: [32],
    axles: ['multi'],
    maxCapacityT: 25,
    cargoTypes: ['General'],
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
  });
  store.calls.push(call());

  const outcome = applySarvamCallResult(store, {
    attemptId: 'att-1',
    status: 'connected',
    durationSec: 20,
    interactionId: 'int-1',
    failureReason: null,
    requirementId: 'REQ-T1',
    transcript: 'Agent: rate?\nVendor: Rs. 41,000 toll included, vehicle ready',
    userText: 'Rs. 41,000 toll included, vehicle ready',
  });

  assert.equal(outcome.ok, true);
  assert.ok(outcome.quoteId);
  assert.equal(store.quotes.length, 1);
  assert.equal(store.quotes[0]?.rate, 41000);
  assert.equal(store.quotes[0]?.tollIncluded, true);
  assert.equal(store.quotes[0]?.vendorName, 'David Transportation');
  assert.equal(store.calls[0]?.status, 'connected');
  assert.equal(store.calls[0]?.quoteId, outcome.quoteId);
  assert.equal(store.requirements[0]?.status, 'quoted');
});

test('a call that does not connect records the result without a quote', () => {
  const store = newStore();
  store.requirements.push(requirement());
  store.calls.push(call());

  const outcome = applySarvamCallResult(store, {
    attemptId: 'att-1',
    status: 'no_answer',
    durationSec: null,
    interactionId: null,
    failureReason: null,
    requirementId: 'REQ-T1',
    transcript: null,
    userText: null,
  });

  assert.equal(outcome.ok, true);
  assert.equal(store.quotes.length, 0);
  assert.equal(store.calls[0]?.status, 'no_answer');
  assert.ok(store.calls[0]?.completedAt);
});
