import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Icon } from "@/components/Icon";
import { createCaseAction } from "@/app/(console)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cases" };

interface CaseRow {
  id: string;
  code: string;
  title: string;
  subject: string | null;
  status: string;
  created_at: string;
  items: number;
}

export default async function CasesPage() {
  const user = await requireUser();
  const cases = await all<CaseRow>(
    `SELECT c.id, c.code, c.title, c.subject, c.status, c.created_at,
            (SELECT COUNT(*) FROM case_items ci WHERE ci.case_id = c.id) AS items
     FROM cases c WHERE c.user_id = ? ORDER BY c.created_at DESC`,
    user.id,
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Case files</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            A dossier per investigation: legal basis, evidence, exports.
          </p>
        </div>
        <span className="badge mono">{cases.filter((c) => c.status === "open").length} open</span>
      </header>

      <details className="card card-pad group">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium">
          <span className="grid h-6 w-6 place-items-center rounded-md border border-brass/30 bg-brass/10 text-brass">
            <Icon name="plus" size={13} />
          </span>
          Open a new case
          <Icon name="arrow" size={13} className="ml-auto text-faint transition-transform group-open:rotate-90" />
        </summary>

        <form action={createCaseAction} className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-faint">Title</span>
            <input name="title" className="input" placeholder="Operation Brass Lantern" required minLength={3} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-faint">Subject (optional)</span>
            <input name="subject" className="input" placeholder="Entity under investigation" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-faint">
              Authorization reference
            </span>
            <input
              name="authorization_ref"
              className="input mono"
              placeholder="Court order / client SOW / ticket ID"
              required
              minLength={3}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-faint">Lawful purpose</span>
            <textarea
              name="purpose"
              className="textarea min-h-[90px]"
              placeholder="Why this investigation is lawful: the legal basis, scope and retention period."
              required
              minLength={10}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary">
              <Icon name="folder" size={14} /> Create case
            </button>
          </div>
        </form>
      </details>

      {cases.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <Icon name="folder" size={22} className="mx-auto text-faint" />
          <p className="mt-3 text-[13px] text-muted">No cases yet. Open one before you collect evidence.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {cases.map((c) => (
            <Link
              key={c.id}
              href={`/cases/${c.id}`}
              className="card p-4 transition-colors hover:border-brass/30"
            >
              <div className="flex items-center gap-2">
                <span className="mono text-[10.5px] text-brass">{c.code}</span>
                <span className={`badge ml-auto ${c.status === "open" ? "badge-good" : ""}`}>{c.status}</span>
              </div>
              <h2 className="mt-2 truncate text-[14px] font-medium">{c.title}</h2>
              <p className="mt-0.5 truncate text-[12px] text-muted">{c.subject ?? "No subject recorded"}</p>
              <div className="mt-3 flex items-center gap-3 border-t border-line-soft pt-2.5 text-[11px] text-faint">
                <span className="flex items-center gap-1">
                  <Icon name="search" size={11} /> {c.items} evidence item{c.items === 1 ? "" : "s"}
                </span>
                <span className="ml-auto">{new Date(c.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
