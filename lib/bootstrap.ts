import { hashPassword } from "./crypto";
import { now, one, run } from "./db";

/**
 * One-time bootstrapping. Safe to call on every boot — and from multiple build
 * workers at once, which is why every insert is conflict-tolerant rather than
 * check-then-insert.
 */
export function bootstrap(): void {
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";

  if (
    !isBuild &&
    process.env.NODE_ENV === "production" &&
    (!process.env.HAMSA_SECRET || process.env.HAMSA_SECRET === "change-me-please-generate-a-real-secret")
  ) {
    throw new Error(
      "HAMSA_SECRET is unset or still the placeholder. Refusing to start in production: provider credentials and camera passwords would be encrypted with a publicly known key.",
    );
  }

  const adminEmail = (process.env.HAMSA_ADMIN_EMAIL || "admin@hamsa.local").toLowerCase();
  const adminPassword = process.env.HAMSA_ADMIN_PASSWORD || "change-this-on-first-login";

  try {
    const existing = one<{ id: string }>("SELECT id FROM users WHERE email = ?", adminEmail);
    if (!existing) {
      run(
        `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, credits, created_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?)`,
        crypto.randomUUID(),
        adminEmail,
        "Administrator",
        hashPassword(adminPassword),
        Number(process.env.HAMSA_SIGNUP_CREDITS ?? 25),
        now(),
      );
      console.log(`[hamsa] administrator ready: ${adminEmail}`);
    }

    // Seed the provider catalog as disabled placeholders so the admin UI has
    // rows to edit instead of requiring hand-written SQL.
    const catalog = [
      ["ip", "ipinfo.io"],
      ["phone", "Numverify"],
      ["email", "Have I Been Pwned"],
    ] as const;

    for (const [kind, name] of catalog) {
      run(
        `INSERT INTO providers (id, kind, name, enabled, config, updated_at)
         SELECT ?, ?, ?, 0, NULL, ?
         WHERE NOT EXISTS (SELECT 1 FROM providers WHERE kind = ? AND name = ?)`,
        crypto.randomUUID(),
        kind,
        name,
        now(),
        kind,
        name,
      );
    }
  } catch (err) {
    // A concurrent worker may have won the race. A locked DB at boot is not
    // fatal: the next request will retry against the already-initialised file.
    console.warn("[hamsa] bootstrap skipped:", (err as Error).message);
  }
}
