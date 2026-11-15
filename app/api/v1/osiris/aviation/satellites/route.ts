import { NextRequest } from "next/server";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { satellites } from "@/lib/intel/situational";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    const { feed, satellites: list } = await satellites();
    return ok({ feed, satellites: list, count: list.length });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[osiris] satellites failed", err);
    return fail(502, "Satellite catalogue unavailable");
  }
}
