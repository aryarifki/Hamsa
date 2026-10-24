import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { currentUser } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await currentUser();
  if (user) {
    await audit({
      userId: user.id,
      actor: user.email,
      action: "auth.logout",
      ip: req.headers.get("x-forwarded-for") ?? undefined,
    });
  }
  await destroySession();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
