import fs from "node:fs";
import path from "node:path";

/**
 * Walks up from this file until it finds the workspace root package.json, so the
 * database path does not depend on where the process was started from.
 */
export function projectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkg, "utf8")) as {
          workspaces?: unknown;
        };
        if (Array.isArray(json.workspaces)) return dir;
      } catch {
        // unreadable package.json, keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Minimal .env reader: KEY=value lines, # comments, existing env wins. */
function loadDotEnv(root: string): void {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string;
}

export interface TwilioWhatsappConfig {
  accountSid: string;
  authToken: string;
  from: string;
  template?: string;
}

export interface SarvamConfig {
  /** Model API key (Sent as api-subscription-key and X-API-Key) */
  apiKey: string | null;
  modelBaseUrl: string;
  model: string;
  /** Sarvam Voice Agents ids, copied from the dashboard URL */
  orgId: string | null;
  workspaceId: string | null;
  appId: string | null;
  appVersion: number;
  connectionId: string | null;
  agentPhoneNumber: string | null;
  /** webhook Sarvam posts call results to; must carry ?token=<WEBHOOK_TOKEN> */
  webhookUrl: string | null;
  /** the single vendor this integration is allowed to call */
  vendorName: string;
  vendorPhone: string;
}

export interface AppConfig {
  port: number;
  dbPath: string;
  sessionTtlDays: number;
  /** shared secret for inbound webhooks from WhatsApp/Twilio */
  webhookToken: string;
  /** how long a live-mode outreach waits for a reply before it is marked no_response */
  replyTimeoutMs: number;
  twilio: TwilioConfig | null;
  twilioWhatsapp: TwilioWhatsappConfig | null;
  sarvam: SarvamConfig;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function loadConfig(): AppConfig {
  const root = projectRoot();
  loadDotEnv(root);

  const twilioSid = env("TWILIO_ACCOUNT_SID");
  const twilioToken = env("TWILIO_AUTH_TOKEN");
  const twilioFrom = env("TWILIO_FROM");
  const waTemplate = env("WHATSAPP_TEMPLATE");
  const twilioWhatsappFrom = env("TWILIO_WHATSAPP_FROM");

  return {
    port: Number(env("PORT") ?? 4000) || 4000,
    dbPath: env("DB_PATH") ?? path.join(root, "data", "freightdesk.db"),
    sessionTtlDays: Number(env("SESSION_TTL_DAYS") ?? 7) || 7,
    webhookToken: env("WEBHOOK_TOKEN") ?? "freightdesk-dev-token",
    replyTimeoutMs:
      Number(env("REPLY_TIMEOUT_MS") ?? 15 * 60_000) || 15 * 60_000,
    twilio:
      twilioSid && twilioToken && twilioFrom
        ? { accountSid: twilioSid, authToken: twilioToken, from: twilioFrom }
        : null,
    twilioWhatsapp:
      twilioSid && twilioToken && twilioWhatsappFrom
        ? {
            accountSid: twilioSid,
            authToken: twilioToken,
            from: twilioWhatsappFrom,
            ...(waTemplate ? { template: waTemplate } : {}),
          }
        : null,
    sarvam: {
      apiKey: env("SARVAM_API_KEY") ?? null,
      modelBaseUrl: env("SARVAM_MODEL_BASE_URL") ?? "https://api.sarvam.ai",
      model: env("SARVAM_MODEL") ?? "sarvam-105b",
      orgId: env("SARVAM_ORG_ID") ?? null,
      workspaceId: env("SARVAM_WORKSPACE_ID") ?? null,
      appId: env("SARVAM_APP_ID") ?? null,
      appVersion: Number(env("SARVAM_APP_VERSION") ?? 1) || 1,
      connectionId: env("SARVAM_CONNECTION_ID") ?? null,
      agentPhoneNumber: env("SARVAM_AGENT_PHONE_NUMBER") ?? null,
      webhookUrl: env("SARVAM_WEBHOOK_URL") ?? null,
      vendorName: env("SARVAM_VENDOR_NAME") ?? "David Transportation",
      vendorPhone: env("SARVAM_VENDOR_PHONE") ?? "6385106931",
    },
  };
}

export const config: AppConfig = loadConfig();
