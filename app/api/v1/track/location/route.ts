/**
 * Alias of `/api/v1/device/ping` for clients that prefer a neutral path.
 * Both routes share the same handler, token rules and rate limit.
 */
export { POST } from "@/app/api/v1/device/ping/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
