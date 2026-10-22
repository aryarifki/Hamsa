export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line-soft bg-surface/40 p-12 lg:flex">
        <div
          className="pointer-events-none absolute -left-40 top-1/3 h-[560px] w-[560px] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(217,178,106,0.22), transparent 65%)" }}
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-brass/35 bg-brass/10">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="8.2" stroke="#d9b26a" strokeWidth="1.2" />
                <circle cx="12" cy="12" r="3.1" stroke="#d9b26a" strokeWidth="1.2" />
                <circle cx="12" cy="12" r="1" fill="#d9b26a" />
                <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22" stroke="#d9b26a" strokeWidth="1" />
              </svg>
            </span>
            <div>
              <p className="text-[15px] font-semibold tracking-[0.2em]">HAMSA</p>
              <p className="text-[9px] tracking-[0.24em] text-faint">OSINT INTELLIGENCE CONSOLE</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-tight">
            Evidence, not
            <span className="text-brass"> guesswork.</span>
          </h1>
          <p className="mt-5 text-[14px] leading-relaxed text-muted">
            Hamsa turns scattered public records into a defensible chain of evidence — phone
            metadata, IP attribution, breach exposure and public-channel chatter, all bound to a
            case file with a full audit trail.
          </p>
          <ul className="mt-8 space-y-3 text-[13px] text-muted">
            {[
              "Every lookup is logged against an operator and a case",
              "Offline-first: works without a single API key",
              "Consent-gated device tracking, never covert",
              "Exports that survive scrutiny",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brass" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[10px] uppercase tracking-[0.18em] text-faint">
          Self-hosted · AGPL-free · Your data stays on your box
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px] rise">{children}</div>
      </section>
    </div>
  );
}
