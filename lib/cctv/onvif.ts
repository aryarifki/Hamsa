import { createHash, randomBytes } from "node:crypto";

/**
 * Minimal ONVIF Events client (PullPoint), no SOAP dependency.
 *
 * The flow is the standard one:
 *   GetCapabilities(Events) → Events XAddr
 *   CreatePullPointSubscription → SubscriptionReference/Address
 *   PullMessages → wsnt:NotificationMessage*
 *
 * The transport is injectable; tests feed canned SOAP bodies, production uses
 * `fetchTransport`. Only PullPoint is implemented — cameras that exclusively
 * push (Basic Notification) need an HTTP endpoint and are out of scope for this
 * module, which is an explicit limitation in the README.
 */

export interface SoapResponse {
  status: number;
  body: string;
}

export type OnvifCredentials = { username?: string; password?: string };

export type SoapTransport = (
  url: string,
  body: string,
  headers?: Record<string, string>,
) => Promise<SoapResponse>;

export class OnvifError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** WS-Security UsernameToken with a SHA-1 password digest (ONVIF's default). */
export function wsSecurity(username: string, password: string): string {
  const nonce = randomBytes(16);
  const created = new Date().toISOString();
  const digest = createHash("sha1")
    .update(Buffer.concat([nonce, Buffer.from(created, "utf8"), Buffer.from(password, "utf8")]))
    .digest("base64");

  return `<wsse:Security s:mustUnderstand="1">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password>
        <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</wsse:Nonce>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>`;
}

function envelope(body: string, credentials?: OnvifCredentials): string {
  const security = credentials?.username ? wsSecurity(credentials.username, credentials.password ?? "") : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
            xmlns:tev="http://www.onvif.org/ver10/events/wsdl"
            xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"
            xmlns:wsa="http://www.w3.org/2005/08/addressing"
            xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
            xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>${security}</s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

export const fetchTransport: SoapTransport = async (url, body, headers = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/soap+xml; charset=utf-8", ...headers },
      body,
      signal: controller.signal,
    });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
};

/* ─────────────────────────────── endpoints ───────────────────────────────── */

const HOST_RE = /^[a-zA-Z0-9.-]+(:[0-9]{1,5})?$/;

/** Accepts `10.0.0.9`, `10.0.0.9:8000`, `http://10.0.0.9/onvif/device_service`. */
export function normaliseOnvifHost(input: string): string {
  const value = input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!HOST_RE.test(value)) throw new Error("ONVIF host must be hostname or hostname:port");
  return value;
}

export function onvifDeviceUrl(host: string): string {
  const value = host.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(value)) {
    return value.endsWith("/onvif/device_service") ? value : `${value}/onvif/device_service`;
  }
  return `http://${value}/onvif/device_service`;
}

function ensureOk(response: SoapResponse, what: string): void {
  if (response.status === 401 || response.status === 403) {
    throw new OnvifError(`ONVIF authentication failed during ${what}`, response.status);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new OnvifError(`ONVIF ${what} returned HTTP ${response.status}`, response.status);
  }
}

export async function discoverEventsUrl(
  deviceUrl: string,
  transport: SoapTransport,
  credentials?: OnvifCredentials,
): Promise<string | null> {
  const response = await transport(
    deviceUrl,
    envelope(
      `<tds:GetCapabilities><tds:Category>Events</tds:Category></tds:GetCapabilities>`,
      credentials,
    ),
  );
  ensureOk(response, "GetCapabilities");

  const section = /<(?:[\w.-]+:)?Events\b[\s\S]*?<\/(?:[\w.-]+:)?Events>/i.exec(response.body)?.[0];
  const address = section?.match(/<(?:[\w.-]+:)?XAddr>\s*([^<\s]+)\s*<\//i)?.[1];
  return address?.trim() || null;
}

export async function createPullSubscription(
  eventsUrl: string,
  transport: SoapTransport,
  credentials?: OnvifCredentials,
  ttlSeconds = 600,
): Promise<string> {
  const response = await transport(
    eventsUrl,
    envelope(
      `<tev:CreatePullPointSubscription>
         <tev:InitialTerminationTime>PT${Math.max(60, ttlSeconds)}S</tev:InitialTerminationTime>
       </tev:CreatePullPointSubscription>`,
      credentials,
    ),
  );
  ensureOk(response, "CreatePullPointSubscription");

  const reference = /<(?:[\w.-]+:)?SubscriptionReference\b[\s\S]*?<\/(?:[\w.-]+:)?SubscriptionReference>/i.exec(
    response.body,
  )?.[0];
  const address = reference?.match(/<(?:[\w.-]+:)?Address>\s*([^<\s]+)\s*<\//i)?.[1];
  return address?.trim() || eventsUrl;
}

/* ─────────────────────────────── notifications ───────────────────────────── */

export interface OnvifNotification {
  topic: string;
  utcTime: string | null;
  motion: boolean;
  source: string | null;
}

export function parseNotifications(xml: string): OnvifNotification[] {
  const blocks = xml.match(/<(?:[\w.-]+:)?NotificationMessage\b[\s\S]*?<\/(?:[\w.-]+:)?NotificationMessage>/gi) ?? [];
  const notifications: OnvifNotification[] = [];

  for (const block of blocks) {
    const topic = block.match(/<(?:[\w.-]+:)?Topic[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Topic>/i)?.[1]?.trim() ?? "";
    const utcTime = block.match(/UtcTime="([^"]+)"/i)?.[1] ?? null;
    const source = block.match(/Source="([^"]*)"/i)?.[1] ?? null;
    const value = block.match(/Name=["']IsMotion["'][^>]*Value=["'](true|false)["']/i)?.[1];
    const motion = /motion/i.test(topic) && (value ? value.toLowerCase() === "true" : true);

    notifications.push({ topic, utcTime, motion, source });
  }

  return notifications;
}

export async function pullMessages(
  subscriptionUrl: string,
  transport: SoapTransport,
  credentials?: OnvifCredentials,
  options: { timeoutSeconds?: number; max?: number } = {},
): Promise<OnvifNotification[]> {
  const timeout = Math.max(1, options.timeoutSeconds ?? 5);
  const max = Math.max(1, options.max ?? 10);

  const response = await transport(
    subscriptionUrl,
    envelope(
      `<wsnt:PullMessages>
         <wsnt:Timeout>PT${timeout}S</wsnt:Timeout>
         <wsnt:MessageLimit>${max}</wsnt:MessageLimit>
       </wsnt:PullMessages>`,
      credentials,
    ),
  );
  ensureOk(response, "PullMessages");
  return parseNotifications(response.body);
}
