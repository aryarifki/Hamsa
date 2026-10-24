import { requireOperator } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { DeviceForm } from "@/components/DeviceForm";
import { listDevices } from "@/lib/track/consent";
import { listGeofences, recentGeofenceEvents, type Geofence } from "@/lib/track/geofence";
import { haversineMeters } from "@/lib/intel/geo";
import {
  createFenceAction,
  deleteDeviceAction,
  deleteFenceAction,
  revokeDeviceAction,
} from "@/app/(console)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Devices & geofence" };

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

const stamp = (iso: string) => new Date(iso).toLocaleString();

export default async function TrackingPage() {
  const user = await requireOperator();
  const devices = await listDevices(user);
  const fences = await listGeofences(user);
  const events = await recentGeofenceEvents(user, 12);

  const orgFences = fences.filter((fence) => fence.device_id === null);

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Own assets</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Devices & geofence</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">
          Consent-based position reporting. A device only appears here after the person carrying it
          has been given a token and agreed to share. Hamsa never resolves a phone number to a
          location, and a revoked token is rejected with 403 exactly like a forged one.
        </p>
      </header>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Register a consenting device</h2>
        <p className="mt-1 text-[11.5px] text-muted">
          The consent reference is mandatory and audited in two entries (registration + consent) —
          it is what makes this lawful.
        </p>
        <div className="mt-3">
          <DeviceForm />
        </div>
      </section>

      <section className="card card-pad">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[13px] font-semibold">Organisation-wide fences</h2>
          <span className="badge">{orgFences.length}</span>
          <p className="ml-auto max-w-md text-[11px] text-faint">
            A fence without a device applies to every consenting device. Device-scoped fences are
            added per device below.
          </p>
        </div>

        {orgFences.length > 0 && (
          <ul className="mt-3 divide-y divide-line-soft rounded-lg border border-line-soft">
            {orgFences.map((fence) => (
              <li key={fence.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11.5px]">
                <Icon name="pin" size={11} className="text-brass" />
                <span className="text-text">{fence.name}</span>
                <span className="mono text-[10.5px] text-faint">
                  {fence.lat.toFixed(4)}, {fence.lon.toFixed(4)}
                </span>
                <span className="badge mono ml-auto">{fence.radius_m} m</span>
                <form action={deleteFenceAction}>
                  <input type="hidden" name="id" value={fence.id} />
                  <button type="submit" className="btn btn-ghost px-1 py-0.5" aria-label="Delete fence">
                    <Icon name="close" size={11} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form action={createFenceAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
          <input name="name" className="input py-1.5 text-[12px]" placeholder="Fence name (e.g. Head office)" required />
          <input name="lat" className="input mono py-1.5 text-[12px]" placeholder="Latitude" required />
          <input name="lon" className="input mono py-1.5 text-[12px]" placeholder="Longitude" required />
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
            <Icon name="plus" size={12} /> Add
          </button>
        </form>
      </section>

      <section className="space-y-3">
        {devices.length === 0 ? (
          <div className="card px-6 py-12 text-center">
            <Icon name="pin" size={22} className="mx-auto text-faint" />
            <p className="mt-3 text-[13px] text-muted">No devices enrolled.</p>
          </div>
        ) : (
          devices.map((device) => {
            const deviceFences: Geofence[] = fences.filter(
              (fence) => fence.device_id === device.id || fence.device_id === null,
            );
            const hasPos = device.last_lat !== null && device.last_lon !== null;
            const revoked = Boolean(device.revoked_at);
            const stale =
              device.last_seen_at && Date.now() - new Date(device.last_seen_at).getTime() > 24 * 3600 * 1000;

            return (
              <article key={device.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3.5">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      revoked ? "bg-faint" : hasPos && !stale ? "live-dot bg-good" : "bg-faint"
                    }`}
                  />
                  <h3 className="text-[13.5px] font-medium">{device.name}</h3>
                  <span className="mono text-[10.5px] text-faint">{device.consent_ref ?? "no consent ref"}</span>
                  {revoked ? (
                    <span className="badge badge-bad ml-auto">revoked {ago(device.revoked_at)}</span>
                  ) : (
                    <span className={`badge ml-auto ${hasPos && !stale ? "badge-good" : ""}`}>
                      {hasPos ? ago(device.last_seen_at) : "no fix yet"}
                    </span>
                  )}
                  {!revoked && (
                    <form action={revokeDeviceAction}>
                      <input type="hidden" name="id" value={device.id} />
                      <button type="submit" className="btn btn-ghost px-2 py-1 text-[11px]" title="Revoke the consent token">
                        <Icon name="close" size={12} /> Revoke
                      </button>
                    </form>
                  )}
                  <form action={deleteDeviceAction}>
                    <input type="hidden" name="id" value={device.id} />
                    <button type="submit" className="btn btn-ghost px-1.5 py-1" aria-label="Delete device">
                      <Icon name="trash" size={13} />
                    </button>
                  </form>
                </div>

                <div className="grid gap-4 p-5 md:grid-cols-2">
                  <div>
                    <p className="eyebrow mb-2">Last known position</p>
                    {hasPos ? (
                      <>
                        <dl className="grid grid-cols-2 gap-3 text-[12px]">
                          <div>
                            <dt className="text-[10px] uppercase tracking-wider text-faint">Latitude</dt>
                            <dd className="mono mt-0.5">{device.last_lat!.toFixed(6)}</dd>
                          </div>
                          <div>
                            <dt className="text-[10px] uppercase tracking-wider text-faint">Longitude</dt>
                            <dd className="mono mt-0.5">{device.last_lon!.toFixed(6)}</dd>
                          </div>
                          <div>
                            <dt className="text-[10px] uppercase tracking-wider text-faint">Accuracy</dt>
                            <dd className="mono mt-0.5">
                              {device.last_accuracy !== null ? `${Math.round(device.last_accuracy)} m` : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[10px] uppercase tracking-wider text-faint">Battery</dt>
                            <dd className="mono mt-0.5">
                              {device.last_battery !== null ? `${Math.round(device.last_battery)}%` : "—"}
                            </dd>
                          </div>
                        </dl>
                        {device.last_seen_at && (
                          <p className="mt-2 text-[10.5px] text-faint">fix at {stamp(device.last_seen_at)}</p>
                        )}

                        {deviceFences.length > 0 && (
                          <ul className="mt-4 space-y-1.5">
                            {deviceFences.map((fence) => {
                              const distance = Math.round(
                                haversineMeters(
                                  { lat: device.last_lat!, lng: device.last_lon! },
                                  { lat: fence.lat, lng: fence.lon },
                                ),
                              );
                              const inside = distance <= fence.radius_m;
                              return (
                                <li key={fence.id} className="flex items-center gap-2 text-[11.5px]">
                                  <Icon name="pin" size={11} className={inside ? "text-good" : "text-faint"} />
                                  <span className="text-muted">{fence.name}</span>
                                  <span className={`badge ml-auto ${inside ? "badge-good" : ""}`}>
                                    {inside ? "inside" : "outside"} · {distance} m
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </>
                    ) : (
                      <p className="text-[12px] text-faint">
                        Waiting for the first ping. The device POSTs to
                        <span className="mono text-[11px] text-brass"> /api/v1/device/ping</span>.
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-line-soft bg-surface-2/40 p-3.5">
                    <p className="eyebrow mb-2">Device fences</p>
                    {deviceFences.length === 0 && (
                      <p className="mb-2 text-[11.5px] text-faint">None configured for this device.</p>
                    )}
                    <ul className="space-y-1.5">
                      {deviceFences.map((fence) => (
                        <li key={fence.id} className="flex items-center gap-2 text-[11.5px]">
                          <span className="mono text-[10.5px] text-faint">
                            {fence.lat.toFixed(4)}, {fence.lon.toFixed(4)}
                          </span>
                          <span className="text-muted">{fence.name}</span>
                          {fence.device_id === null && <span className="badge text-[9.5px]">org</span>}
                          <span className="badge mono">{fence.radius_m} m</span>
                          {fence.device_id !== null && (
                            <form action={deleteFenceAction} className="ml-auto">
                              <input type="hidden" name="id" value={fence.id} />
                              <button type="submit" className="btn btn-ghost px-1 py-0.5" aria-label="Delete fence">
                                <Icon name="close" size={11} />
                              </button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>

                    {!revoked && (
                      <form
                        action={createFenceAction}
                        className="mt-3 grid grid-cols-2 gap-2 border-t border-line-soft pt-3"
                      >
                        <input type="hidden" name="device_id" value={device.id} />
                        <input
                          name="name"
                          className="input col-span-2 py-1.5 text-[12px]"
                          placeholder="Fence name"
                          required
                        />
                        <input
                          name="lat"
                          className="input mono py-1.5 text-[12px]"
                          placeholder="Latitude"
                          defaultValue={device.last_lat?.toFixed(6) ?? ""}
                          required
                        />
                        <input
                          name="lon"
                          className="input mono py-1.5 text-[12px]"
                          placeholder="Longitude"
                          defaultValue={device.last_lon?.toFixed(6) ?? ""}
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
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line-soft px-5 py-3.5">
          <Icon name="clock" size={13} className="text-faint" />
          <h2 className="text-[13px] font-semibold">Recent enter / exit</h2>
        </div>
        {events.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12px] text-faint">
            No transitions yet. The first accepted position inside a fence records an entry; the
            engine never repeats it until the device leaves and comes back.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[11.5px]">
                <span className={`badge mono ${event.type === "enter" ? "badge-good" : "badge-bad"}`}>
                  {event.type}
                </span>
                <span className="text-muted">{event.device_name}</span>
                <span className="text-faint">→ {event.fence_name}</span>
                <span className="ml-auto text-faint">{stamp(event.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad">
        <h2 className="text-[13px] font-semibold">Device API</h2>
        <p className="mt-1 text-[11.5px] text-muted">
          The token is the only credential. Invalid, unknown and revoked tokens all return{" "}
          <span className="mono">403</span> with the same body; the endpoint is limited to 60 requests
          per minute per token.
        </p>
        <pre className="mono mt-3 overflow-x-auto rounded-lg border border-line bg-ink p-3.5 text-[11.5px] leading-relaxed text-muted">
{`curl -X POST https://your-host/api/v1/device/ping \\
  -H "Authorization: Bearer <consent-token>" \\
  -H "Content-Type: application/json" \\
  -d '{"lat": -6.2088, "lon": 106.8456, "accuracy": 12, "battery": 84}'`}
        </pre>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          The response lists each applicable fence with <span className="mono">inside</span> and{" "}
          <span className="mono">distanceMeters</span>, plus any transitions recorded by this update.
          <span className="mono"> /api/v1/track/location</span> is an alias of the same handler.
        </p>
      </section>
    </div>
  );
}
