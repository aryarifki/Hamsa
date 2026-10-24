import { mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Snapshot storage. Deliberately outside `public/`: the only way to read an
 * image is the authenticated route, which re-checks camera ownership.
 *
 * Layout: $HAMSA_STORAGE_DIR/cameras/<camera-id>/<iso-timestamp>.jpg
 * The directory is created 0700 and must be excluded from backups that leave
 * the deployment's trust boundary.
 */

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

export function storageRoot(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.HAMSA_STORAGE_DIR || join(process.cwd(), "storage"));
}

function cameraPath(cameraId: string): string {
  if (!SAFE_ID.test(cameraId)) throw new Error("Invalid camera id");
  return join(storageRoot(), "cameras", cameraId);
}

export function cameraDir(cameraId: string): string {
  const dir = cameraPath(cameraId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function removeCameraDir(cameraId: string): void {
  try {
    rmSync(cameraPath(cameraId), { recursive: true, force: true });
  } catch (err) {
    console.warn("[cctv] could not remove camera storage:", (err as Error).message);
  }
}

export function newSnapshotPath(cameraId: string, at = new Date()): string {
  return join(cameraDir(cameraId), `${at.toISOString().replace(/[:.]/g, "-")}.jpg`);
}

/** Rejects any path that resolves outside the storage root (DB tampering guard). */
export function assertInsideStorage(path: string): string {
  const root = storageRoot() + sep;
  const resolved = resolve(path);
  if (!resolved.startsWith(root)) throw new Error("Path escapes storage root");
  return resolved;
}

export function fileSize(path: string): number {
  return statSync(assertInsideStorage(path)).size;
}

export function removeFile(path: string | null | undefined): void {
  if (!path) return;
  try {
    rmSync(assertInsideStorage(path), { force: true });
  } catch (err) {
    console.warn("[cctv] could not remove snapshot:", (err as Error).message);
  }
}
