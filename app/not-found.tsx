import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <p className="mono text-[11px] tracking-[0.24em] text-brass">404</p>
        <h1 className="mt-3 text-[26px] font-semibold tracking-tight">Nothing at this address</h1>
        <p className="mt-2 max-w-sm text-[13px] text-muted">
          The record may have been deleted, or it belongs to another operator.
        </p>
        <Link href="/" className="btn btn-primary mt-6">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
