"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

/* ------------------------------------------------------------------ */
/* Signals                                                             */
/* ------------------------------------------------------------------ */

const LEVEL_STYLE: Record<string, string> = {
  high: "badge-bad",
  medium: "badge-warn",
  low: "badge-info",
  info: "badge",
};

export function Signals({ signals }: { signals: Array<{ label: string; level: string; detail?: string }> }) {
  if (!signals?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {signals.map((s, i) => (
        <span key={`${s.label}-${i}`} className={`badge ${LEVEL_STYLE[s.level] ?? "badge"}`} title={s.detail}>
          <span className="h-1 w-1 rounded-full bg-current" />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generic, readable renderer for any module payload                   */
/* ------------------------------------------------------------------ */

const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);

function humanKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function Primitive({ value }: { value: string | number | boolean }) {
  if (typeof value === "boolean") {
    return <span className={value ? "text-good" : "text-muted"}>{value ? "Yes" : "No"}</span>;
  }
  if (typeof value === "number") return <span className="mono text-text">{value.toLocaleString()}</span>;
  if (isUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer noopener" className="break-all text-info hover:underline">
        {value.length > 90 ? `${value.slice(0, 88)}…` : value}
      </a>
    );
  }
  return <span className="break-words text-text">{value === "" ? "—" : value}</span>;
}

function Table({ rows }: { rows: Array<Record<string, unknown>> }) {
  const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 6);
  return (
    <div className="overflow-x-auto rounded-lg border border-line-soft">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{humanKey(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 40).map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const v = row[c];
                return (
                  <td key={c} className="max-w-[320px] align-top">
                    {v === null || v === undefined ? (
                      <span className="text-faint">—</span>
                    ) : typeof v === "object" ? (
                      <span className="text-faint">…</span>
                    ) : (
                      <Primitive value={v as string | number | boolean} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 40 && (
        <p className="px-4 py-2 text-[11px] text-faint">Showing 40 of {rows.length} rows.</p>
      )}
    </div>
  );
}

function PostList({ posts }: { posts: Array<Record<string, unknown>> }) {
  return (
    <div className="space-y-2.5">
      {posts.slice(0, 25).map((post, i) => (
        <article key={i} className="rounded-lg border border-line-soft bg-surface-2/50 p-3.5">
          <div className="mb-1.5 flex items-center gap-2 text-[10px] text-faint">
            <Icon name="send" size={11} />
            <span className="mono">{String(post.channel ?? "")}</span>
            {post.datetime ? <span>· {new Date(String(post.datetime)).toLocaleString()}</span> : null}
            {isUrl(String(post.url ?? "")) && (
              <a
                href={String(post.url)}
                target="_blank"
                rel="noreferrer noopener"
                className="ml-auto text-info hover:underline"
              >
                open
              </a>
            )}
          </div>
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-text/90">
            {String(post.text ?? "")}
          </p>
        </article>
      ))}
    </div>
  );
}

export function DataView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined || data === "") {
    return <span className="text-faint">—</span>;
  }

  if (typeof data !== "object") {
    return <Primitive value={data as string | number | boolean} />;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-faint">None</span>;
    if (data.every((d) => typeof d !== "object" || d === null)) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {data.map((d, i) => (
            <span key={i} className="badge">
              {String(d)}
            </span>
          ))}
        </div>
      );
    }
    const objects = data as Array<Record<string, unknown>>;
    if (objects.every((o) => typeof o.text === "string")) return <PostList posts={objects} />;
    return <Table rows={objects} />;
  }

  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  if (!entries.length) return <span className="text-faint">No data</span>;

  const scalars = entries.filter(([, v]) => typeof v !== "object" || v === null);
  const nested = entries.filter(([, v]) => typeof v === "object" && v !== null);

  return (
    <div className={depth > 0 ? "space-y-4" : "space-y-5"}>
      {scalars.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {scalars.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                {humanKey(key)}
              </dt>
              <dd className="text-[13px] leading-relaxed">
                <Primitive value={value as string | number | boolean} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {nested.map(([key, value]) => (
        <section key={key} className={depth > 0 ? "" : "rounded-lg border border-line-soft bg-surface-2/30 p-4"}>
          <p className="eyebrow mb-2.5">{humanKey(key)}</p>
          <DataView data={value} depth={depth + 1} />
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Copy button                                                         */
/* ------------------------------------------------------------------ */

export function CopyButton({ value, label = "Copy JSON" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost px-2 py-1 text-[11px]"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
      {copied ? "Copied" : label}
    </button>
  );
}
