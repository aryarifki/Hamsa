"use client";

import { useState } from "react";
import PolarisDashboard from "@/components/polaris/Dashboard";
import "./polaris.css";

/**
 * Polaris dashboard entry (Phone-X parity UI, first-party data).
 *
 * The dashboard renders as a fixed full-viewport overlay above the console
 * layout; EXIT returns to the regular console shell.
 */
export default function PolarisPage() {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <section>
        <h1>Polaris</h1>
        <p>Dashboard ditutup.</p>
        <button type="button" onClick={() => setOpen(true)}>
          Buka Polaris
        </button>
      </section>
    );
  }

  return <PolarisDashboard onClose={() => setOpen(false)} />;
}
