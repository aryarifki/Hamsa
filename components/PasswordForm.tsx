"use client";

import { useActionState } from "react";
import { changePasswordAction, type PasswordState } from "@/app/(console)/security-actions";
import { Icon } from "@/components/Icon";

const initial: PasswordState = {};

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initial);

  return (
    <form action={action} className="mt-3 grid gap-3 sm:grid-cols-3">
      <input
        name="current"
        type="password"
        className="input"
        placeholder="Current password"
        autoComplete="current-password"
        required
      />
      <input
        name="next"
        type="password"
        className="input"
        placeholder="New password (12+ chars)"
        autoComplete="new-password"
        minLength={12}
        required
      />
      <input
        name="confirm"
        type="password"
        className="input"
        placeholder="Confirm new password"
        autoComplete="new-password"
        minLength={12}
        required
      />
      <div className="sm:col-span-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <Icon name="key" size={13} /> {pending ? "Updating…" : "Change password"}
        </button>
        {state.error && <span className="ml-3 text-[12px] text-bad">{state.error}</span>}
        {state.ok && (
          <span className="ml-3 text-[12px] text-good">
            Password changed. Other sessions were revoked.
          </span>
        )}
      </div>
    </form>
  );
}
