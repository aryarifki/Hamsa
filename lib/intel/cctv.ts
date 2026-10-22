import net from "node:net";

/**
 * Connectivity probe for cameras the account owner has registered.
 *
 * Hamsa deliberately contains no vendor key material and no discovery of
 * third-party cameras. You register a stream you control (or are contracted to
 * monitor) and Hamsa tells you whether it is reachable.
 */
export interface CctvProbeResult {
  online: boolean;
  latencyMs: number | null;
  detail: string;
  contentType: string | null;
}

function parseEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  const allowed = new Set(["rtsp:", "rtsps:", "http:", "https:"]);
  if (!allowed.has(url.protocol)) {
    throw new Error("Only rtsp, rtsps, http and https endpoints are supported");
  }
  return url;
}

function defaultPort(url: URL): number {
  if (url.port) return Number(url.port);
  if (url.protocol === "rtsp:") return 554;
  if (url.protocol === "rtsps:") return 322;
  if (url.protocol === "https:") return 443;
  return 80;
}

function tcpProbe(host: string, port: number, timeoutMs = 4000): Promise<number | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(Date.now() - started));
    socket.once("timeout", () => done(null));
    socket.once("error", () => done(null));
    socket.connect(port, host);
  });
}

export async function probeCctv(endpoint: string, username?: string | null, password?: string | null): Promise<CctvProbeResult> {
  const url = parseEndpoint(endpoint);
  const host = url.hostname;
  const port = defaultPort(url);

  if (url.protocol === "rtsp:" || url.protocol === "rtsps:") {
    const latency = await tcpProbe(host, port);
    return {
      online: latency !== null,
      latencyMs: latency,
      detail:
        latency !== null
          ? `RTSP port ${port} reachable. Hamsa validates reachability only; playback happens in your own client.`
          : `RTSP port ${port} unreachable (timeout or refused).`,
      contentType: null,
    };
  }

  // HTTP(S): authenticate if credentials were supplied, then read headers only.
  const headers: Record<string, string> = {};
  if (username) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password ?? ""}`).toString("base64")}`;
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { ...headers, "User-Agent": "Hamsa-OSINT/1.0" },
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store",
    });
    return {
      online: res.ok || res.status === 401,
      latencyMs: Date.now() - started,
      detail: res.ok
        ? `HTTP ${res.status} — stream endpoint responded.`
        : `HTTP ${res.status} ${res.statusText}${res.status === 401 ? " (authentication required)" : ""}.`,
      contentType: res.headers.get("content-type"),
    };
  } catch (err) {
    return {
      online: false,
      latencyMs: null,
      detail: `Endpoint did not respond: ${(err as Error).message}`,
      contentType: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
