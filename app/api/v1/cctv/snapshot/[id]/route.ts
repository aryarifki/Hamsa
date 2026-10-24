import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { authenticate, fail } from "@/lib/http";
import { one } from "@/lib/db";
import { cameraForUser, type CameraSnapshot } from "@/lib/cctv/service";
import { assertInsideStorage } from "@/lib/cctv/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a snapshot to its owner (or an administrator).
 *
 * The file lives outside `public/`, and the path from the database is checked
 * against the storage root before it is read, so a tampered row cannot be used
 * to read an arbitrary file.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "Authentication required");

  const { id } = await params;
  const snapshot = await one<CameraSnapshot>("SELECT * FROM camera_snapshots WHERE id = ?", id);
  if (!snapshot) return fail(404, "Snapshot not found");

  const camera = await cameraForUser(snapshot.camera_id, auth.user);
  if (!camera) return fail(404, "Snapshot not found");

  try {
    const bytes = await readFile(assertInsideStorage(snapshot.file_path));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(bytes.length),
        "cache-control": "private, max-age=60",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return fail(404, "Snapshot file is missing");
  }
}
