import { all } from "../db";
import type { LookupRecord } from "../lookup";
import type { ModuleResult } from "./types";

/**
 * Relationship graph derived from what the console already recorded.
 *
 * Nothing is fetched here: the graph is a projection of stored lookups, so it is
 * cheap to rebuild and never leaks a new request to a third party. Edges are
 * typed by how the connection was observed (`result`) or by the analyst reusing
 * the same selector (`same-target`).
 */

export type NodeType = "phone" | "email" | "ip" | "username" | "telegram" | "domain" | "name" | "carrier" | "breach" | "country" | "other";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  lookups: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { lookups: number; nodes: number; edges: number };
}

function nodeType(module: string): NodeType {
  switch (module) {
    case "phone":
    case "hlr":
    case "whatsapp":
    case "getcontact":
    case "ewallet":
    case "breach":
    case "humint":
    case "public-evidence":
      return "phone";
    case "ip":
      return "ip";
    case "email":
      return "email";
    case "username":
      return "username";
    case "telegram":
    case "telegram-analytics":
      return "telegram";
    case "domain":
      return "domain";
    case "name":
      return "name";
    default:
      return "other";
  }
}

function addNode(map: Map<string, GraphNode>, id: string, type: NodeType, label: string, lookupId: string): void {
  const existing = map.get(id);
  if (existing) {
    if (!existing.lookups.includes(lookupId)) existing.lookups.push(lookupId);
    return;
  }
  map.set(id, { id, type, label, lookups: [lookupId] });
}

/** Extracts secondary selectors (IPs, carriers, breaches, MX hosts…) from a result. */
function secondaryNodes(result: ModuleResult): Array<{ id: string; type: NodeType; label: string; kind: string }> {
  const out: Array<{ id: string; type: NodeType; label: string; kind: string }> = [];
  const data = result.data;

  if (typeof data.carrier === "string" && data.carrier) {
    out.push({ id: `carrier:${data.carrier}`, type: "carrier", label: data.carrier, kind: "carrier-of" });
  }
  if (typeof data.countryName === "string" && data.countryName) {
    out.push({ id: `country:${data.countryName}`, type: "country", label: data.countryName, kind: "country-of" });
  }

  const dns = data.dns as { A?: unknown; MX?: unknown; NS?: unknown } | undefined;
  if (dns) {
    for (const ip of Array.isArray(dns.A) ? dns.A : []) {
      if (typeof ip === "string") out.push({ id: `ip:${ip}`, type: "ip", label: ip, kind: "resolves-to" });
    }
    for (const mx of Array.isArray(dns.MX) ? dns.MX : []) {
      if (typeof mx === "string") out.push({ id: `mx:${mx}`, type: "domain", label: mx, kind: "mx" });
    }
  }

  const breaches = Array.isArray(data.breaches) ? data.breaches : [];
  for (const breach of breaches) {
    const name = typeof breach === "object" && breach ? String((breach as { name?: string }).name ?? "") : "";
    if (name) out.push({ id: `breach:${name}`, type: "breach", label: name, kind: "exposed-in" });
  }
  const records = Array.isArray(data.records) ? data.records : [];
  for (const record of records) {
    const source = typeof record === "object" && record ? (record as { source?: string | null }).source : null;
    if (source) out.push({ id: `source:${source}`, type: "other", label: source, kind: "mentioned-in" });
  }

  const wallets = Array.isArray(data.wallets) ? data.wallets : [];
  for (const wallet of wallets) {
    const label = typeof wallet === "object" && wallet ? (wallet as { wallet?: string }).wallet : null;
    const registered = typeof wallet === "object" && wallet ? (wallet as { registered?: boolean | null }).registered : null;
    if (label && registered) out.push({ id: `wallet:${label}`, type: "other", label, kind: "wallet" });
  }

  const hits = Array.isArray(data.hits) ? data.hits : [];
  for (const hit of hits.slice(0, 25)) {
    const url = typeof hit === "object" && hit ? (hit as { url?: string; site?: string }).url : null;
    const site = typeof hit === "object" && hit ? (hit as { site?: string }).site : null;
    if (url) out.push({ id: `profile:${url}`, type: "other", label: site ? `${site} profile` : url, kind: "profile" });
  }

  return out;
}

export async function buildGraph(
  userId: string,
  options: { limit?: number; caseId?: string } = {},
): Promise<GraphData> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);

  const rows = options.caseId
    ? await all<LookupRecord>(
        `SELECT l.id, l.user_id, l.module, l.target, l.status, l.cost, l.provider, l.result, l.error,
                l.created_at, l.duration_ms
           FROM lookups l
           JOIN case_items ci ON ci.lookup_id = l.id
          WHERE ci.case_id = ? AND l.user_id = ?
          ORDER BY l.created_at DESC LIMIT ?`,
        options.caseId,
        userId,
        limit,
      )
    : await all<LookupRecord>(
        `SELECT id, user_id, module, target, status, cost, provider, result, error, created_at, duration_ms
           FROM lookups WHERE user_id = ? AND status = 'ok'
          ORDER BY created_at DESC LIMIT ?`,
        userId,
        limit,
      );

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const byTarget = new Map<string, string[]>();

  const pushEdge = (from: string, to: string, kind: string) => {
    const key = `${from}->${to}:${kind}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to, kind });
  };

  for (const row of rows) {
    const id = `${row.module}:${row.target}`;
    addNode(nodes, id, nodeType(row.module), row.target, row.id);

    const targetKey = row.target.toLowerCase();
    const bucket = byTarget.get(targetKey) ?? [];
    bucket.push(id);
    byTarget.set(targetKey, bucket);

    if (!row.result) continue;
    let parsed: ModuleResult;
    try {
      parsed = JSON.parse(row.result) as ModuleResult;
    } catch {
      continue;
    }

    for (const secondary of secondaryNodes(parsed)) {
      addNode(nodes, secondary.id, secondary.type, secondary.label, row.id);
      pushEdge(id, secondary.id, secondary.kind);
    }

    if (row.module === "domain") {
      const subdomains = Array.isArray(parsed.data.subdomains) ? parsed.data.subdomains : [];
      for (const sub of subdomains.slice(0, 40)) {
        if (typeof sub !== "string") continue;
        addNode(nodes, `domain:${sub}`, "domain", sub, row.id);
        pushEdge(id, `domain:${sub}`, "subdomain");
      }
    }
  }

  // The same selector used in several modules is one entity, not several.
  for (const [, ids] of byTarget) {
    for (let i = 1; i < ids.length; i += 1) pushEdge(ids[0], ids[i], "same-target");
  }

  return {
    nodes: [...nodes.values()],
    edges,
    stats: { lookups: rows.length, nodes: nodes.size, edges: edges.length },
  };
}
