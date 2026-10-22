import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { haversineMeters } from "@/lib/intel/geo";
import { DeviceForm } from "@/components/DeviceForm";
import { Icon } from "@/components/Icon";
import { createFenceAction, deleteDeviceAction, deleteFenceAction } from "@/app/(console)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Devices & geofence" };

interface Device {
  id: string;
  name: string;
  consent_ref: string;
  last_seen_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_accuracy: number | null;
  last_battery: number | null;
}

interface Fence {
  id: string;
  device_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

export default async function TrackingPage() {
  const user = await requireUser();
  const devices = all<Device>(
    "SELECT id, name, consent_ref, last_seen_at, last_lat, last_lng, last_accuracy, last_battery FROM devices WHERE user_id = ? AND active = 1 ORDER BY created_at DESC",
    user.id,
  );
  const fences = all<Fence>(
    "SELECT id, device_id, name, lat, lng, radius_m FROM geofences WHERE user_id = ? AND active = 1 ORDER BY created_at DESC",
    user.id,
  );

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Assets</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Devices & geofence</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">
          Consent-based position reporting. A device only appears here after the person carrying it
          has been given a token and agreed to share — Hamsa never resolves a phone number to a
          location.
        </p>
      </header>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Register a consenting device</h2>
        <p className="mt-1 text-[11.5px] text-muted">
          The consent reference is mandatory and audited — it is what makes this lawful.
        </p>
        <div className="mt-3">
          <DeviceForm />
        </div>
      </section>

      <section className="space-y-3">
        {devices.length === 0 ? (
          <div className="card px-6 py-12 text-center">
            <Icon name="pin" size={22} className="mx-auto text-faint" />
            <p className="mt-3 text-[13px] text-muted">No devices enrolled.</p>
          </div>
        ) : (
          devices.map((d) => {
            const deviceFences = fences.filter((f) => f.device_id === d.id);
            const hasPos = d.last_lat !== null && d.last_lng !== null;
            const stale =
              d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() > 24 * 3600 * 1000;

            return (
              <article key={d.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3.5">
                  <span className={`h-2 w-2 rounded-full ${hasPos && !stale ? "live-dot bg-good" : "bg-faint"}`} />
                  <h3 className="text-[13.5px] font-medium">{d.name}</h3>
                  <span className="mono text-[10.5px] text-faint">{d.consent_ref}</span>
                  <span className={`badge ml-auto ${hasPos && !stale ? "badge-good" : ""}`}>
                    {hasPos ? ago(d.last_seen_at) : "no fix yet"}
                  </span>
                  <form action={deleteDeviceAction}>
                    <input type="hidden" name="id" value={d.id} />
                    <button type="submit" className="btn btn-ghost px-1.5 py-1" aria-label="Delete device">
                      <Icon name="trash" size={13} />
                    </button>
                  </form>
                </div>

                <div className="grid gap-4 p-5 md:grid-cols-2">
                  <div>
                    <p className="eyebrow mb-2">Last known position</p>
                    {hasPos ? (
                      <dl className="grid grid-cols-2 gap-3 text-[12px]">
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-faint">Latitude</dt>
                          <dd className="mono mt-0.5">{d.last_lat!.toFixed(6)}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-faint">Longitude</dt>
                          <dd className="mono mt-0.5">{d.last_lng!.toFixed(6)}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-faint">Accuracy</dt>
                          <dd className="mono mt-0.5">{d.last_accuracy ? `${Math.round(d.last_accuracy)} m` : "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-wider text-faint">Battery</dt>
                          <dd className="mono mt-0.5">
                            {d.last_battery !== null ? `${Math.round(d.last_battery)}%` : "—"}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="text-[12px] text-faint">
                        Waiting for the first ping. Devices POST to
                        <span className="mono text-[11px] text-brass"> /api/v1/device/ping</span>.
                      </p>
                    )}

                    {hasPos && deviceFences.length > 0 && (
                      <ul className="mt-4 space-y-1.5">
                        {deviceFences.map((f) => {
                          const dist = Math.round(haversineMeters({ lat: d.last_lat!, lng: d.last_lng! }, f));
                          const inside = dist <= f.radius_m;
                          return (
                            <li key={f.id} className="flex items-center gap-2 text-[11.5px]">
                              <Icon name="pin" size={11} className={inside ? "text-good" : "text-faint"} />
                              <span className="text-muted">{f.name}</span>
                              <span className={`badge ml-auto ${inside ? "badge-good" : ""}`}>
                                {inside ? "inside" : "outside"} · {dist} m
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-lg border border-line-soft bg-surface-2/40 p-3.5">
                    <p className="eyebrow mb-2">Geofences</p>
                    {deviceFences.length === 0 && (
                      <p className="mb-2 text-[11.5px] text-faint">None configured for this device.</p>
                    )}
                    <ul className="space-y-1.5">
                      {deviceFences.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 text-[11.5px]">
                          <span className="mono text-[10.5px] text-faint">
                            {f.lat.toFixed(4)}, {f.lng.toFixed(4)}
                          </span>
                          <span className="text-muted">{f.name}</span>
                          <span className="badge mono">{f.radius_m} m</span>
                          <form action={deleteFenceAction} className="ml-auto">
                            <input type="hidden" name="id" value={f.id} />
                            <button type="submit" className="btn btn-ghost px-1 py-0.5" aria-label="Delete fence">
                              <Icon name="close" size={11} />
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>

                    <form action={createFenceAction} className="mt-3 grid grid-cols-2 gap-2 border-t border-line-soft pt-3">
                      <input type="hidden" name="device_id" value={d.id} />
                      <input name="name" className="input col-span-2 py-1.5 text-[12px]" placeholder="Fence name" required />
                      <input
                        name="lat"
                        className="input mono py-1.5 text-[12px]"
                        placeholder="Latitude"
                        defaultValue={d.last_lat?.toFixed(6) ?? ""}
                        required
                      />
                      <input
                        name="lng"
                        className="input mono py-1.5 text-[12px]"
                        placeholder="Longitude"
                        defaultValue={d.last_lng?.toFixed(6) ?? ""}
                        required
                      />
                      <input
                        name="radius_m"
                        type="number"
                        min={20}
                        step={10}
                        defaultValue={200}
                        className="input mono py-1.5 text-[12px]"
                        placeholder="Radius (m)"
                        required
                      />
                      <button type="submit" className="btn px-2 py-1.5 text-[11.5px]">
                        <Icon name="plus" size={12} /> Add fence
                      </button>
                    </form>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Device API</h2>
        <pre className="mono mt-3 overflow-x-auto rounded-lg border border-line bg-ink p-3.5 text-[11.5px] leading-relaxed text-muted">
{`curl -X POST https://your-host/api/v1/device/ping \\
  -H "Authorization: Bearer dv_…" \\
  -H "Content-Type: application/json" \\
  -d '{"lat": -6.2088, "lng": 106.8456, "accuracy": 12, "battery": 84}'`}
        </pre>
        <p className="mt-2 text-[11px] text-faint">
          The response lists each fence and whether the device is inside it. Tokens are stored as
          SHA-256 digests and can be revoked by deleting the device.
        </p>
      </section>
    </div>
  );
}
