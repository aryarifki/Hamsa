import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireAuth, clientIp, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { PLANS, TopupError, createTopup, listTopups, publicTopup } from "@/lib/tokens-phonex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    return ok({
      plans: PLANS,
      topups: (await listTopups(user.id, 50)).map(publicTopup),
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[topup] list failed", err);
    return fail(500, "Top-ups unavailable");
  }
}

const createSchema = z.object({ planId: z.string().trim().min(3).max(40) });

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    enforceRate(req, `topup-create:${user.id}`, 10, 60_000);

    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, "Provide a planId", { plans: PLANS.map((plan) => plan.id) });
    }

    const { topup, instructions } = await createTopup(user.id, parsed.data.planId, { ip: clientIp(req) });
    return ok({ topup: publicTopup(topup), instructions }, 201);
  } catch (err) {
    if (err instanceof TopupError) return fail(err.status, err.message, { code: err.code, ...err.extra });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[topup] create failed", err);
    return fail(500, "Top-up could not be created");
  }
}
