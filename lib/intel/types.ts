/** Shared shapes returned by every intelligence module. */

export interface SourceRef {
  name: string;
  url?: string;
  kind: "offline" | "public-api" | "provider" | "derived";
}

export interface Signal {
  label: string;
  level: "info" | "low" | "medium" | "high";
  detail?: string;
}

export interface ModuleResult {
  /** Machine-readable module id, used for billing and history. */
  module: "phone" | "ip" | "email" | "username" | "telegram";
  target: string;
  /** Wall-clock duration of the enrichment. */
  durationMs: number;
  sources: SourceRef[];
  signals: Signal[];
  data: Record<string, unknown>;
  warnings?: string[];
}

export class ProviderError extends Error {
  readonly provider: string;

  constructor(provider: string, message: string) {
    super(message);
    this.provider = provider;
  }
}
