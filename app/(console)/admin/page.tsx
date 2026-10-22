import { requireAdmin } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { listProviders, PROVIDER_CATALOG } from "@/lib/security";
import { grantCreditsAction, updateProviderAction, updateUserAction } from "@/app/(console)/actions";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administration" };

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  credits: number;
  created_at: string;
  last_login_at: string | null;
}

interface AuditRow {
  id: string;
  actor: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  ip: string | null;
  created_at: string;
  meta: string | null;
}

export default async function AdminPage() {
  const admin = await requireAdmin();
  const users = all<AdminUser>(
    "SELECT id, email, name, role, status, credits, created_at, last_login_at FROM users ORDER BY created_at ASC",
  );
  const providers = listProviders();

  const totals = one<{ users: number; lookups: number; credits: number }>(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM lookups) AS lookups,
            (SELECT COALESCE(SUM(credits), 0) FROM users) AS credits`,
  ) ?? { users: 0, lookups: 0, credits: 0 };

  const auditRows = all<AuditRow>(
    "SELECT id, actor, action, entity, entity_id, ip, created_at, meta FROM audit_log ORDER BY created_at DESC LIMIT 80",
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Control room</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            Operators, provider credentials and the audit trail.
          </p>
        </div>
        <div className="flex gap-2">
          <span className="badge mono">{totals.users} users</span>
          <span className="badge mono">{totals.lookups} lookups</span>
          <span className="badge mono">{totals.credits} credits</span>
        </div>
      </header>

      <section className="card overflow-hidden">
        <div className="border-b border-line-soft px-5 py-3.5">
          <h2 className="text-[13px] font-semibold">Operators</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Operator</th>
                <th>Role</th>
                <th>Status</th>
                <th>Credits</th>
                <th>Grant</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <p className="text-[12.5px]">{u.name}</p>
                    <p className="mono text-[10.5px] text-faint">{u.email}</p>
                  </td>
                  <td>
                    <form action={updateUserAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="status" value={u.status} />
                      <select name="role" defaultValue={u.role} className="select w-[104px] px-2 py-1 text-[11.5px]">
                        <option value="admin">admin</option>
                        <option value="analyst">analyst</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <button type="submit" className="btn btn-ghost px-1.5 py-1" aria-label="Save role">
                        <Icon name="check" size={12} />
                      </button>
                    </form>
                  </td>
                  <td>
                    <form action={updateUserAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="role" value={u.role} />
                      <select name="status" defaultValue={u.status} className="select w-[104px] px-2 py-1 text-[11.5px]">
                        <option value="active">active</option>
                        <option value="suspended">suspended</option>
                      </select>
                      <button type="submit" className="btn btn-ghost px-1.5 py-1" aria-label="Save status">
                        <Icon name="check" size={12} />
                      </button>
                      {u.id === admin.id && <span className="text-[10px] text-faint">you</span>}
                    </form>
                  </td>
                  <td className="mono text-[12.5px]">{u.credits}</td>
                  <td>
                    <form action={grantCreditsAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={u.id} />
                      <input
                        name="amount"
                        type="number"
                        step={1}
                        className="input w-[80px] px-2 py-1 text-[11.5px]"
                        placeholder="±"
                        required
                      />
                      <button type="submit" className="btn btn-ghost px-1.5 py-1" aria-label="Apply credits">
                        <Icon name="plus" size={12} />
                      </button>
                    </form>
                  </td>
                  <td className="whitespace-nowrap text-[10.5px] text-faint">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card-pad">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold">Provider credentials</h2>
          <span className="badge">encrypted at rest</span>
        </div>
        <p className="mt-1 text-[12px] text-muted">
          A key saved here overrides the matching environment variable. Leave the field blank to keep
          the stored value.
        </p>

        <div className="mt-4 space-y-3">
          {PROVIDER_CATALOG.map((p) => {
            const row = providers.find((r) => r.kind === p.kind && r.name === p.name);
            return (
              <form
                key={p.env}
                action={updateProviderAction}
                className="grid items-end gap-3 rounded-lg border border-line-soft bg-surface-2/30 p-3.5 sm:grid-cols-[1fr_1fr_auto_auto]"
              >
                <input type="hidden" name="kind" value={p.kind} />
                <input type="hidden" name="name" value={p.name} />
                <div>
                  <p className="text-[12.5px] font-medium">{p.name}</p>
                  <p className="mono text-[10.5px] text-faint">{p.env}</p>
                </div>
                <input
                  name="api_key"
                  type="password"
                  className="input py-1.5 text-[12px]"
                  placeholder={row?.config ? "•••••••• (stored)" : "Paste API key"}
                  autoComplete="new-password"
                />
                <label className="flex items-center gap-2 text-[11.5px] text-muted">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={Boolean(row?.enabled)}
                    className="h-3.5 w-3.5 accent-[#d9b26a]"
                  />
                  enabled
                </label>
                <button type="submit" className="btn px-3 py-1.5 text-[11.5px]">
                  Save
                </button>
              </form>
            );
          })}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <h2 className="text-[13px] font-semibold">Audit trail</h2>
          <span className="badge mono">last {auditRows.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-[10.5px] text-faint">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td className="mono max-w-[200px] truncate text-[11px]">{a.actor ?? "system"}</td>
                  <td>
                    <span className="mono text-[11px] text-brass">{a.action}</span>
                  </td>
                  <td className="max-w-[220px] truncate text-[11px] text-muted">
                    {a.entity ?? "—"}
                    {a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ""}
                  </td>
                  <td className="mono text-[10.5px] text-faint">{a.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line-soft px-5 py-2.5 text-[10.5px] text-faint">
          Append-only. Entries are written by the server, never by the client.
        </p>
      </section>
    </div>
  );
}
