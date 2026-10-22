"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, registerAction, type AuthState } from "@/app/(auth)/actions";
import { Icon } from "@/components/Icon";

const initial: AuthState = {};

function Field({
  label,
  name,
  type = "text",
  placeholder,
  autoComplete,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
        {label}
      </span>
      <input
        className="input"
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
      />
      {hint && <span className="mt-1.5 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <div>
      <p className="eyebrow">Welcome back</p>
      <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Sign in to Hamsa</h1>
      <p className="mt-2 text-[13px] text-muted">
        Use your operator account. All activity is attributed and logged.
      </p>

      <form action={action} className="mt-7 space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="analyst@agency.gov" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" placeholder="••••••••••••" />

        {state.error && (
          <p className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/8 px-3 py-2.5 text-[12px] text-bad">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
            {state.error}
          </p>
        )}

        <button type="submit" className="btn btn-primary w-full py-2.5" disabled={pending}>
          {pending ? "Verifying…" : "Sign in"}
          {!pending && <Icon name="arrow" size={15} />}
        </button>
      </form>

      <p className="mt-6 text-center text-[12px] text-muted">
        No account?{" "}
        <Link href="/register" className="text-brass hover:underline">
          Request access
        </Link>
      </p>
    </div>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, initial);

  return (
    <div>
      <p className="eyebrow">Request access</p>
      <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Create an operator account</h1>
      <p className="mt-2 text-[13px] text-muted">
        Accounts are for authorized investigations. Misuse is grounds for immediate suspension.
      </p>

      <form action={action} className="mt-7 space-y-4">
        <Field label="Full name" name="name" autoComplete="name" placeholder="Arya Rifki" />
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="analyst@agency.gov" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 12 characters"
          hint="Stored as a scrypt hash. There is no password reset yet — keep it safe."
        />

        <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2/50 px-3 py-2.5">
          <input type="checkbox" name="accept" className="mt-0.5 h-3.5 w-3.5 accent-[#d9b26a]" />
          <span className="text-[11.5px] leading-relaxed text-muted">
            I will use Hamsa only for lawful, authorized investigations, and I accept that every
            lookup is recorded in an immutable audit log.
          </span>
        </label>

        {state.error && (
          <p className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/8 px-3 py-2.5 text-[12px] text-bad">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
            {state.error}
          </p>
        )}

        <button type="submit" className="btn btn-primary w-full py-2.5" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
          {!pending && <Icon name="arrow" size={15} />}
        </button>
      </form>

      <p className="mt-6 text-center text-[12px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-brass hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
