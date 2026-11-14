import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { fetchJson } from "./http";
import type { ModuleResult, Signal, SourceRef } from "./types";

/**
 * E-wallet identity linkage (GoPay / OVO / DANA / ShopeePay).
 *
 * A verified name behind a wallet number is the strongest identity pivot after
 * caller-ID tags, but it is served only through providers with a legal
 * agreement. The module therefore:
 *
 *  1. calls `EWALLET_API_URL` + `EWALLET_API_KEY` when configured (any JSON
 *     endpoint taking `?phone=<e164>` and returning `{ wallets: [...] }`),
 *  2. always returns the app deep links an analyst can check by hand,
 *  3. never guesses a name from a prefix.
 */

export const WALLETS = ["GoPay", "OVO", "DANA", "ShopeePay", "LinkAja"] as const;

interface ProviderWallet {
  wallet?: string;
  registered?: boolean;
  name?: string;
  verified?: boolean;
}

interface ProviderResponse {
  wallets?: ProviderWallet[];
  name?: string;
}

export async function investigateEwallet(raw: string, defaultCountry = "ID"): Promise<ModuleResult> {
  const started = Date.now();
  const sources: SourceRef[] = [];
  const signals: Signal[] = [];
  const warnings: string[] = [];

  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry as never);
  const e164 = parsed?.number ?? raw.trim();
  const digits = e164.replace("+", "");

  const base = process.env.EWALLET_API_URL?.trim();
  const key = process.env.EWALLET_API_KEY?.trim();

  let wallets: Array<{ wallet: string; registered: boolean | null; name: string | null; verified: boolean }> = [];
  let verifiedName: string | null = null;

  if (base && key) {
    try {
      const url = `${base}${base.includes("?") ? "&" : "?"}phone=${encodeURIComponent(e164)}`;
      const data = await fetchJson<ProviderResponse>(url, {
        timeoutMs: 9000,
        headers: { Authorization: `Bearer ${key}`, "x-api-key": key },
      });
      sources.push({ name: "E-wallet verification provider", kind: "provider" });
      wallets = (data.wallets ?? []).map((w) => ({
        wallet: String(w.wallet ?? "unknown"),
        registered: typeof w.registered === "boolean" ? w.registered : null,
        name: w.name?.trim() || null,
        verified: Boolean(w.verified),
      }));
      verifiedName = data.name?.trim() || wallets.find((w) => w.verified && w.name)?.name || null;
    } catch (err) {
      warnings.push(`Provider call failed: ${(err as Error).message}`);
    }
  }

  if (!base || !key) {
    warnings.push(
      "EWALLET_API_URL / EWALLET_API_KEY are not configured. Registration and name checks were not attempted; deep links below let an analyst verify manually.",
    );
    signals.push({ label: "E-wallet provider not configured", level: "low" });
  }

  if (verifiedName) {
    signals.push({ label: `Verified wallet name: ${verifiedName}`, level: "high" });
  }
  const registered = wallets.filter((w) => w.registered === true);
  if (registered.length) {
    signals.push({ label: `Number is registered on ${registered.map((w) => w.wallet).join(", ")}`, level: "info" });
  }

  return {
    module: "ewallet",
    target: e164,
    durationMs: Date.now() - started,
    sources,
    signals,
    data: {
      found: Boolean(verifiedName || registered.length),
      verifiedName,
      wallets,
      checkedWallets: wallets.length,
      availableWallets: [...WALLETS],
      deepLinks: [
        { label: "GoPay", url: `https://gopay.co.id/` },
        { label: "OVO", url: `https://www.ovo.id/` },
        { label: "DANA", url: `https://www.dana.id/` },
        { label: "ShopeePay", url: `https://shopeepay.co.id/` },
        { label: "WhatsApp ping", url: `https://wa.me/${digits}?text=${encodeURIComponent("Halo, verifikasi nomor")}` },
      ],
    },
    warnings: warnings.length ? warnings : undefined,
  };
}
