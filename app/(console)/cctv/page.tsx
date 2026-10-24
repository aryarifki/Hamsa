import { requireOperator } from "@/lib/auth";
import { all } from "@/lib/db";
import { Icon } from "@/components/Icon";
import { CameraForm } from "@/components/CameraForm";
import {
  listCameras,
  recentCameraEvents,
  type Camera,
  type CameraSnapshot,
} from "@/lib/cctv/service";
import {
  captureCameraAction,
  checkCameraAction,
  deleteCameraAction,
  enableCameraAction,
  pollCameraAction,
} from "@/app/(console)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cameras" };

const statusClass = (status: string): string => {
  if (status === "online") return "badge-good";
  if (status === "offline" || status === "disabled_auth") return "badge-bad";
  return "";
};

const stamp = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString() : "never";

export default async function CctvPage() {
  const user = await requireOperator();
  const cameras = await listCameras(user);
  const events = await recentCameraEvents(user, 12);

  const snapshots = user.role === "admin"
    ? await all<CameraSnapshot>(
        `SELECT DISTINCT ON (camera_id) *
         FROM camera_snapshots ORDER BY camera_id, captured_at DESC`,
      )
    : await all<CameraSnapshot>(
        `SELECT DISTINCT ON (s.camera_id) s.*
         FROM camera_snapshots s JOIN cameras c ON c.id = s.camera_id
         WHERE c.created_by = ?
         ORDER BY s.camera_id, s.captured_at DESC`,
        user.id,
      );
  const latest = new Map(snapshots.map((snapshot) => [snapshot.camera_id, snapshot]));

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Own assets</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Camera monitor</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">
          Only streams you enrol yourself. Hamsa pulls a still on a schedule, compares it with a
          MOG2 background model, and optionally reads ONVIF motion events. Snapshots are stored
          outside <span className="mono">public/</span> and only served to the camera&apos;s owner.
        </p>
      </header>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Enrol a camera</h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
          Credentials can be pasted inside the URL or entered separately; either way they are split
          out and encrypted with AES-256-GCM. The URL column keeps only host and path.
        </p>
        <div className="mt-3">
          <CameraForm />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          An authentication failure (401/403 from the camera) disables the camera automatically and
          alerts every administrator. It is never retried until an operator fixes the credentials
          and re-enables it — that is what keeps a wrong password from locking the camera account.
        </p>
      </section>

      <div className="card overflow-hidden">
        {cameras.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Icon name="camera" size={22} className="mx-auto text-faint" />
            <p className="mt-3 text-[13px] text-muted">No cameras enrolled.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Camera</th>
                  <th>Status</th>
                  <th>Last snapshot</th>
                  <th>Motion</th>
                  <th>Last error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cameras.map((camera: Camera) => {
                  const shot = latest.get(camera.id);
                  return (
                    <tr key={camera.id}>
                      <td className="text-[12.5px]">
                        <div className="flex items-center gap-2.5">
                          {shot ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/v1/cctv/snapshot/${shot.id}`}
                              alt=""
                              className="h-10 w-14 shrink-0 rounded border border-line object-cover"
                            />
                          ) : (
                            <span className="grid h-10 w-14 shrink-0 place-items-center rounded border border-line bg-surface-2 text-faint">
                              <Icon name="camera" size={14} />
                            </span>
                          )}
                          <span>
                            <span className="block font-medium">{camera.name}</span>
                            <span className="mono block text-[10.5px] text-faint">
                              {camera.onvif_host ? `onvif ${camera.onvif_host}` : "rtsp only"}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${statusClass(camera.status)}`}>{camera.status}</span>
                      </td>
                      <td className="whitespace-nowrap text-[11.5px] text-faint">
                        {stamp(camera.last_snapshot_at)}
                      </td>
                      <td className="text-[11.5px]">
                        {shot?.motion_ratio !== null && shot?.motion_ratio !== undefined ? (
                          <span className={`mono ${shot.motion_detected ? "text-brass" : "text-faint"}`}>
                            {(shot.motion_ratio * 100).toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate text-[11px] text-faint" title={camera.last_error ?? ""}>
                        {camera.disabled_reason ?? camera.last_error ?? "—"}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <form action={checkCameraAction}>
                            <input type="hidden" name="id" value={camera.id} />
                            <button type="submit" className="btn btn-ghost px-2 py-1 text-[11px]" title="Probe the stream">
                              <Icon name="eye" size={12} /> Check
                            </button>
                          </form>
                          <form action={captureCameraAction}>
                            <input type="hidden" name="id" value={camera.id} />
                            <button
                              type="submit"
                              className="btn btn-ghost px-2 py-1 text-[11px]"
                              disabled={camera.status === "disabled_auth"}
                              title="Capture a snapshot now"
                            >
                              <Icon name="camera" size={12} /> Snapshot
                            </button>
                          </form>
                          {camera.onvif_host && (
                            <form action={pollCameraAction}>
                              <input type="hidden" name="id" value={camera.id} />
                              <button type="submit" className="btn btn-ghost px-2 py-1 text-[11px]" title="Pull ONVIF events">
                                <Icon name="send" size={12} /> Events
                              </button>
                            </form>
                          )}
                          {camera.status === "disabled_auth" && (
                            <form action={enableCameraAction}>
                              <input type="hidden" name="id" value={camera.id} />
                              <button type="submit" className="btn btn-ghost px-2 py-1 text-[11px]">
                                <Icon name="check" size={12} /> Re-enable
                              </button>
                            </form>
                          )}
                          <form action={deleteCameraAction}>
                            <input type="hidden" name="id" value={camera.id} />
                            <button type="submit" className="btn btn-ghost px-2 py-1 text-[11px]" aria-label="Delete camera">
                              <Icon name="trash" size={12} />
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line-soft px-5 py-3.5">
          <Icon name="clock" size={13} className="text-faint" />
          <h2 className="text-[13px] font-semibold">Recent motion events</h2>
        </div>
        {events.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12px] text-faint">
            No motion recorded yet. Events appear after a snapshot whose foreground ratio crosses the
            camera threshold, or after an ONVIF motion notification.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[11.5px]">
                <span className="badge badge-brass mono">{event.source}</span>
                <span className="text-muted">{event.camera_name}</span>
                <span className="text-faint">{event.type}</span>
                <span className="ml-auto text-faint">{stamp(event.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Scheduler</h2>
        <pre className="mono mt-3 overflow-x-auto rounded-lg border border-line bg-ink p-3.5 text-[11.5px] leading-relaxed text-muted">
{`# every minute; CRON_SECRET must match the deployment
curl -fsS -X POST https://your-host/api/v1/cron/cameras \\
  -H "Authorization: Bearer $CRON_SECRET"`}
        </pre>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Each pass is bounded (5 cameras) and only touches cameras whose interval has elapsed.
          Disabled and needs-config cameras are skipped; snapshot metadata older than 14 days can be
          pruned with <span className="mono">pruneSnapshots()</span>.
        </p>
      </section>
    </div>
  );
}
