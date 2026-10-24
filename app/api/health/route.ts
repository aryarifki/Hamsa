import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + readiness probe. Deliberately leaks no configuration. */
export async function GET() {
  try {
    const row = await one<{ ok: number }>("SELECT 1 AS ok");
    return NextResponse.json(
      {
        status: "ok",
        database: row?.ok === 1 ? "reachable" : "unknown",
        time: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
