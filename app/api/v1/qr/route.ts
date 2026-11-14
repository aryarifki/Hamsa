import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireAuth, clientIp, userAgent, HttpError } from "@/lib/http";
import { enforceRate } from "@/lib/security";
import { charge, refund } from "@/lib/tokens";
import { decodeQr } from "@/lib/intel/qr";
import { audit } from "@/lib/audit";
import { InsufficientCreditsError } from "@/lib/tokens";
import { newId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QR_COST = 2;

const bodySchema = z.object({
  image: z.string().min(16).max(12_000_000),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    enforceRate(req, `qr:${user.id}`, 30, 60_000);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "Provide an image as a data URL or base64 string");

    await charge(user.id, QR_COST, "tool:qr", "tool");
    let result;
    try {
      result = await decodeQr(parsed.data.image);
    } catch (err) {
      await refund(user.id, QR_COST, "qr-decoder", newId());
      throw err;
    }

    await audit({
      userId: user.id,
      actor: user.email,
      action: "tool.qr",
      entity: "tool",
      entityId: "qr",
      meta: { format: result.format, decoded: result.decoded ? true : false },
      ip: clientIp(req),
      userAgent: userAgent(req),
    });

    return ok({ cost: QR_COST, ...result });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message, err.extra);
    if (err instanceof InsufficientCreditsError) {
      return fail(402, "Insufficient credits", { required: err.required, balance: err.balance });
    }
    console.error("[qr] unhandled", err);
    return fail(500, "QR decode failed");
  }
}
