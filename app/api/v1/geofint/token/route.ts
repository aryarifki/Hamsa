import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, clientIp } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { issueToken } from "@/lib/track/geofint-token";
import { chainByCode, chainOpen } from "@/lib/track/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().min(4).max(16) });

/** Public: the chain page asks for a token before it starts reporting. */
export async function POST(req: NextRequest) {
  try {
    enforceRate(req, `geofint-token:${clientIp(req)}`, 30, 60_000);
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "Provide the chain code");

    const chain = await chainByCode(parsed.data.code);
    if (!chain) return fail(404, "Chain not found", { code: "CHAIN_NOT_FOUND" });
    if (!chainOpen(chain)) return fail(410, "Chain is closed or expired", { code: "CHAIN_CLOSED" });

    return ok(issueToken(chain.code));
  } catch {
    return fail(500, "Token could not be issued");
  }
}
