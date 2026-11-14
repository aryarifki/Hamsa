import { fail, ok } from "@/lib/http";
import { betaStatus } from "@/lib/auth-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: the landing page renders the beta gate before anyone signs in. */
export async function GET() {
  try {
    return ok(await betaStatus());
  } catch (err) {
    console.error("[auth] beta-status failed", err);
    return fail(500, "Beta status unavailable");
  }
}
