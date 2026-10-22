import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { listApiKeys } from "@/lib/security";
import { ApiKeyForm } from "@/components/ApiKeyForm";
import { PasswordForm } from "@/components/PasswordForm";
import { Icon } from "@/components/Icon";
import { revokeKeyAction } from "@/app/(console)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const keys = listApiKeys(user.id);
  const sessions = all<{ created_at: string; expires_at: string; ip: string | null; user_agent: string | null }>(
    "SELECT created_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 10",
    user.id,
  );

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Account</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-[12.5px] text-muted">Operator profile, API access and sessions.</p>
      </header>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Profile</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-faint">Name</dt>
            <dd className="mt-0.5 text-[13px]">{user.name}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-faint">Email</dt>
            <dd className="mono mt-0.5 text-[13px]">{user.email}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-faint">Role</dt>
            <dd className="mt-0.5 text-[13px] capitalize">{user.role}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-faint">Member since</dt>
            <dd className="mt-0.5 text-[13px]">{new Date(user.created_at).toLocaleDateString()}</dd>
          </div>
        </dl>
        <p className="mt-4 rounded-lg border border-line-soft bg-surface-2/40 px-3 py-2.5 text-[11.5px] text-muted">
          Passwords are stored as scrypt digests. Changing a password revokes every other active
          session for this account.
        </p>
        <PasswordForm />
      </section>

      <section className="card card-pad">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold">API keys</h2>
          <span className="badge">Bearer</span>
        </div>
        <p className="mt-1 text-[12px] text-muted">
          Use <code className="mono text-[11px] text-brass">Authorization: Bearer hk_…</code> against
          <code className="mono text-[11px] text-brass"> POST /api/v1/lookup</code>.
        </p>
        <div className="mt-4">
          <ApiKeyForm />
        </div>

        {keys.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line-soft">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td className="text-[12.5px]">{k.name}</td>
                    <td className="mono text-[12px] text-muted">{k.prefix}_…</td>
                    <td className="text-[11.5px] text-faint">{new Date(k.created_at).toLocaleDateString()}</td>
                    <td className="text-[11.5px] text-faint">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                    </td>
                    <td className="text-right">
                      {k.revoked_at ? (
                        <span className="badge">revoked</span>
                      ) : (
                        <form action={revokeKeyAction}>
                          <input type="hidden" name="id" value={k.id} />
                          <button type="submit" className="btn btn-ghost px-2 py-1 text-[11px]">
                            <Icon name="trash" size={12} /> Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Active sessions</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-line-soft">
          <table className="table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Expires</th>
                <th>IP</th>
                <th>User agent</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={i}>
                  <td className="text-[11.5px] text-faint">{new Date(s.created_at).toLocaleString()}</td>
                  <td className="text-[11.5px] text-faint">{new Date(s.expires_at).toLocaleString()}</td>
                  <td className="mono text-[11.5px]">{s.ip ?? "—"}</td>
                  <td className="max-w-[340px] truncate text-[11px] text-faint">{s.user_agent ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Sessions are stored as SHA-256 digests of a 256-bit token. Only one cookie is issued per
          login; logging out revokes it server-side.
        </p>
      </section>
    </div>
  );
}
