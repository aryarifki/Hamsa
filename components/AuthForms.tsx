"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
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

/* ── phone OTP (Phone-X style) ──────────────────────────────────────── */

type OtpChannel = "whatsapp" | "sms";

export function OtpLoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<OtpChannel>("whatsapp");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/web/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, channel }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The code could not be sent");

      setStep("code");
      setDetail(body.detail ?? null);
      setDevCode(body.devCode ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/web/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-type": "web",
        },
        body: JSON.stringify({ phone, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The code was rejected");

      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={step === "phone" ? requestCode : verify} className="mt-7 space-y-4">
      {step === "phone" ? (
        <>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
              Phone number
            </span>
            <input
              className="input"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="0812 3456 7890"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />
            <span className="mt-1.5 block text-[11px] text-faint">
              Indonesian numbers work with or without +62.
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
              Delivery
            </span>
            <select
              className="input"
              name="channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value as OtpChannel)}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
            </select>
          </label>
        </>
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
            Six-digit code
          </span>
          <input
            className="input mono text-center text-[20px] tracking-[0.4em]"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
          <span className="mt-1.5 block text-[11px] text-faint">
            Sent to {phone}. The code expires in five minutes and cannot be reused.
          </span>
        </label>
      )}

      {detail && !devCode && <p className="text-[11.5px] text-faint">{detail}</p>}
      {devCode && (
        <p className="rounded-lg border border-brass/30 bg-brass/8 px-3 py-2 text-[12px] text-brass">
          Development mode — the code is <span className="mono">{devCode}</span>
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/8 px-3 py-2.5 text-[12px] text-bad">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full py-2.5" disabled={pending || (step === "code" && code.length !== 6)}>
        {pending ? "Working…" : step === "phone" ? "Send code" : "Verify and sign in"}
        {!pending && <Icon name="arrow" size={15} />}
      </button>

      {step === "code" && (
        <button
          type="button"
          className="btn btn-ghost w-full py-2 text-[11.5px]"
          onClick={() => {
            setStep("phone");
            setCode("");
            setDevCode(null);
            setError(null);
          }}
        >
          Use a different number
        </button>
      )}
    </form>
  );
}

export function LoginTabs() {
  const [mode, setMode] = useState<"otp" | "password">("otp");

  return (
    <div>
      <div className="flex gap-2">
        {(["otp", "password"] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setMode(name)}
            className={`btn flex-1 px-3 py-1.5 text-[11.5px] ${mode === name ? "btn-primary" : ""}`}
          >
            {name === "otp" ? "Phone code" : "Email & password"}
          </button>
        ))}
      </div>

      {mode === "otp" ? (
        <div className="mt-2">
          <p className="eyebrow mt-4">Sign in with a phone code</p>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Enter your number</h1>
          <p className="mt-2 text-[13px] text-muted">
            We send a six-digit code over WhatsApp or SMS. The first successful code creates the
            account.
          </p>
          <OtpLoginForm />
        </div>
      ) : (
        <LoginForm />
      )}
    </div>
  );
}
