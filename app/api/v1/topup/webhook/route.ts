import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { fail, ok } from "@/lib/http";
import { safeEqual } from "@/lib/crypto";
import { TopupError, publicTopup, settleTopup } from "@/lib/tokens-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Payment gateway callback.
 *
 * The body is authenticated with HMAC-SHA256 over the raw bytes, keyed by
 * `HAMSA_TOPUP_WEBHOOK_SECRET`, and compared in constant time. Without the
 * secret the endpoint is disabled rather than open — an unauthenticated
 * "mark as paid" route would be a credit printer.
 *
 * Expected body JSON:
 *   { "reference": "HX-...", "status": "paid", "amount": "40000" }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.HAMSA_TOPUP_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return fail(503, "Top-up webhook is not configured. Set HAMSA_TOPUP_WEBHOOK_SECRET.", {
      code: "WEBHOOK_NOT_CONFIGURED",
    });
  }

  const raw = await req.text();
  const signature =
    req.headers.get("x-hamsa-signature")?.trim() ||
    req.headers.get("x-callback-signature")?.trim() ||
    "";

  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const provided = signature.replace(/^sha256=/i, "").trim();
  if (!provided || !safeEqual(expected, provided)) {
    return fail(401, "Invalid webhook signature", { code: "SIGNATURE_INVALID" });
  }

  let body: { reference?: string; status?: string; amount?: string | number };
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "Body must be JSON");
  }

  const reference = (body.reference ?? "").trim();
  if (!reference) return fail(400, "Provide a reference");

  const status = (body.status ?? "paid").toLowerCase();
  if (status !== "paid" && status !== "settled" && status !== "success") {
    // Non-success notifications are acknowledged so the gateway stops retrying.
    return ok({ acknowledged: true, settled: false, status });
  }

  try {
    const result = await settleTopup(reference, {
      settledBy: "webhook",
      amountSeen: body.amount === undefined ? null : String(body.amount),
    });
    return ok({
      acknowledged: true,
      settled: !result.alreadySettled,
      topup: publicTopup(result.topup),
      balance: result.balance,
    });
  } catch (err) {
    if (err instanceof TopupError) {
      // 410/404 are terminal: retrying cannot help, so acknowledge and report.
      return fail(err.status, err.message, { code: err.code });
    }
    console.error("[topup] webhook failed", err);
    return fail(500, "Webhook could not be processed");
  }
}
