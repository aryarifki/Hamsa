import { hashPassword } from "./crypto";
import { ensureSchema, newId, now, one, run } from "./db";

/**
 * One-time bootstrapping. Safe to call on every boot — and from several build
 * workers at once, which is why every insert is conflict-tolerant rather than
 * check-then-insert.
 */
export async function bootstrap(): Promise<void> {
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

  await ensureSchema();

  const adminEmail = (process.env.HAMSA_ADMIN_EMAIL || "admin@hamsa.local").toLowerCase();
  const adminPassword = process.env.HAMSA_ADMIN_PASSWORD || "change-this-on-first-login";

  try {
    const existing = await one<{ id: string }>("SELECT id FROM users WHERE email = ?", adminEmail);
    if (!existing) {
      await run(
        `INSERT INTO users (id, email, name, password_hash, role, credits, created_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?)
         ON CONFLICT (email) DO NOTHING`,
        newId(),
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
      await run(
        `INSERT INTO providers (id, kind, name, enabled, config, updated_at)
         VALUES (?, ?, ?, 0, NULL, ?)
         ON CONFLICT (kind, name) DO NOTHING`,
        newId(),
        kind,
        name,
        now(),
      );
    }
  } catch (err) {
    // A concurrent worker may have won the race; the next request retries
    // against the already-initialised database.
    console.warn("[hamsa] bootstrap skipped:", (err as Error).message);
  }
}
