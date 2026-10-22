import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireAuth, clientIp, userAgent, HttpError } from "@/lib/http";
import { runLookup, LookupError } from "@/lib/lookup";
import { enforceRate } from "@/lib/security";
import { InsufficientCreditsError } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  module: z.enum(["phone", "ip", "email", "username", "telegram"]),
  target: z.string().trim().min(1).max(320),
  keyword: z.string().trim().max(120).optional(),
  caseId: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  try {
    const { user, via, apiKeyId } = await requireAuth(req);
    enforceRate(req, `lookup:${apiKeyId ?? user.id}`, 60, 60_000);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, "Invalid request body", { issues: parsed.error.issues.map((i) => i.message) });
    }

    const data = await runLookup({
      user,
      module: parsed.data.module,
      target: parsed.data.target,
      keyword: parsed.data.keyword,
      caseId: parsed.data.caseId ?? undefined,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });

    return ok(
      {
        lookupId: data.id,
        module: data.module,
        target: data.target,
        cost: data.cost,
        balance: data.balance,
        durationMs: data.durationMs,
        result: data.result,
      },
      201,
    );
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    if (err instanceof InsufficientCreditsError) {
      return fail(402, "Insufficient credits", { required: err.required, balance: err.balance });
    }
    if (err instanceof LookupError) return fail(err.status, err.message);
    console.error("[lookup] unhandled", err);
    return fail(500, "Internal error");
  }
}
