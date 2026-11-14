import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireAuth, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { createChain, listChains, ChainError } from "@/lib/track/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    return ok({ chains: await listChains(user) });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[geofint] list failed", err);
    return fail(500, "Chains unavailable");
  }
}

const bodySchema = z.object({
  label: z.string().trim().max(120).optional(),
  ttlHours: z.number().int().min(1).max(720).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    enforceRate(req, `geofint-create:${user.id}`, 20, 60_000);
    const parsed = bodySchema.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) return fail(400, "Invalid chain options", { issues: parsed.error.issues.map((i) => i.message) });

    const chain = await createChain(user, parsed.data);
    return ok(
      {
        chain,
        link: `/t/${chain.code}`,
        message: "Share the link. Anyone holding it can submit their position until it expires or is revoked.",
      },
      201,
    );
  } catch (err) {
    if (err instanceof ChainError) return fail(err.status, err.message, { code: err.code });
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    console.error("[geofint] create failed", err);
    return fail(500, "Chain could not be created");
  }
}
