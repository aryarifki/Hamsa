"use client";

import { useActionState } from "react";
import { createDeviceAction, type DeviceState } from "@/app/(console)/actions";
import { Icon } from "@/components/Icon";
import { CopyButton } from "@/components/DataView";

const initial: DeviceState = {};

export function DeviceForm() {
  const [state, action, pending] = useActionState(createDeviceAction, initial);

  return (
    <div className="space-y-3">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <input name="name" className="input" placeholder="Device name (e.g. Field kit #3)" required />
        <input
          name="consent_ref"
          className="input mono"
          placeholder="Consent reference (signed form / ticket)"
          required
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <Icon name="plus" size={13} /> {pending ? "Registering…" : "Register device"}
        </button>
      </form>

      {state.error && <p className="text-[12px] text-bad">{state.error}</p>}

      {state.token && (
        <div className="rounded-lg border border-brass/30 bg-brass/8 p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">
            <Icon name="alert" size={12} /> Device token — shown once
          </p>
          <p className="mt-1 text-[11.5px] text-brass/80">
            Give this to the consenting device. It can only POST its own position.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="mono flex-1 overflow-x-auto rounded border border-line bg-ink px-2.5 py-1.5 text-[11.5px]">
              {state.token}
            </code>
            <CopyButton value={state.token} label="Copy" />
          </div>
        </div>
      )}
    </div>
  );
}
