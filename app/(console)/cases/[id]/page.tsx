import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { Icon } from "@/components/Icon";
import { closeCaseAction, deleteCaseAction, detachLookupAction, attachLookupAction } from "@/app/(console)/actions";

export const dynamic = "force-dynamic";

interface CaseDetail {
  id: string;
  code: string;
  title: string;
  subject: string | null;
  purpose: string;
  authorization_ref: string;
  status: string;
  created_at: string;
  closed_at: string | null;
}

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const record = await one<CaseDetail>("SELECT * FROM cases WHERE id = ? AND user_id = ?", id, user.id);
  if (!record) notFound();

  const items = await all<{
    lookup_id: string;
    module: string;
    target: string;
    status: string;
    created_at: string;
    added_at: string;
  }>(
    `SELECT l.id AS lookup_id, l.module, l.target, l.status, l.created_at, ci.added_at
     FROM case_items ci JOIN lookups l ON l.id = ci.lookup_id
     WHERE ci.case_id = ? ORDER BY ci.added_at DESC`,
    id,
  );

  const attachable = await all<{ id: string; module: string; target: string; created_at: string }>(
    `SELECT id, module, target, created_at FROM lookups
     WHERE user_id = ? AND id NOT IN (SELECT lookup_id FROM case_items WHERE case_id = ?)
     ORDER BY created_at DESC LIMIT 30`,
    user.id,
    id,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-faint">
        <Link href="/cases" className="hover:text-text">
          Cases
        </Link>
        <span>/</span>
        <span className="mono text-muted">{record.code}</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`badge ${record.status === "open" ? "badge-good" : ""}`}>{record.status}</span>
            <span className="text-[11px] text-faint">opened {new Date(record.created_at).toLocaleString()}</span>
          </div>
          <h1 className="mt-2 text-[24px] font-semibold tracking-tight">{record.title}</h1>
          <p className="mt-1 text-[13px] text-muted">{record.subject ?? "No subject recorded"}</p>
        </div>
        <div className="flex gap-2">
          <form action={closeCaseAction}>
            <input type="hidden" name="id" value={record.id} />
            <button type="submit" className="btn px-3 py-1.5 text-[12px]">
              <Icon name="check" size={13} />
              {record.status === "open" ? "Close case" : "Reopen"}
            </button>
          </form>
          <form action={deleteCaseAction}>
            <input type="hidden" name="id" value={record.id} />
            <button type="submit" className="btn btn-danger px-3 py-1.5 text-[12px]">
              <Icon name="trash" size={13} /> Delete
            </button>
          </form>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="card card-pad">
          <p className="eyebrow">Lawful purpose</p>
          <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-text/90">{record.purpose}</p>
        </div>
        <div className="card card-pad">
          <p className="eyebrow">Authorization</p>
          <p className="mono mt-2 text-[13px] text-brass">{record.authorization_ref}</p>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            Hamsa records this reference with every lookup in the case. Keep the underlying document
            available for audit.
          </p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <h2 className="text-[13px] font-semibold">Evidence</h2>
          <span className="badge mono">{items.length}</span>
        </div>

        {items.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-faint">
            Nothing attached yet. Run a lookup, then attach it from the record page.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {items.map((it) => (
              <li key={it.lookup_id} className="flex items-center gap-3 px-5 py-3">
                <span className="badge">{it.module}</span>
                <Link href={`/history/${it.lookup_id}`} className="mono truncate text-[12px] hover:text-brass">
                  {it.target}
                </Link>
                <span className={`badge ${it.status === "ok" ? "badge-good" : "badge-bad"}`}>{it.status}</span>
                <span className="hidden text-[11px] text-faint sm:inline">
                  {new Date(it.created_at).toLocaleString()}
                </span>
                <form action={detachLookupAction} className="ml-auto">
                  <input type="hidden" name="caseId" value={record.id} />
                  <input type="hidden" name="lookupId" value={it.lookup_id} />
                  <button type="submit" className="btn btn-ghost px-1.5 py-1" aria-label="Detach">
                    <Icon name="close" size={13} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {attachable.length > 0 && (
        <section className="card card-pad">
          <h2 className="text-[13px] font-semibold">Attach an existing lookup</h2>
          <form action={attachLookupAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="caseId" value={record.id} />
            <select name="lookupId" className="select max-w-[420px] flex-1" required>
              {attachable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.module} · {a.target} · {new Date(a.created_at).toLocaleDateString()}
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
