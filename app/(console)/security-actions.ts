"use server";

import { cookies } from "next/headers";
import { now, run } from "@/lib/db";
import { requireUser, SESSION_COOKIE } from "@/lib/auth";
import { hashPassword, sha256, verifyPassword } from "@/lib/crypto";
import { userByEmail } from "@/lib/users";
import { audit } from "@/lib/audit";

export interface PasswordState {
  ok?: boolean;
  error?: string;
}

export async function changePasswordAction(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 12) return { error: "The new password must be at least 12 characters." };
  if (next !== confirm) return { error: "The new passwords do not match." };

  const row = await userByEmail(user.email);
  if (!row || !verifyPassword(current, row.password_hash)) {
    return { error: "Current password is incorrect." };
  }
  if (verifyPassword(next, row.password_hash)) {
    return { error: "The new password must differ from the current one." };
  }

  await run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(next), user.id);

  // Keep the session that performed the change, revoke every other one.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const keep = token ? sha256(token) : "";
  await run(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL",
    now(),
    user.id,
    keep,
  );

  await audit({
    userId: user.id,
    actor: user.email,
    action: "auth.login",
    entity: "user",
    entityId: user.id,
    meta: { event: "password_changed" },
  });

  return { ok: true };
}
