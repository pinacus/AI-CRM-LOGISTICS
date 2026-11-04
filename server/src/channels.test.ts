import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WHATSAPP_TEMPLATE,
  channelModes,
  modeFor,
  parseInbound,
  phoneKey,
  placeVoiceCall,
  sendWhatsApp,
  twilioCallPayload,
  twilioWhatsAppPayload,
  whatsappMessage,
  type FetchLike,
} from "./channels";
import type { AppConfig } from "./config";

function cfg(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 4000,
    dbPath: "/tmp/x.db",
    sessionTtlDays: 7,
    webhookToken: "tok",
    replyTimeoutMs: 1000,
twilio: { accountSid: 'AC123', authToken: 'secret', from: '+911100001111' },
    twilioWhatsapp: {
      accountSid: 'AC123',
      authToken: 'secret',
      from: 'whatsapp:+14155238886',
    },
    sarvam: {
      apiKey: 'sarvam-key',
      voiceApiKey: 'sarvam-voice-key',
      modelBaseUrl: 'https://api.sarvam.ai',
      model: 'sarvam-105b',
      orgId: 'org',
      workspaceId: 'ws',
      appId: 'app',
      appVersion: 1,
      connectionId: 'conn',
      agentPhoneNumber: '+918000000000',
      webhookUrl: null,
      vendorName: 'David Transportation',
      vendorPhone: '6385106931',
    },
    ...overrides,
  };
}

test("mode is simulation without credentials and live with them", () => {
  assert.equal(modeFor("whatsapp", cfg()), "live");
  assert.equal(modeFor("voice", cfg()), "live");
  assert.equal(
    modeFor("whatsapp", cfg({ twilioWhatsapp: null })),
    "simulation",
  );
  assert.equal(modeFor("voice", cfg({ twilio: null })), "simulation");
  assert.deepEqual(channelModes(cfg({ twilioWhatsapp: null, twilio: null })), {
    whatsapp: "simulation",
    voice: "simulation",
  });
});

test("twilio WhatsApp payload uses the Messages API and WhatsApp addresses", () => {
  const { url, init } = twilioWhatsAppPayload("+91 98400 11223", "Best rate?", {
    accountSid: "AC123",
    authToken: "secret",
    from: "whatsapp:+14155238886",
  });
  assert.equal(
    url,
    "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json",
  );
  const headers = init.headers as Record<string, string>;
  assert.equal(
    headers.Authorization,
    `Basic ${Buffer.from("AC123:secret").toString("base64")}`,
  );
  const params = new URLSearchParams(String(init.body));
  assert.equal(params.get("To"), "whatsapp:+919840011223");
  assert.equal(params.get("From"), "whatsapp:+14155238886");
  assert.equal(params.get("Body"), "Best rate?");
});

test("whatsapp template renders requirement values dynamically", () => {
  const message = whatsappMessage(
    {
      id: "REQ-1",
      customerName: "Customer",
      origin: "Chennai",
      destination: "Pune",
      cargo: "General",
      weightT: 12,
      vehicleType: "container",
      bodySizeFt: 32,
      axle: "multi",
      loadingDate: "2026-11-05",
      loadingTime: "06:30",
      notes: "",
      status: "intake",
      createdAt: "",
      rateCardRate: null,
      rateCardMatch: "none",
      rateCardNote: "",
      marginPct: null,
      l1QuoteId: null,
    },
    "North Star Logistics",
    DEFAULT_WHATSAPP_TEMPLATE,
  );
  assert.equal(
    message,
    "Hello North Star Logistics, we need a Container (32 ft) for 12 tonnes\n" +
      "from Chennai to Pune. Loading: 2026-11-05, 06:30.\n" +
      "Please reply with your best rate (Rs.) for this trip.",
  );
});

test("twilio payload posts urlencoded TwiML with basic auth and escapes XML", () => {
  const { url, init } = twilioCallPayload(
    "+919840011223",
    "Rate <now> & go",
    cfg().twilio!,
  );
  assert.equal(
    url,
    "https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json",
  );
  const headers = init.headers as Record<string, string>;
  assert.equal(
    headers.Authorization,
    `Basic ${Buffer.from("AC123:secret").toString("base64")}`,
  );
  assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
  const params = new URLSearchParams(String(init.body));
  assert.equal(params.get("To"), "+919840011223");
  assert.equal(params.get("From"), "+911100001111");
  const twiml = params.get("Twiml") ?? "";
  assert.ok(twiml.includes("Rate &lt;now&gt; &amp; go"));
  assert.ok(twiml.startsWith("<?xml"));
});

test("sendWhatsApp reports success and failure from the provider", async () => {
  const okFetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    text: async () => '{"messages":[{"id":"1"}]}',
  });
  const ok = await sendWhatsApp("+919840011223", "hi", cfg(), okFetch);
  assert.equal(ok.ok, true);
  assert.equal(ok.provider, "whatsapp");

  const failFetch: FetchLike = async () => ({
    ok: false,
    status: 401,
    text: async () => "unauthorized",
  });
  const fail = await sendWhatsApp("+919840011223", "hi", cfg(), failFetch);
  assert.equal(fail.ok, false);
  assert.ok(fail.detail.includes("401"));

  const noCreds = await sendWhatsApp(
    "+919840011223",
    "hi",
    cfg({ twilioWhatsapp: null }),
    okFetch,
  );
  assert.equal(noCreds.ok, false);
  assert.ok(noCreds.detail.includes("not configured"));
});

test("placeVoiceCall posts to Twilio and surfaces errors", async () => {
  const okFetch: FetchLike = async () => ({
    ok: true,
    status: 201,
    text: async () => '{"sid":"CA1"}',
  });
  const ok = await placeVoiceCall("+919840011223", "hello", cfg(), okFetch);
  assert.equal(ok.ok, true);

  const boom: FetchLike = async () => {
    throw new Error("network down");
  };
  const err = await placeVoiceCall("+919840011223", "hello", cfg(), boom);
  assert.equal(err.ok, false);
  assert.equal(err.detail, "network down");

  const noCreds = await placeVoiceCall(
    "+919840011223",
    "hello",
    cfg({ twilio: null }),
    okFetch,
  );
  assert.equal(noCreds.ok, false);
});

test("parseInbound handles Twilio form, WhatsApp JSON and plain JSON", () => {
  assert.deepEqual(
    parseInbound({ From: "+919840011223", Body: "38500 rupees, toll extra" }),
    {
      phone: "+919840011223",
      text: "38500 rupees, toll extra",
    },
  );
  assert.deepEqual(parseInbound({ from: "+919840011223", text: "41000" }), {
    phone: "+919840011223",
    text: "41000",
  });
  const whatsapp = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { from: "919840011223", text: { body: "Rs. 39,500" } },
              ],
            },
          },
        ],
      },
    ],
  };
  assert.deepEqual(parseInbound(whatsapp), {
    phone: "919840011223",
    text: "Rs. 39,500",
  });
  assert.equal(parseInbound(null), null);
  assert.equal(parseInbound({}), null);
  assert.equal(parseInbound({ from: "x" }), null);
});

test("phoneKey reduces any format to the last 10 digits", () => {
  assert.equal(phoneKey("+91 98400 11223"), "9840011223");
  assert.equal(phoneKey("919840011223"), "9840011223");
  assert.equal(phoneKey("9840011223"), "9840011223");
});
