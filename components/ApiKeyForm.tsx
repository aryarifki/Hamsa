"use client";

import { useActionState } from "react";
import { createKeyAction, type KeyState } from "@/app/(console)/actions";
import { Icon } from "@/components/Icon";
import { CopyButton } from "@/components/DataView";

const initial: KeyState = {};

export function ApiKeyForm() {
  const [state, action, pending] = useActionState(createKeyAction, initial);

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap gap-2">
        <input name="name" className="input max-w-[280px] flex-1" placeholder="Key name (e.g. n8n pipeline)" required />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <Icon name="key" size={13} /> {pending ? "Generating…" : "Generate key"}
        </button>
      </form>

      {state.error && <p className="text-[12px] text-bad">{state.error}</p>}

      {state.token && (
        <div className="rounded-lg border border-brass/30 bg-brass/8 p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">
            <Icon name="alert" size={12} /> Copy this now — it will not be shown again
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="mono flex-1 overflow-x-auto rounded border border-line bg-ink px-2.5 py-1.5 text-[11.5px] text-text">
              {state.token}
            </code>
            <CopyButton value={state.token} label="Copy" />
          </div>
        </div>
      )}
    </div>
  );
}
