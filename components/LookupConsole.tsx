"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { CopyButton, DataView, Signals } from "@/components/DataView";

export interface LookupResult {
  lookupId: string;
  module: string;
  target: string;
  cost: number;
  balance: number;
  result: {
    module: string;
    target: string;
    durationMs: number;
    signals: Array<{ label: string; level: string; detail?: string }>;
    sources: Array<{ name: string; kind: string; url?: string }>;
    data: Record<string, unknown>;
    warnings?: string[];
  };
}

export function LookupConsole({
  module,
  title,
  description,
  placeholder,
  examples,
  cost,
  icon,
  keywordLabel,
  keywordPlaceholder,
  extra,
}: {
  module: string;
  title: string;
  description: string;
  placeholder: string;
  examples: string[];
  cost: number;
  icon: IconName;
  keywordLabel?: string;
  keywordPlaceholder?: string;
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [keyword, setKeyword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LookupResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, target: target.trim(), keyword: keyword.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setData(json as LookupResult);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="rise">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brass/30 bg-brass/8 text-brass">
            <Icon name={icon} size={17} />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
            <p className="text-[12px] text-muted">{description}</p>
          </div>
          <span className="badge badge-brass mono ml-auto shrink-0">{cost} credits</span>
        </div>
      </header>

      <form onSubmit={submit} className="card card-pad rise">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="target" className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
              Target
            </label>
            <input
              id="target"
              className="input mono"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {keywordLabel && (
            <div className="sm:w-[220px]">
              <label htmlFor="keyword" className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
                {keywordLabel}
              </label>
              <input
                id="keyword"
                className="input"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={keywordPlaceholder}
              />
            </div>
          )}
          <div className="flex items-end">
            <button type="submit" className="btn btn-primary h-[38px] px-5" disabled={pending || !target.trim()}>
              {pending ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  Running
                </>
              ) : (
                <>
                  <Icon name="search" size={14} />
                  Investigate
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-faint">
          <span>Try:</span>
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setTarget(ex)}
              className="rounded border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] text-muted transition-colors hover:border-brass/40 hover:text-brass"
            >
              {ex}
            </button>
          ))}
        </div>

        {extra}
      </form>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-bad/30 bg-bad/8 px-4 py-3 text-[12.5px] text-bad rise">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Lookup failed</p>
            <p className="mt-0.5 text-bad/80">{error}</p>
          </div>
        </div>
      )}

      {pending && !data && (
        <div className="card card-pad space-y-3">
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-3" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-surface-3" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-3" />
        </div>
      )}

      {data && (
        <section className="card rise overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3.5">
            <span className="badge badge-good">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {data.result.sources.length} source{data.result.sources.length === 1 ? "" : "s"}
            </span>
            <span className="mono text-[12px] text-text">{data.result.target}</span>
            <span className="text-[11px] text-faint">{data.result.durationMs} ms</span>
            <span className="ml-auto flex items-center gap-2">
              <span className="hidden text-[11px] text-faint sm:inline">balance {data.balance}</span>
              <CopyButton value={JSON.stringify(data.result.data, null, 2)} />
            </span>
          </div>

          <div className="space-y-5 p-5">
            <Signals signals={data.result.signals} />
            <DataView data={data.result.data} />

            {data.result.warnings && data.result.warnings.length > 0 && (
              <div className="rounded-lg border border-warn/25 bg-warn/6 p-3.5">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-warn">
                  <Icon name="alert" size={12} /> Caveats
                </p>
                <ul className="space-y-1 text-[12px] leading-relaxed text-warn/85">
                  {data.result.warnings.map((w, i) => (
                    <li key={i}>· {w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
              <span className="eyebrow mr-1">Sources</span>
              {data.result.sources.map((s, i) => (
                <span key={i} className="badge" title={s.url}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer noopener" className="hover:text-text">
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                  <span className="text-faint">· {s.kind}</span>
                </span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
