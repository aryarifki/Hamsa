"use client";

import { Icon } from "@/components/Icon";

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      <Icon name="download" size={13} />
      {label}
    </button>
  );
}
