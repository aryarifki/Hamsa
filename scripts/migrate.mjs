#!/usr/bin/env node
/**
 * Migration CLI (PostgreSQL).
 *
 *   npm run migrate            # apply all pending migrations
 *   npm run migrate -- status  # show every migration and whether it ran
 *   npm run migrate -- down    # roll back the most recent migration
 *
 * Reversible by design: `down` restores the previous structure and copies the
 * rows back. Data that has no representation in the older schema (documented
 * per migration as `dataLoss`) is dropped — read the note before rolling back
 * in production.
 */
import { closePool, ensureSchema, withClient } from "../lib/db.ts";
import { MIGRATIONS, migrationStatus, rollbackLast } from "../lib/migrations.ts";

const command = process.argv[2] ?? "up";
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("[migrate] DATABASE_URL is not set (postgres://user:pass@host:5432/hamsa)");
  process.exit(1);
}

const safeUrl = url.replace(/:\/\/([^:/]+):[^@]*@/, "://$1:***@");
const label = (applied) => (applied ? "applied " : "pending ");
const printStatus = (status) => {
  for (const row of status) {
    console.log(`  ${label(row.applied)} ${row.id}${row.appliedAt ? `  (${row.appliedAt})` : ""}`);
  }
};

console.log(`[migrate] ${safeUrl}`);

if (command === "status") {
  printStatus(await withClient((db) => migrationStatus(db)));
} else if (command === "down") {
  await ensureSchema();
  const rolledBack = await withClient((db) => rollbackLast(db));
  if (!rolledBack) {
    console.log("[migrate] nothing to roll back");
  } else {
    const meta = MIGRATIONS.find((m) => m.id === rolledBack);
    console.log(`[migrate] rolled back ${rolledBack}`);
    if (meta?.dataLoss) console.log(`[migrate] data loss: ${meta.dataLoss}`);
  }
  console.log("");
  printStatus(await withClient((db) => migrationStatus(db)));
} else if (command === "up") {
  await ensureSchema();
  console.log("[migrate] up to date");
  printStatus(await withClient((db) => migrationStatus(db)));
} else {
  console.error(`unknown command "${command}" — use up, down or status`);
  process.exitCode = 1;
}

const withNotes = MIGRATIONS.filter((m) => m.dataLoss);
if (command !== "down" && withNotes.length) {
  console.log("");
  for (const m of withNotes) console.log(`[migrate] note: ${m.id} — ${m.dataLoss}`);
}

await closePool();
