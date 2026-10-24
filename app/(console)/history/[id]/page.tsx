import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { lookupById, parsedResult } from "@/lib/lookup";
import { all } from "@/lib/db";
import { DataView, Signals, CopyButton } from "@/components/DataView";
import { Icon } from "@/components/Icon";
import { attachLookupAction } from "@/app/(console)/actions";

export const dynamic = "force-dynamic";

export default async function LookupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const record = await lookupById(id, user.id);
  if (!record) notFound();

  const result = parsedResult(record);
  const cases = await all<{ id: string; code: string; title: string }>(
    "SELECT id, code, title FROM cases WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC",
    user.id,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-faint">
        <Link href="/history" className="hover:text-text">
          History
        </Link>
        <span>/</span>
        <span className="mono text-muted">{record.id.slice(0, 8)}</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge badge-brass">{record.module}</span>
            <span className={`badge ${record.status === "ok" ? "badge-good" : "badge-bad"}`}>{record.status}</span>
            <span className="mono text-[12px] text-faint">{record.cost} credits</span>
          </div>
          <h1 className="mono mt-2 break-all text-[20px] font-semibold">{record.target}</h1>
          <p className="mt-1 text-[11.5px] text-faint">
            {new Date(record.created_at).toLocaleString()} · {record.duration_ms ?? 0} ms
            {record.provider ? ` · ${record.provider}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton value={record.result ?? "{}"} label="Copy JSON" />
          <a href={`/api/v1/export/${record.id}?format=json`} className="btn px-3 py-1.5 text-[12px]">
            <Icon name="download" size={13} /> JSON
          </a>
          <a href={`/api/v1/export/${record.id}?format=md`} className="btn px-3 py-1.5 text-[12px]">
            <Icon name="download" size={13} /> Markdown
          </a>
          <Link href={`/history/${record.id}/print`} className="btn px-3 py-1.5 text-[12px]">
            <Icon name="download" size={13} /> PDF (print)
          </Link>
        </div>
      </header>

      {record.status === "error" && (
        <div className="rounded-xl border border-bad/30 bg-bad/8 px-4 py-3 text-[12.5px] text-bad">
          <p className="font-medium">Lookup failed</p>
          <p className="mt-1 text-bad/80">{record.error}</p>
          <p className="mt-1 text-[11px] text-bad/60">The credits for this lookup were refunded automatically.</p>
        </div>
      )}

      {result ? (
        <section className="card overflow-hidden">
          <div className="space-y-5 p-5">
            <Signals signals={result.signals} />
            <DataView data={result.data} />
            {result.warnings && result.warnings.length > 0 && (
              <div className="rounded-lg border border-warn/25 bg-warn/6 p-3.5">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-warn">Caveats</p>
                <ul className="space-y-1 text-[12px] text-warn/85">
                  {result.warnings.map((w, i) => (
                    <li key={i}>· {w}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
              <span className="eyebrow mr-1">Sources</span>
              {result.sources.map((s, i) => (
                <span key={i} className="badge">
                  {s.name} <span className="text-faint">· {s.kind}</span>
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <p className="text-[13px] text-faint">No structured payload was stored for this record.</p>
      )}

      {cases.length > 0 && (
        <section className="card card-pad">
          <h2 className="text-[13px] font-semibold">Attach to a case</h2>
          <p className="mt-1 text-[12px] text-muted">
            Binding a lookup to a case records the evidentiary context in the dossier.
          </p>
          <form action={attachLookupAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="lookupId" value={record.id} />
            <select name="caseId" className="select max-w-[320px] flex-1" required>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary">
              <Icon name="plus" size={13} /> Attach
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
