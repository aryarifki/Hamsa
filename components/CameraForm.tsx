"use client";

import { useActionState } from "react";
import { createCameraAction, type CameraState } from "@/app/(console)/actions";
import { Icon } from "@/components/Icon";

const initial: CameraState = {};

export function CameraForm() {
  const [state, action, pending] = useActionState(createCameraAction, initial);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input name="name" className="input" placeholder="Camera name (e.g. Warehouse gate)" required />
      <input
        name="onvif_host"
        className="input mono"
        placeholder="ONVIF host (optional, 10.0.0.12:8000)"
        autoComplete="off"
      />
      <input
        name="stream_url"
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
      <label className="text-[11px] text-faint">
        Snapshot interval (seconds)
        <input
          name="interval_seconds"
          type="number"
          min={30}
          max={86400}
          defaultValue={300}
          className="input mono mt-1 py-1.5 text-[12px]"
        />
      </label>
      <label className="text-[11px] text-faint">
        Motion threshold (ratio, blank = default)
        <input
          name="motion_threshold"
          type="number"
          min={0.0005}
          max={0.5}
          step={0.0005}
          className="input mono mt-1 py-1.5 text-[12px]"
          placeholder="0.01"
        />
      </label>

      {state.error && <p className="text-[12px] text-bad sm:col-span-2">{state.error}</p>}
      {state.ok && (
        <p className="flex items-center gap-1.5 text-[12px] text-good sm:col-span-2">
          <Icon name="check" size={12} /> Camera enrolled. Run a check, then capture a snapshot.
        </p>
      )}

      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <Icon name="plus" size={13} /> {pending ? "Enrolling…" : "Enroll camera"}
        </button>
      </div>
    </form>
  );
}
