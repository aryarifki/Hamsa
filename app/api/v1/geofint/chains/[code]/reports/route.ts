import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireAuth, authenticate, clientIp, userAgent, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { chainByCode, addReport, listReports, deleteReports, touchChain, ChainError } from "@/lib/track/chain";
import { verifyToken } from "@/lib/track/geofint-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reportSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullish(),
  note: z.string().trim().max(500).nullish(),
});

/** Owner/admin read path. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { user } = await requireAuth(req);
    const { code } = await params;
    const chain = await chainByCode(code);
    if (!chain) return fail(404, "Chain not found", { code: "CHAIN_NOT_FOUND" });
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
    const reports = await listReports(chain.id, user, Number.isFinite(limit) ? limit : 200);
    return ok({ chain, reports, count: reports.length });
  } catch (err) {
    if (err instanceof ChainError) return fail(err.status, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[geofint] reports read failed", err);
    return fail(500, "Reports unavailable");
  }
}

/**
 * Public write path. The code is the capability; when the page presents a
 * signed `x-geofint-token` it is verified, but its absence is not a failure.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    enforceRate(req, `geofint-report:${clientIp(req)}`, 20, 60_000);

    const token = req.headers.get("x-geofint-token")?.trim();
    if (token && !verifyToken(token, code)) {
      return fail(401, "Geofint token is invalid or expired", { code: "TOKEN_INVALID" });
    }

    const parsed = reportSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, "Invalid position", { issues: parsed.error.issues.map((i) => i.message) });
    }

    const { chain, report } = await addReport(code, parsed.data, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    await touchChain(chain.id);

    return ok({ accepted: true, at: report.at, code: chain.code }, 201);
  } catch (err) {
    if (err instanceof ChainError) return fail(err.status, err.message, { code: err.code });
    console.error("[geofint] report failed", err);
    return fail(500, "Report could not be stored");
  }
}

/** Owner/admin clear path — Phone-X's `DELETE .../reports`. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await authenticate(req);
    if (!auth) return fail(401, "Authentication required");
    const { code } = await params;
    const chain = await chainByCode(code);
    if (!chain) return fail(404, "Chain not found", { code: "CHAIN_NOT_FOUND" });
    const removed = await deleteReports(chain.id, auth.user);
    return ok({ removed });
  } catch (err) {
    if (err instanceof ChainError) return fail(err.status, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[geofint] reports delete failed", err);
    return fail(500, "Reports could not be cleared");
  }
}
