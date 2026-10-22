"use client";

import { useEffect } from "react";

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[hamsa] console error", error);
  }, [error]);

  return (
    <div className="card p-8">
      <p className="mono text-[11px] tracking-[0.2em] text-bad">RUNTIME ERROR</p>
      <h1 className="mt-2 text-[20px] font-semibold">This view failed to render</h1>
      <p className="mt-2 max-w-lg text-[12.5px] text-muted">
        The error was logged server-side. Nothing was written to the audit trail unless the request
        completed.
      </p>
      {error.digest && <p className="mono mt-3 text-[11px] text-faint">digest {error.digest}</p>}
      <div className="mt-5 flex gap-2">
        <button type="button" className="btn btn-primary" onClick={reset}>
          Retry
        </button>
        <a href="/" className="btn">
          Dashboard
        </a>
      </div>
    </div>
  );
}
