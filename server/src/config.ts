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
  };
}

export const config: AppConfig = loadConfig();
