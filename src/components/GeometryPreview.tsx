import { useState, type ReactNode } from "react";
import {
  planeCoordinates,
  type PlaneKind,
  type Point3,
} from "../domain/geometry";
import type { Project } from "../domain/model";
type View = PlaneKind | "XYZ";
export function drawing(p: Project, nodes: Set<string>, bars: Set<string>) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  return {
    nodes: [...nodes].map((id) => byId.get(id)!),
    bars: p.members
      .filter((m) => bars.has(m.id))
      .map((m) => [byId.get(m.start)!, byId.get(m.end)!] as const),
  };
}

export default function GeometryPreview({
  source,
  target,
  plane,
  mode,
  guide,
  children,
  labels = ["Original", "Resultado"],
}: {
  source: ReturnType<typeof drawing>;
  target: ReturnType<typeof drawing>;
  plane: View;
  mode: Project["mode"];
  guide?: { points: Point3[]; center?: Point3; label: string };
  children?: ReactNode;
  labels?: [string, string];
}) {
  const [view, setView] = useState<View>(plane);
  const project = (n: Point3) =>
    view === "XYZ"
      ? [(Math.sqrt(3) / 2) * (n.x - n.y), n.z - (n.x + n.y) / 2]
      : planeCoordinates[view].slice(0, 2).map((k) => n[k]);
  const points = [
    ...source.nodes,
    ...target.nodes,
    ...source.bars.flat(),
    ...target.bars.flat(),
    ...(guide?.points ?? []),
  ].map(project);
  const u = points.map((p) => p[0]),
    v = points.map((p) => p[1]);
  const loU = Math.min(...u),
    hiU = Math.max(...u),
    loV = Math.min(...v),
    hiV = Math.max(...v);
  const zoom = Math.min(
    260 / Math.max(hiU - loU, 0.01),
    140 / Math.max(hiV - loV, 0.01),
  );
  function pixel(n: Point3) {
    const [x, y] = project(n);
    return {
      x: 150 + (x - (loU + hiU) / 2) * zoom,
      y: 85 - (y - (loV + hiV) / 2) * zoom,
    };
  }
  return (
    <div className="transform-preview">
      <label>
        Vista da prévia
        <select value={view} onChange={(e) => setView(e.target.value as View)}>
          {(mode === "spatial" ? ["XY", "XZ", "YZ", "XYZ"] : ["XZ"]).map(
            (k) => (
              <option key={k} value={k}>
                {k === "XYZ" ? "Isométrica XYZ" : k}
              </option>
            ),
          )}
        </select>
      </label>
      <svg
        viewBox="0 0 300 170"
        role="img"
        aria-label={`Prévia geométrica em ${view}`}
      >
        {guide && (
          <g className="transform-guide">
            <polyline
              points={guide.points
                .map((p) => {
                  const q = pixel(p);
                  return `${q.x},${q.y}`;
                })
                .join(" ")}
            />
            {guide.center && (
              <circle
                cx={pixel(guide.center).x}
                cy={pixel(guide.center).y}
                r="4"
              />
            )}
          </g>
        )}
        {[source, target].map((layer, i) => (
          <g key={i} className={i ? "transform-target" : "transform-source"}>
            {layer.bars.map(([a, b], j) => {
              const A = pixel(a),
                B = pixel(b);
              return <line key={j} x1={A.x} y1={A.y} x2={B.x} y2={B.y} />;
            })}
            {layer.nodes.map((n) => {
              const pt = pixel(n);
              return (
                <circle key={n.id} cx={pt.x} cy={pt.y} r={i ? 2.8 : 3.8} />
              );
            })}
          </g>
        ))}
      </svg>
      <div className="transform-legend">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
        {guide && <span>{guide.label}</span>}
      </div>
      {children}
    </div>
  );
}
