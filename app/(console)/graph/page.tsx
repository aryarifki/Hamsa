import { requireUser } from "@/lib/auth";
import { buildGraph } from "@/lib/intel/graph";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Link graph" };
export const dynamic = "force-dynamic";

const COLORS: Record<string, string> = {
  phone: "#d9b26a",
  carrier: "#8a7f68",
  country: "#8a7f68",
  email: "#6fa8dc",
  ip: "#6fbf9b",
  username: "#c78fd4",
  telegram: "#62b6cb",
  domain: "#e0a458",
  name: "#d97b7b",
  breach: "#d9534f",
  other: "#7a7a7a",
};

export default async function GraphPage() {
  const user = await requireUser();
  const graph = await buildGraph(user.id, { limit: 300 });

  const width = 960;
  const height = 520;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 60;

  const positions = new Map<string, { x: number; y: number }>();
  graph.nodes.forEach((node, i) => {
    const angle = (i / Math.max(graph.nodes.length, 1)) * Math.PI * 2;
    positions.set(node.id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });

  return (
    <div className="space-y-6">
      <header className="rise">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brass/30 bg-brass/8 text-brass">
            <Icon name="eye" size={17} />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Link graph</h1>
            <p className="text-[12px] text-muted">
              Projection of your stored lookups: shared selectors, carriers, resolved hosts and breach exposure.
            </p>
          </div>
          <span className="badge mono ml-auto shrink-0">
            {graph.stats.nodes} nodes · {graph.stats.edges} edges
          </span>
        </div>
      </header>

      {graph.nodes.length === 0 ? (
        <section className="card card-pad text-[12.5px] text-muted">
          No successful lookups yet. Run a phone, email or domain lookup and the graph will fill itself.
        </section>
      ) : (
        <section className="card overflow-hidden">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Link graph">
            {graph.edges.map((edge, i) => {
              const a = positions.get(edge.from);
              const b = positions.get(edge.to);
              if (!a || !b) return null;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#2a2a2a"
                  strokeWidth={edge.kind === "same-target" ? 1.4 : 0.8}
                />
              );
            })}
            {graph.nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              return (
                <g key={node.id}>
                  <circle cx={pos.x} cy={pos.y} r={node.lookups.length > 1 ? 6 : 4} fill={COLORS[node.type] ?? "#7a7a7a"} />
                  <text x={pos.x + 8} y={pos.y + 3} fontSize={8.5} fill="#9a9a9a">
                    {node.label.length > 32 ? `${node.label.slice(0, 32)}…` : node.label}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="flex flex-wrap gap-2 border-t border-line-soft px-4 py-3">
            {Object.entries(COLORS)
              .filter(([type]) => type !== "other")
              .map(([type, color]) => (
                <span key={type} className="flex items-center gap-1.5 text-[10.5px] text-faint">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  {type}
                </span>
              ))}
          </div>
        </section>
      )}

      <section className="card card-pad">
        <p className="eyebrow mb-2">Nodes</p>
        <ul className="space-y-1.5 text-[12px]">
          {graph.nodes.slice(0, 60).map((node) => (
            <li key={node.id} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORS[node.type] ?? "#7a7a7a" }} />
              <span className="mono text-text">{node.label}</span>
              <span className="text-faint">· {node.type}</span>
              {node.lookups.length > 1 && <span className="text-faint">· {node.lookups.length} lookups</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
