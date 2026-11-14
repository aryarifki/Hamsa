import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { buildGraph } from "@/lib/intel/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
    const caseId = req.nextUrl.searchParams.get("caseId") ?? undefined;
    const graph = await buildGraph(user.id, {
      limit: Number.isFinite(limit) ? limit : 200,
      caseId,
    });
    return ok(graph);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[graph] unhandled", err);
    return fail(500, "Graph build failed");
  }
}
