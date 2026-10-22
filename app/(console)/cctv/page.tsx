import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { Icon } from "@/components/Icon";
import { createCctvAction, checkCctvAction, deleteCctvAction } from "@/app/(console)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cameras" };

interface Camera {
  id: string;
  name: string;
  protocol: string;
  username: string | null;
  status: string;
  last_checked_at: string | null;
  created_at: string;
}

export default async function CctvPage() {
  const user = await requireUser();
  const cameras = all<Camera>(
    `SELECT id, name, protocol, username, status, last_checked_at, created_at
     FROM cctv_assets WHERE user_id = ? ORDER BY created_at DESC`,
    user.id,
  );

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Assets</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Camera estate</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">
          A reachability register for streams you own or are contracted to monitor. Hamsa ships no
          vendor keys and never scans for third-party cameras — you enroll each endpoint yourself.
        </p>
      </header>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Enroll a stream</h2>
        <form action={createCctvAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input name="name" className="input" placeholder="Camera name (e.g. Warehouse gate)" required />
          <select name="protocol" className="select" defaultValue="rtsp" disabled>
            <option value="rtsp">RTSP</option>
          </select>
          <input
            name="endpoint"
            className="input mono sm:col-span-2"
            placeholder="rtsp://10.0.0.12:554/Streaming/Channels/101"
            required
          />
          <input name="username" className="input" placeholder="Username (optional)" autoComplete="off" />
          <input
            name="password"
            type="password"
            className="input"
            placeholder="Password (encrypted at rest)"
            autoComplete="new-password"
          />
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary">
              <Icon name="plus" size={13} /> Enroll
            </button>
          </div>
        </form>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Endpoint URL and password are encrypted with AES-256-GCM using a key derived from
          <span className="mono"> HAMSA_SECRET</span>. Hamsa validates TCP reachability only; it
          never proxies or records video.
        </p>
      </section>

      <div className="card overflow-hidden">
        {cameras.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Icon name="camera" size={22} className="mx-auto text-faint" />
            <p className="mt-3 text-[13px] text-muted">No streams enrolled.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Protocol</th>
                  <th>Status</th>
                  <th>Last check</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cameras.map((c) => (
                  <tr key={c.id}>
                    <td className="text-[12.5px]">
                      {c.name}
                      {c.username && <span className="ml-2 text-[10.5px] text-faint">@{c.username}</span>}
                    </td>
                    <td className="mono text-[11.5px] text-muted uppercase">{c.protocol}</td>
                    <td>
                      <span
                        className={`badge ${
                          c.status === "online" ? "badge-good" : c.status === "offline" ? "badge-bad" : ""
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-[11.5px] text-faint">
                      {c.last_checked_at ? new Date(c.last_checked_at).toLocaleString() : "never"}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <form action={checkCctvAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="btn btn-ghost px-2 py-1 text-[11px]">
                            <Icon name="eye" size={12} /> Check
                          </button>
                        </form>
                        <form action={deleteCctvAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="btn btn-ghost px-2 py-1 text-[11px]">
                            <Icon name="trash" size={12} />
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
